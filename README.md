# Happy Thoughts

Free consensus answers first. Paid verification when trust matters.

## Product Modes

### Consensus
- Public/default answer mode
- Multi-answer comparison + synthesis
- Intended for free/capped usage tiers
- Returns one blended answer with confidence and caveats

### Verified
- Paid trust layer
- Runs additional verification / fact-check style review
- Intended for higher-stakes prompts
- Returns revised answer + verification metadata

## Current Consensus v1 Stack

The consensus stack is now runtime-configurable through env vars, so provider/model swaps stay surgical instead of turning into worker surgery.

### First-response panel
- Cerebras — `CEREBRAS_MODEL` (default `llama3.1-8b`)
- Mistral — `MISTRAL_MODEL` (default `mistral-small-latest`)
- Google Gemma — `GEMMA_MODEL` (default `gemma-4-31b-it`)

### Synthesis layer
- Google Gemini — `GEMINI_SYNTHESIS_MODEL` (default `gemini-2.5-flash`)
- Mistral fallback — `MISTRAL_SYNTHESIS_MODEL` (defaults to `MISTRAL_MODEL`)

## Reliability Rules

Consensus mode is designed to degrade gracefully.

- If all panel models succeed, confidence can remain high.
- If one panel model fails, the request should still complete and confidence should be reduced.
- If two panel models fail, the request should still return the best available degraded answer when possible, with lower confidence.
- If every panel model fails, the request fails.

Model failures must be surfaced to the caller through:
- `confidence`
- `confidence_reason`
- `models_failed`
- `meta.degraded`
- `meta.failure_count`

## Billing / PayPal flow

Paid plans support two paths:
- x402 for agent-native / onchain activation
- PayPal for normal human checkout

PayPal flow:
1. `POST /paypal/create-order`
2. buyer approves on PayPal
3. frontend/server calls `POST /paypal/capture-order`
4. entitlement activates only after capture completes
5. `POST /paypal/webhook` is accepted as an idempotent completion path for capture-completed events

Required PayPal config:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`

Optional:
- `PAYPAL_ENV` = `sandbox` | `live`
- `PAYPAL_API_BASE` for tests/overrides

## API Shape

### `POST /think`
Required fields:
- `prompt`
- `buyer_wallet`

Optional fields:
- `specialty`
- `mode` (`consensus`, `verified`, or `quick` for compatibility)
- `min_confidence`

### Common response fields
- `thought_id`
- `answer_mode`
- `thought`
- `specialty`
- `price_paid`
- `cached`
- `confidence`
- `confidence_reason`
- `models_used`
- `models_failed`
- `response_time_ms`
- `disclaimer`
- `meta`

### Consensus meta fields
- `structured.agreement`
- `structured.disagreements`
- `structured.blended_answer`
- `structured.confidence`
- `degraded`
- `failure_count`
- `failed_providers`
- `providers`
- `synthesis_model`
- `synthesis_provider`

## Provider supply still exists

The public product is now framed as Consensus + Verified, but bots and humans can still register and supply answers underneath through hosted/webhook provider flows.

## Internal Testing Route

### `POST /internal/consensus`
Owner-only route for validating the consensus pipeline and storing lineage.

Each internal consensus run stores:
- prompt
- specialty
- panel outputs
- synthesis output
- structured result
- degraded/failure metadata
- final answer
