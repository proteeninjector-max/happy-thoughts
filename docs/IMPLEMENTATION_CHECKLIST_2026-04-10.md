# Happy Thoughts — Implementation Checklist

Date: 2026-04-10

## A. Product / plan primitives
- [ ] Add plan enum: free, starter, builder, pro
- [ ] Add plan-based request budget class
- [ ] Add per-plan limits:
  - [ ] daily/monthly request caps
  - [ ] max prompt chars
  - [ ] max model output tokens
  - [ ] verification enabled/disabled
  - [ ] model tier allowed

## B. Free consensus path
- [ ] Make free consensus the canonical free public flow
- [ ] Keep current free/cheap panel on free route:
  - [ ] Mistral
  - [ ] Cerebras
  - [ ] Gemma
- [ ] Keep synthesis on free/cheap lane for free plan
- [ ] Add free-tier caps:
  - [ ] prompt length
  - [ ] R1 output caps
  - [ ] synthesis output cap
- [ ] Add daily free usage tracking per user/account

## C. Verified answer path
- [ ] Build claim extraction step from consensus output
- [ ] Build verification pass prompt
- [ ] Return structured verification object:
  - [ ] solid points
  - [ ] uncertain points
  - [ ] suspect points
  - [ ] revised answer
  - [ ] verification confidence
- [ ] Gate verification to paid plans

## D. Model routing / budget classes
- [ ] Introduce routing config by tier:
  - [ ] free consensus models
  - [ ] starter verification model
  - [ ] builder verification model
  - [ ] pro verification model
- [ ] Make model choices env-configurable
- [ ] Make free-first default for non-premium flows
- [ ] Apply same free-first policy to remaining helper paths if needed

## E. Billing / usage
- [ ] Add subscription-aware usage counters
- [ ] Add verified-answer monthly quota tracking
- [ ] Optional later: add overage credits
- [ ] Add graceful downgrade after quota exhaustion:
  - [ ] fallback to free consensus
  - [ ] show upgrade/paywall message

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
- [ ] Rename user-facing modes to Consensus and Verified
- [ ] Add upgrade CTA after free answer
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
