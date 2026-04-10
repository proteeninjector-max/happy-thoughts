# Happy Thoughts — Phase 1 Task List

Date: 2026-04-10

## Objective
Build the monetization spine:
- free users get Consensus
- paid users unlock Verified
- quotas and budget classes become first-class primitives

## Phase 1 scope

### 1. Plan primitives
- Add plan enum/types:
  - `free`
  - `starter`
  - `builder`
  - `pro`
- Add request budget class mapping per plan.
- Add helper(s) to resolve a user's plan from request/auth context.

### 2. User-facing mode reframing
- Stop centering `quick` in product-facing responses.
- Introduce public naming:
  - `consensus`
  - `verified`
- Keep internal compatibility where needed, but make outward copy/product terms match the new ladder.

### 3. Free consensus default flow
- Make free/public default path route to consensus output.
- Preserve current quick/internal behavior only where operationally needed.
- Ensure free path uses free/cheap-first models.

### 4. Free quota enforcement
- Add daily free usage tracking.
- Enforce free consensus request cap.
- Return clean upgrade/paywall response when free quota is exhausted.

### 5. Verified placeholder branch
- Add paid-only `verified` mode branch/scaffold.
- If user is not entitled, return upgrade-required response instead of trying to verify.
- Do not build the full verification pipeline yet in Phase 1; just create the product branch and gating seam.

### 6. Upgrade CTA plumbing
- Return structured upgrade CTA/meta in free responses.
- Return structured plan/usage info where useful.

## Recommended implementation order
1. Add plan enums + plan resolver
2. Add quota storage/check helpers
3. Reframe public mode naming
4. Route free flow to consensus by default
5. Add verified branch scaffold + entitlement checks
6. Add upgrade CTA / quota exhausted responses

## Done when
- Public free flow is clearly Consensus
- Plan concepts exist in code
- Free quota exists in code
- Verified mode exists as a gated branch
- Response language aligns with the product direction
