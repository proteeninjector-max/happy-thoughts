# Happy Thoughts — Phase 2 Build Order (MVP Only)

> Historical planning doc from the earlier marketplace-first build sequence.
> Keep for context, but do not treat it as current product strategy.
> Current strategy is free Consensus + paid Verified.

> Canonical root: `HappyThoughts/`
> Continue from current codebase (Phase 1 scaffold in place).

## Current endpoints (Phase 1)
- `POST /register`
- `GET /discover`
- `GET /health`

## Phase 2 MVP goals
- Add **/think** (synchronous) with x402 payment gate + decision response
- Add **/score/:id** (public breakdown)
- Add **/feedback** (validated feedback + scoring)
- Add **/dispute** (flag + freeze rule)
- Add **/route** (preview top 3 providers)
- Add **/leaderboard** (top 10 summary)
- Add **docs + policy routes** (read-only): `/docs`, `/preview`, `/llms.txt`

---

## 10-step MVP build order (exact files/routes to edit)

### 1) Add route registry + shared response helpers
**Edit:** `src/index.ts`
- Introduce route table or switch blocks for new endpoints.
- Add reusable helpers: `ok()`, `badRequest()`, `notFound()` as needed.

### 2) Implement `/think` (sync, paid)
**Edit:** `src/index.ts`
- Route: `POST /think`
- Use `verifyX402Payment()` from `src/middleware/payment.ts`
- Validate body: `prompt`, `specialty`, `min_confidence` (optional), `callback_url` (optional; ignore for MVP)
- Response schema (MVP):
  ```json
  {
    "thought_id": "uuid",
    "decision": "yes|no|wait",
    "confidence": 0.0,
    "rationale": "short",
    "provider_id": "...",
    "created_at": "ISO",
    "expires_at": "ISO"
  }
  ```
- Persist to `THOUGHTS` KV (`thought:${id}`)

### 3) Implement `/score/:id` (public breakdown)
**Edit:** `src/index.ts`
- Route: `GET /score/:id`
- Fetch `SCORES` KV + provider core info
- Return normalized score object

### 4) Implement `/feedback`
**Edit:** `src/index.ts`
- Route: `POST /feedback`
- Validate: `thought_id`, `provider_id`, `rating` (happy|sad), `reason` (optional)
- Update `FEEDBACK` KV + score adjustments
- Enforce basic rate-limit (MVP: 1 feedback per buyer per 24h) using `BUYERS` KV

### 5) Implement `/dispute`
**Edit:** `src/index.ts`
- Route: `POST /dispute`
- Validate: `thought_id`, `provider_id`, `reason`
- Write to `FLAGS` KV and update score flags
- Freeze / suspend logic (MVP): if 3 disputes in 7 days → 48h suspension

### 6) Implement `/route` (preview top 3)
**Edit:** `src/index.ts`
- Route: `GET /route`
- Use same provider selection as `/discover`, but return top 3 with price + tier

### 7) Implement `/leaderboard`
**Edit:** `src/index.ts`
- Route: `GET /leaderboard`
- Return top 10 by happy_trail + summary stats

### 8) Add docs + policy routes
**Edit:** `src/index.ts`
- Routes:
  - `GET /docs` → basic markdown or JSON summary
  - `GET /preview` → show product summary + pricing example
  - `GET /llms.txt` → stub for later; MVP can be static plain text

### 9) Add/extend tests for new endpoints
**Edit:** `tests/index.test.ts`
- Add tests for `/think`, `/score/:id`, `/feedback`, `/dispute`, `/route`, `/leaderboard`
- Keep owner-bypass path for payment in tests (`X-OWNER-KEY`)

### 10) Config + KV sanity check
**Edit:** `wrangler.toml`
- Confirm KV bindings are present for new flows:
  - `THOUGHTS`, `FEEDBACK`, `FLAGS`, `BUYERS`
- Add any missing vars:
  - `OWNER_KEY`, `OWNER_KEY_HEADER`, `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_ASSET`

---

## Notes (MVP constraints)
- No async callback flow in Phase 2 MVP.
- No bundle/referral automation beyond KV placeholders.
- Keep reasoning compact; focus on binary decision-support output.
- Legal content already lives in `legal/*.md` — routes should link to these.

