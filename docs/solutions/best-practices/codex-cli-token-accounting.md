---
title: Codex CLI's printed token count understates real usage ~6.5x — read the session jsonl
date: 2026-06-10
category: best-practices
module: codex-integration
problem_type: best_practice
component: tooling
applies_when:
  - "Measuring cost or token usage of codex exec dispatches"
  - "Comparing codex against Claude executors on cost"
severity: medium
tags: [codex, token-accounting, cost-measurement, dogfood]
---

# Codex CLI's printed token count understates real usage ~6.5x — read the session jsonl

## Context

While A/B-measuring codex gpt-5.5 against Claude executors, `codex exec`'s
final "tokens used" line reported 72,835 while the true total was 476,419.
Cost comparisons built on the printed number are wrong by the cached-input
share, which dominates in agentic loops.

## Guidance

The printed "tokens used" equals **uncached input + output only**. Full usage
lives in the session log:

```bash
# Newest session for today; pick the one matching your prompt (grep for a phrase)
f=$(grep -l "<phrase from your prompt>" ~/.codex/sessions/$(date +%Y/%m/%d)/*.jsonl | tail -1)
jq -r 'select(.payload.info.total_token_usage != null) | .payload.info.total_token_usage
       | [.input_tokens, .cached_input_tokens, .output_tokens, .reasoning_output_tokens, .total_tokens] | @tsv' "$f" | tail -1
```

Fields: `input_tokens` (total incl. cached), `cached_input_tokens`,
`output_tokens` (incl. `reasoning_output_tokens`), `total_tokens`. Verified:
printed number == (input − cached) + output, exactly.

## Why This Matters

In measured runs, cached input was 85–95% of codex's total tokens (e.g. 1.14M
of 1.22M on an xhigh run). Accounting only the printed number makes codex look
~6.5× cheaper than it is at API-equivalent rates, which corrupts any
routing-policy decision based on it. (On a ChatGPT subscription the marginal
cost is $0 either way — but the token churn still predicts wall time.)

## When to Apply

Any time codex usage feeds a cost model, routing decision, or A/B comparison.

## Examples

Dogfood ledger rows 1, 4, 7, 15, 21 in `dogfood/LEDGER.md` (PR #22) record
both numbers side by side.
