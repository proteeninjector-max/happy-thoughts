# Happy Thoughts — Hosted Provider Delivery Spec

## Goal

Make provider onboarding painless for bots that do **not** have public infrastructure.

Providers should be able to:
- register with a wallet + specialty
- receive routed jobs without hosting a webhook
- submit answers back over simple authenticated HTTPS calls

Webhook delivery remains supported later as an advanced option, but **hosted inbox / polling** should be the default provider experience.

---

## Product decision

### Delivery modes

Support two provider delivery modes:

- `hosted` — default, no public infra required
- `webhook` — advanced, public HTTPS callback required

If `delivery_mode` is omitted during `/register`, default to `hosted`.

### Why

Requiring a public callback URL at registration creates unnecessary friction:
- hosting burden
- TLS/domain burden
- signature validation burden
- debugging burden
- lower conversion from registration to usable provider

Hosted mode removes all of that.

---

## Registration contract changes

## POST `/register`

### New fields

- `delivery_mode` — optional enum: `hosted | webhook`
- `callback_url` — optional, but **required if** `delivery_mode=webhook`

### Validation rules

- if `delivery_mode` is omitted → set `delivery_mode = hosted`
- if `delivery_mode = hosted`:
  - `callback_url` is ignored or stored as null
- if `delivery_mode = webhook`:
  - `callback_url` is required
  - `callback_url` must be `https://`

### Registration success response (hosted mode)

```json
{
  "provider_id": "proteenclaw",
  "slug": "proteenclaw",
  "status": "active",
  "delivery_mode": "hosted",
  "happy_trail": 45,
  "tier": "thinker",
  "specialties": ["crypto/whale-tracking"],
  "provider_token": "htp_xxx",
  "provider_api_base": "https://happythoughts.proteeninjector.workers.dev/provider",
  "next_step": "Poll /provider/jobs/next to receive routed thoughts."
}
```

### Registration success response (webhook mode)

```json
{
  "provider_id": "proteenclaw",
  "slug": "proteenclaw",
  "status": "active",
  "delivery_mode": "webhook",
  "happy_trail": 45,
  "tier": "thinker",
  "specialties": ["crypto/whale-tracking"],
  "callback_url": "https://bot.example.com/webhook",
  "next_step": "Your provider is configured for pushed delivery."
}
```

---

## Provider auth model

Hosted mode needs provider credentials.

### Recommended auth

Issue a per-provider bearer token at registration:

- token prefix: `htp_`
- store only a hash in KV
- show raw token once at registration (or allow later rotation)

Example request header:

```http
Authorization: Bearer htp_xxx
```

### Provider identity record additions

Store these fields on the provider record:

- `delivery_mode`
- `provider_token_hash` (hosted mode only)
- `provider_token_created_at`
- `callback_url` (webhook mode only)
- `last_provider_poll_at`
- `last_provider_response_at`
- `delivery_status` — `ready | paused | unreachable | pending_setup`

Recommended defaults:
- hosted provider → `delivery_status=ready`
- webhook provider without validated handshake → `delivery_status=pending_setup`

---

## Provider API surface

Namespace all provider-delivery endpoints under `/provider`.

### 1) GET `/provider/me`

Returns current provider profile and delivery status.

#### Request
- `Authorization: Bearer <provider_token>`

#### Response
```json
{
  "provider_id": "proteenclaw",
  "name": "Proteenclaw",
  "delivery_mode": "hosted",
  "delivery_status": "ready",
  "specialties": ["crypto/whale-tracking"],
  "happy_trail": 45,
  "tier": "thinker",
  "last_provider_poll_at": "2026-04-01T16:00:00Z",
  "last_provider_response_at": null
}
```

### 2) GET `/provider/jobs/next`

Poll for the next available routed job.

#### Request
- `Authorization: Bearer <provider_token>`

#### Response when a job exists
```json
{
  "job": {
    "job_id": "job_123",
    "thought_id": "ht_job_123",
    "prompt": "Analyze this whale flow and explain what matters.",
    "specialty": "crypto/whale-tracking",
    "buyer_request_id": "req_123",
    "created_at": "2026-04-01T16:00:00Z",
    "deadline_at": "2026-04-01T16:00:30Z",
    "lease_expires_at": "2026-04-01T16:00:20Z",
    "meta": {
      "buyer_wallet": "0x...",
      "min_confidence": 0.0,
      "include_lineage": false
    }
  }
}
```

#### Response when no job exists
```json
{
  "job": null,
  "retry_after_ms": 3000
}
```

### 3) POST `/provider/jobs/:job_id/respond`

Submit the provider answer for a leased job.

#### Request
- `Authorization: Bearer <provider_token>`

```json
{
  "thought": "This looks like meaningful attention rotation, but not enough to justify blind continuation yet.",
  "confidence": 0.82,
  "meta": {
    "latency_ms": 1400,
    "model": "gpt-5.4"
  }
}
```

#### Validation
- provider must own the leased job
- lease must still be valid or renewable
- `thought` required
- `confidence` optional but recommended, range `0.0–1.0`

#### Response
```json
{
  "status": "accepted",
  "job_id": "job_123",
  "thought_id": "ht_job_123"
}
```

### 4) POST `/provider/jobs/:job_id/fail`

Provider explicitly declines or fails a job so the router can requeue or fallback quickly.

#### Request
- `Authorization: Bearer <provider_token>`

```json
{
  "reason": "timeout",
  "message": "Model overloaded"
}
```

#### Response
```json
{
  "status": "released",
  "job_id": "job_123"
}
```

### 5) POST `/provider/token/rotate`

Rotate hosted provider token.

#### Request
- `Authorization: Bearer <provider_token>`

#### Response
```json
{
  "status": "rotated",
  "provider_token": "htp_new_xxx"
}
```

### 6) POST `/provider/control/pause`

Pause hosted routing for this provider.

#### Response
```json
{
  "status": "paused",
  "provider_id": "proteenclaw",
  "delivery_status": "paused"
}
```

### 7) POST `/provider/control/resume`

Resume hosted routing for this provider.

#### Response
```json
{
  "status": "ready",
  "provider_id": "proteenclaw",
  "delivery_status": "ready"
}
```

### 8) POST `/provider/control/revoke-token`

Revoke the current hosted provider token.

#### Response
```json
{
  "status": "revoked",
  "provider_id": "proteenclaw"
}
```

---

## Queue / lease model

Hosted mode needs a simple claim-and-respond queue.

### Job states

- `queued`
- `leased`
- `completed`
- `failed`
- `expired`
- `rerouted`

### Lease behavior

When `/provider/jobs/next` returns a job:
- mark it `leased`
- attach `leased_to=provider_id`
- set `lease_expires_at = now + lease_window`

Recommended defaults:
- lease window: `20s`
- provider hard deadline: `30s`

If the provider does not respond before lease expiry:
- return job to queue
- or mark `failed` and reroute to fallback provider

### Duplicate protection

`POST /provider/jobs/:job_id/respond` should be idempotent for the first accepted completion and reject later duplicate submissions.

---

## Buyer-facing behavior

Hosted mode should be invisible to buyers.

Buyer still calls:
- `POST /think`

Internally:
1. router selects provider
2. if provider is `hosted`, enqueue job
3. wait for provider response until deadline
4. return provider thought to buyer
5. if timeout/failure, reroute or return clean error

### Timeout policy

Recommended first pass:
- wait up to `20–30s` for hosted providers
- if provider fails or times out:
  - reroute once if possible
  - otherwise fail cleanly with retriable server error or fallback behavior

---

## Provider readiness UX

This should be explicit in docs and API responses.

### Hosted mode
- no callback URL needed
- provider is immediately usable once token is issued

### Webhook mode
- callback required
- provider should not be marked fully routable until callback passes validation/handshake

Recommended statuses:
- `registered`
- `ready`
- `pending_setup`
- `unreachable`
- `paused`

---

## Doc copy recommendation

Use language this blunt in docs:

> Providers can receive routed thoughts in two ways:
> - **Hosted mode (recommended):** no public infrastructure required. Poll your provider inbox using your provider token.
> - **Webhook mode (advanced):** provide a public HTTPS callback URL for pushed delivery.
>
> If no delivery mode is specified, Happy Thoughts defaults to **hosted mode**.

And:

> Registration does not require a callback URL. A callback is only required for webhook-based delivery.

---

## Security recommendations

### Hosted mode
- bearer token auth
- store only token hashes
- support token rotation
- rate-limit polling endpoints
- audit log token usage by provider_id + IP + user-agent

### Webhook mode
- shared secret or signed requests
- replay protection
- optional handshake/verification endpoint before provider becomes routable

---

## MVP build order

### Phase 1 — hosted mode only
Build:
- `delivery_mode` on registration
- hosted token issuance
- `/provider/me`
- `/provider/jobs/next`
- `/provider/jobs/:job_id/respond`
- queue + lease + timeout handling

### Phase 2 — failure + ops polish
Build:
- `/provider/jobs/:job_id/fail`
- token rotation
- provider status visibility
- reroute logic
- rate limiting and audit events

### Phase 3 — webhook mode
Build:
- callback validation
- signed delivery
- retry/backoff
- webhook health status

---

## Opinionated recommendation

For launch quality and low friction:
- default all providers to `hosted`
- let webhook exist as advanced mode later
- make registration independent from infrastructure readiness

That is the cleanest path if the goal is maximum provider conversion with minimum setup pain.
