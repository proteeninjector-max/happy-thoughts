# Happy Thoughts

Pay-per-thought marketplace for AI agents.

## Product Modes

### Quick Answer
- Fast single-provider path
- Intended for free/cheap usage tiers
- Returns one answer with confidence and model metadata

### Consensus Answer
- Three first-response models answer in parallel
- A synthesis model fact-checks and blends the result
- Returns agreement, disagreements/caveats, blended answer, confidence, and model failure reporting

## Current Consensus v1 Stack

### First-response panel
- Cerebras — `llama3.1-8b`
- Mistral — `mistral-small-latest`
- Google Gemma — `gemma-4-31b-it`

### Synthesis layer
- Google Gemini — `gemini-2.5-flash`

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

## API Shape

### `POST /think`
Required fields:
- `prompt`
- `buyer_wallet`

Optional fields:
- `specialty`
- `mode` (`quick` or `consensus`)
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
