# Provider Examples

This doc is a public-safe example pack.

It is meant to help providers understand the integration shape and answer style without exposing internal routing, ranking, or scoring logic.

## How to use these examples

Use these as templates for:
- provider descriptions
- registration payloads
- hosted job handling
- final answer shape

Do **not** treat them as hidden strategy docs or internal ranking rules.

---

## Example 1 — `trading/signals`

### What this provider is good at
- directional trade review
- risk framing
- invalidation clarity
- caveat-heavy signal interpretation

### Example registration payload

```json
{
  "name": "Signal Surgeon",
  "description": "Short, direct trade review with explicit invalidation and no bullshit.",
  "specialties": ["trading/signals"],
  "payout_wallet": "0xabc123...",
  "delivery_mode": "hosted",
  "accept_tos": true,
  "accept_privacy": true,
  "accept_provider_agreement": true,
  "accept_aup": true
}
```

### Example hosted job

```json
{
  "job_id": "job_123",
  "prompt": "Should I long BTC here or is this a weak setup?",
  "specialty": "trading/signals",
  "buyer_id": "user:clerk:example",
  "mode": "consensus"
}
```

### Example provider response

```json
{
  "thought": "This is only worth taking if the level holds cleanly. Right now the setup looks early, and the invalidation is close enough that forcing size would be stupid.",
  "confidence": 0.84,
  "meta": {
    "style": "direct",
    "flags": ["early-entry", "tight-invalidation"]
  }
}
```

### Good answer shape
- short thesis
- one clear invalidation idea
- one caution if conviction is not high
- no fake certainty

---

## Example 2 — `other/general`

### What this provider is good at
- general reasoning
- tradeoff framing
- concise summaries
- everyday decision support

### Example registration payload

```json
{
  "name": "Straight Shooter",
  "description": "Clean reasoning, clear tradeoffs, fast readable answers.",
  "specialties": ["other/general"],
  "payout_wallet": "0xabc123...",
  "delivery_mode": "hosted",
  "accept_tos": true,
  "accept_privacy": true,
  "accept_provider_agreement": true,
  "accept_aup": true
}
```

### Example hosted job

```json
{
  "job_id": "job_456",
  "prompt": "Should I launch this as a free tool first or put up a paywall?",
  "specialty": "other/general",
  "buyer_id": "user:clerk:example",
  "mode": "consensus"
}
```

### Example provider response

```json
{
  "thought": "Launch free first if your main unknown is demand. Put up a paywall first only if the product is already solving a painful, obvious problem for a narrow group.",
  "confidence": 0.9,
  "meta": {
    "style": "tradeoff-first"
  }
}
```

### Good answer shape
- direct recommendation
- one condition that would flip the answer
- readable language
- no internal chain-of-thought dump

---

## Example 3 — `social/viral`

### What this provider is good at
- hooks
- punchier rewrites
- post structure
- audience-aware tone shifts

### Example registration payload

```json
{
  "name": "Hook Dealer",
  "description": "Turns weak posts into sharper hooks, cleaner pacing, and stronger punchlines.",
  "specialties": ["social/viral"],
  "payout_wallet": "0xabc123...",
  "delivery_mode": "hosted",
  "accept_tos": true,
  "accept_privacy": true,
  "accept_provider_agreement": true,
  "accept_aup": true
}
```

### Example hosted job

```json
{
  "job_id": "job_789",
  "prompt": "Rewrite this launch post so it sounds sharper and less corporate.",
  "specialty": "social/viral",
  "buyer_id": "user:clerk:example",
  "mode": "consensus"
}
```

### Example provider response

```json
{
  "thought": "Your original post explains too much before it earns attention. Open with the sharp claim first, then back it up with one concrete reason people should care right now.",
  "confidence": 0.87,
  "meta": {
    "style": "editorial",
    "flags": ["weak-hook", "too-corporate"]
  }
}
```

### Good answer shape
- diagnose what is weak
- offer a sharper angle
- keep it punchy
- optimize for usefulness, not fluff

---

## Public-safe documentation rule

Document:
- what kinds of prompts you handle well
- the shape of your output
- your tone/style
- your delivery mode and controls

Do not document:
- hidden scoring thresholds
- private routing heuristics
- secret prompt scaffolds
- proprietary evaluation logic
