# Happy Thoughts Security Hardening — 2026-04-10

## Scope
Focused audit of the primary buyer route: `POST /think`.

Reason for scoped audit: most lanes converge through the same route-selection, payment, cache, and dispatch plumbing. Different specialties mostly change provider selection, not the trust boundary shape.

## Verdict
`POST /think` is structurally workable for launch, but it needs a few operator-safety and abuse-hardening changes before broad public rollout.

## What looks solid
- Public buyer path requires `buyer_wallet` and validates `specialty`.
- Payment enforcement is present for non-owner requests on:
  - normal quick answers
  - cached quick answers
  - consensus answers
- Cache key is mode + normalized prompt hash, which is simple and predictable.
- Internal owner bypass is separate from public x402 flow.
- Provider selection filters out flagged providers and non-ready delivery states.

## Main risks found on `POST /think`

### 1. Owner-bypass and admin testing surface
Risk:
- Internal testing routes existed in the same production worker.
- Even when auth-protected, browser-facing admin surfaces increase probing and operational mistakes.

Mitigation applied today:
- Admin UI routes are now quarantined to `*.workers.dev` / localhost-style hosts only.
- Custom domain should return `404` for admin UI routes.

Recommended next step:
- Remove browser admin UI entirely before broad launch, or move it to a separate internal-only worker.

### 2. Cached degraded answers can mislead operators
Risk:
- A degraded answer can be cached and replayed, making new code/provider changes look broken.

Mitigation applied today:
- Added fresh-run bypass support for owner/internal testing.

Recommended next step:
- Do not cache owner-run test responses, or store them under a separate admin cache namespace.

### 3. Public quick route still depends on provider metadata quality
Risk:
- If a seeded/internal provider points to an expensive or degraded lane, public traffic can route there unless the handler itself is free-first.

Mitigation applied today:
- General lane handler was changed to prefer free/cheap providers first.

Recommended next step:
- Apply the same free-first policy to classification and any remaining premium-first internal helper flows.

### 4. Browser-delivered admin secrets are bad ops hygiene
Risk:
- Typing owner secrets into a browser page is exposure-prone.

Recommendation:
- Replace browser admin testing with local scripts / CLI / OpenClaw-only internal calls.

## Launch checklist (practical)

### Must do before broader public launch
1. Remove or disable browser admin routes entirely.
2. Keep owner bypass off the custom domain.
3. Make all non-premium paths default free-first.
4. Separate admin/test cache from buyer cache, or disable test caching.
5. Add explicit rate limiting for `/think`, `/feedback`, `/dispute`, and provider polling.
6. Add structured audit logging for:
   - owner bypass hits
   - failed payment checks
   - provider dispatch failures
   - repeated 4xx/5xx spikes
7. Add a kill switch / env flag to disable internal admin routes instantly.

### Good next hardening moves
- Add per-IP and per-wallet request throttles.
- Add request size limits on prompt bodies.
- Sanitize and bound provider error text before echoing it back to clients.
- Return less raw upstream error detail to public callers.
- Move admin utilities to a separate internal worker if they survive.

## Bottom line
The core buyer route is not obviously exploitable from this audit alone, but the admin/testing surface was too exposed for comfort. The biggest issue is not a proven auth bypass — it is unnecessary prod attack surface and operational confusion.
