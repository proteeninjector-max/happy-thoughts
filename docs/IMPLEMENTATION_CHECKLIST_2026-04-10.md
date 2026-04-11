# Happy Thoughts — Implementation Checklist

Date: 2026-04-10

## A. Product / plan primitives
- [x] Add plan enum: free, starter, builder, pro
- [x] Add plan-based request budget class
- [x] Add per-plan limits:
  - [x] daily/monthly request caps
  - [x] max prompt chars
  - [ ] max model output tokens
  - [x] verification enabled/disabled
  - [ ] model tier allowed

## B. Free consensus path
- [x] Make free consensus the canonical free public flow
- [x] Keep current free/cheap panel on free route:
  - [x] Mistral
  - [x] Cerebras
  - [x] Gemma
- [x] Keep synthesis on free/cheap lane for free plan
- [ ] Add free-tier caps:
  - [x] prompt length
  - [ ] R1 output caps
  - [ ] synthesis output cap
- [x] Add daily free usage tracking per user/account

## C. Verified answer path
- [ ] Build claim extraction step from consensus output
- [x] Build verification pass prompt
- [x] Return structured verification object:
  - [x] solid points
  - [x] uncertain points
  - [x] suspect points
  - [x] revised answer
  - [x] verification confidence
- [x] Gate verification to paid plans

## D. Model routing / budget classes
- [ ] Introduce routing config by tier:
  - [x] free consensus models
  - [x] starter verification model
  - [ ] builder verification model
  - [ ] pro verification model
- [x] Make model choices env-configurable
- [x] Make free-first default for non-premium flows
- [ ] Apply same free-first policy to remaining helper paths if needed

## E. Billing / usage
- [x] Add subscription-aware usage counters
- [x] Add verified-answer monthly quota tracking
- [ ] Optional later: add overage credits
- [x] Add graceful downgrade after quota exhaustion:
  - [ ] fallback to free consensus
  - [x] show upgrade/paywall message

## F. Cost control
- [ ] Enforce max prompt chars by plan
- [ ] Enforce max output tokens by stage
- [ ] Enforce max verification depth by plan
- [ ] Add request complexity estimation later if needed
- [ ] Separate or disable admin/test cache from buyer cache

## G. Reliability / credit ops
- [ ] Add low-balance monitoring for paid providers
- [ ] Add alert thresholds for API balances / credit exhaustion
- [ ] Add manual top-up workflow first
- [ ] Add auto top-up or equivalent later
- [ ] Add fallback behavior if premium verification credits are low:
  - [ ] downgrade to cheaper verification model
  - [ ] or return degraded verification explicitly
  - [ ] but never fail silently
- [ ] Add overnight protection:
  - [ ] balance checks
  - [ ] provider health checks
  - [ ] alerting before outage

## H. UX
- [x] Rename user-facing modes to Consensus and Verified
- [x] Add upgrade CTA after free answer
- [ ] Add disagreement-triggered upgrade CTA
- [ ] Add risk-domain upsell copy for finance / legal / medical / engineering

## I. Security / launch hardening
- [ ] Keep admin UI off custom domain
- [ ] Eventually remove browser admin routes entirely
- [ ] Add rate limiting
- [ ] Add request size limits
- [ ] Reduce raw upstream error leakage
- [ ] Add structured audit logs
- [ ] Add env kill switch for internal admin tools

## Suggested build order
1. Finalize naming + pricing
2. Make free consensus the default free path
3. Build paid verified-answer layer
4. Add quotas / plan enforcement
5. Add low-balance monitoring + alerting
6. Add auto top-up later
7. Polish UX and paywall
