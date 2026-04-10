# Happy Thoughts — Product Spec

Date: 2026-04-10

## Product thesis
Users waste time asking the same question to multiple AI tools and then guessing which answer to trust. Happy Thoughts should give them one blended answer for free, then charge for verification when trust matters.

Core framing:
- Consensus helps users think.
- Verification helps users trust.

## Product ladder

### Free — Consensus Answer
Users get:
- Multi-model consensus answer
- Final blended answer
- Agreement summary
- Disagreement / caveat summary
- Confidence label
- Daily capped usage

Users do not get:
- Formal fact-checking / verification pass
- Premium trust workflow
- Deep output budgets
- Long / expensive answer paths

### Paid — Verified Answer
Users get:
- Same consensus base
- Verification pass
- Contradiction detection
- Weak-claim detection
- Revised / safer final answer
- Higher plan limits
- Stronger model budget

### Higher tier later — Deep Verify / Pro
Potential additions:
- More verified answers per month
- Higher token budgets
- Stronger verification models
- Priority queue
- Later: attachments, citations, evidence extraction, exports

## User flows

### Free flow
1. User submits question
2. System runs free/cheap consensus pipeline
3. User receives blended answer + agreement/disagreement
4. UI offers upgrade CTA: "Want this checked before you trust it?"

### Paid flow
1. User submits question
2. System runs consensus pipeline
3. System runs verification pass
4. User receives:
   - verified summary
   - uncertain claims
   - suspect claims
   - revised answer
   - stronger confidence framing

## Product promises

### Free promise
Stop asking the same question to three AIs.

### Paid promise
Get the answer checked before you rely on it.

## Constraints
To protect margins and keep free viable:
- Strict daily free limits
- Token/output caps by plan
- Free-first models on free flow
- Premium verification only on paid flows
- No unlimited premium usage

## Strategic note
As paid revenue grows, Happy Thoughts can progressively fund stronger premium synthesis / verification models by topping up API credits from customer revenue.
