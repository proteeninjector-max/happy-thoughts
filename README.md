# Happy Thoughts

Happy Thoughts is an answer product built around a simple split:

- **Consensus** helps users think
- **Fact-checking** helps users trust

The public-facing idea is not “pick the right model.”
It is: **get a useful answer first, then pay for stronger verification when the stakes are higher.**

## Start here

If you're just landing in the repo, use this path:

1. **Understand the product** → this README
2. **See the public API surface** → `public/llm.txt` or `public/openapi.json`
3. **Integrate as a provider** → `docs/PROVIDER_QUICKSTART.md`
4. **Steal a practical pattern** → `docs/PROVIDER_EXAMPLES.md`
5. **Explore the provider contract in practice** → `docs/HOSTED_PROVIDER_DELIVERY.md`

## Who this repo is for

- builders integrating buyer flows
- hosted providers integrating the supply side
- operators reviewing plans, entitlements, and public product behavior
- collaborators who need the contract, not the secret internals

## Architecture in one glance

Think of Happy Thoughts as a simple 3-layer stack:

1. **Buyer layer**
   - humans or agents ask for an answer
   - free starts at Consensus
   - paid unlocks Fact-checking

2. **Product layer**
   - enforces plans, quotas, and gating
   - routes requests through the public contract
   - returns a clean answer shape with confidence + caveats

3. **Provider layer**
   - hosted providers and webhook providers supply answers underneath
   - providers stay important, but users do not need to understand the backend mechanics first

That separation is the whole point: the product feels simple on top while the supply side stays flexible underneath.

## Product framing

### Consensus
Free or capped entry path.

Consensus compares multiple model responses, synthesizes them into a single answer, and returns confidence plus caveats. It is designed for:
- everyday questions
- exploratory thinking
- low-stakes decision support
- broad accessibility

### Fact-checking
Paid trust layer.

Fact-checking is the higher-assurance branch for prompts where factual confidence matters more than speed or cost. Internally the request mode is still `verified` for compatibility, but the public product language is fact-checking. It is designed to return a concise final answer while keeping deeper verification structure available underneath. It is designed for:
- fact-checking style review
- higher-stakes prompts
- stronger trust signaling
- premium UX and billing paths

## What this repo contains

- Cloudflare Worker application code
- answer routing and synthesis logic
- plan / entitlement scaffolding
- provider registration + hosted provider plumbing
- billing and activation flows
- legal/public product documents
- a curated public code sample of the Worker surface

## Public repo boundaries

This repo is meant to show the product surface and integration contract, not every internal ranking or orchestration decision.

Public docs should explain:
- what buyers can call
- what providers can integrate with
- what plans/gates exist
- what response shapes and controls are stable

Public docs should not hand out:
- internal weighting logic
- private routing heuristics
- hidden ranking knobs
- secret evaluation sauce

## What makes the project interesting

- productized multi-model orchestration
- free-to-paid answer ladder
- hosted provider marketplace direction
- quota and entitlement enforcement
- graceful degradation when providers fail
- worker-native deployment model

## Current implemented direction

- public requests default toward **Consensus**
- free consensus quota is enforced
- **Fact-checking** exists as a gated paid path
- provider supply still exists underneath the product surface
- PayPal capture flow is hardened to activate only after completed capture

## Reliability model

Consensus is designed to degrade gracefully.

If one provider fails, the request should still complete when possible.
Failure metadata is surfaced instead of silently pretending everything is perfect.

Important response-level concepts include:
- `confidence`
- `confidence_reason`
- `models_used`
- `models_failed`
- `meta.degraded`
- `meta.failure_count`

## Billing paths

Happy Thoughts currently supports two activation styles:
- **x402 / agent-native** flows
- **PayPal** for conventional checkout

PayPal activation is capture-based, not approval-only.
That keeps entitlement activation tied to actual completed payment.

## Example API calls

These examples are intentionally product-level and sanitized. They show how to use Happy Thoughts without exposing internal scoring or orchestration logic.

### Ask for a Consensus answer

```bash
curl -X POST https://happythoughts.proteeninjector.workers.dev/think \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Give me the strongest argument against this idea.",
    "buyer_wallet": "0xabc123...",
    "mode": "consensus"
  }'
```

Want vertical examples instead of generic ones?
See **`docs/PROVIDER_EXAMPLES.md`**.

### Request Fact-checking

```bash
curl -X POST https://happythoughts.proteeninjector.workers.dev/think \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Fact-check this product claim and call out weak evidence.",
    "buyer_wallet": "0xabc123...",
    "mode": "verified"
  }'
```

### Hosted provider poll loop

```bash
curl https://happythoughts.proteeninjector.workers.dev/provider/jobs/next \
  -H "Authorization: Bearer htp_your_provider_token"
```

```bash
curl -X POST https://happythoughts.proteeninjector.workers.dev/provider/jobs/JOB_ID/respond \
  -H "Authorization: Bearer htp_your_provider_token" \
  -H "Content-Type: application/json" \
  -d '{
    "thought": "Short, direct answer here.",
    "confidence": 0.91,
    "meta": {"style": "direct"}
  }'
```

## Repo structure

- `src/` — Worker logic
- `public/` — public site assets
- `docs/` — public integration and provider docs
- `legal/` — terms, privacy, provider agreement, AUP

## Useful entry points

- **Public API summary:** `public/llm.txt`
- **Machine-readable spec:** `public/llms-full.txt`
- **OpenAPI:** `public/openapi.json`
- **Provider quickstart:** `docs/PROVIDER_QUICKSTART.md`
- **Provider example pack:** `docs/PROVIDER_EXAMPLES.md`
- **Specialty list:** `docs/SPECIALTIES.md`
- **Registration quickstart:** `docs/REGISTRATION_QUICKSTART.md`

## Notes on public cleanliness

This repository is strongest when presented as:
- a product engineering repo
- a billing + entitlement repo
- a multi-model answer system
- a worker-native API/app deployment

Not as “just another wrapper around LLMs.”

## Suggested starting docs

- `docs/PROVIDER_QUICKSTART.md`
- `docs/PROVIDER_EXAMPLES.md`
- `docs/REGISTRATION_QUICKSTART.md`
- `docs/HOSTED_PROVIDER_DELIVERY.md`

## Status

Active product repo with a clear direction:
**free Consensus, paid Fact-checking, provider infrastructure underneath.**
