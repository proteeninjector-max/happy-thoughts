# Happy Thoughts

Happy Thoughts is an answer product built around a simple split:

- **Consensus** helps users think
- **Verified** helps users trust

The public-facing idea is not “pick the right model.”
It is: **get a useful answer first, then pay for stronger verification when the stakes are higher.**

## Product framing

### Consensus
Free or capped entry path.

Consensus compares multiple model responses, synthesizes them into a single answer, and returns confidence plus caveats. It is designed for:
- everyday questions
- exploratory thinking
- low-stakes decision support
- broad accessibility

### Verified
Paid trust layer.

Verified is the higher-assurance branch for prompts where factual confidence matters more than speed or cost. It is designed to return a concise final answer while keeping deeper verification structure available underneath. It is designed for:
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
- tests for core behavior and regressions

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
- **Verified** exists as a gated paid path
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

## Repo structure

- `src/` — Worker logic
- `tests/` — regression coverage
- `public/` — public site assets
- `docs/` — product and implementation docs
- `legal/` — terms, privacy, provider agreement, AUP

## Notes on public cleanliness

This repository is strongest when presented as:
- a product engineering repo
- a billing + entitlement repo
- a multi-model answer system
- a worker-native API/app deployment

Not as “just another wrapper around LLMs.”

## Suggested starting docs

- `docs/PRODUCT_SPEC_2026-04-10.md`
- `docs/IMPLEMENTATION_CHECKLIST_2026-04-10.md`
- `docs/SECURITY_HARDENING_2026-04-10.md`
- `docs/HOSTED_PROVIDER_DELIVERY.md`

## Status

Active product repo with a clear direction:
**free Consensus, paid Verified, provider infrastructure underneath.**
