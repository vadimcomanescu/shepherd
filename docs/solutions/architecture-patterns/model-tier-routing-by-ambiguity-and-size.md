---
title: Route model tiers by ambiguity x size; escalate verification (not just model) on risk
date: 2026-06-10
category: architecture-patterns
module: nadia-deliver
problem_type: architecture_pattern
component: development_workflow
applies_when:
  - "Choosing a model tier (haiku/sonnet/opus/fable) for an agent dispatch"
  - "Designing executor-routing rubrics for agent pipelines"
severity: high
tags: [routing, model-selection, cost-optimization, verification, executor-router]
---

# Route model tiers by ambiguity x size; escalate verification (not just model) on risk

## Context

A 26-dispatch measurement program (dogfood ledger, PR #22) A/B-tested haiku,
sonnet, opus, fable, and codex gpt-5.5 across six feature classes, then
validated the resulting rubric with a back-test and 8 live-routed units.

## Guidance

1. **Ambiguity × size pick the tier, not the risk label.** Well-specified
   small diffs (≤ ~3 files / ~150 lines): haiku matched bigger models 4-for-4
   at the lowest cost. Open design decisions: opus won a blind grading 7.5/8
   vs haiku's 4.5/8 at equal wall time. Risk-labeled-but-tightly-specified
   tasks did NOT separate tiers functionally.
2. **Risk escalates the verification tier.** On auth work, haiku and sonnet
   tied 7/7 on functional checks; only a blind security review separated them
   (6.5 vs 4.0 — haiku shipped a length-leaking "constant-time" comparator).
   A risk-surface dispatch needs sonnet minimum PLUS a review pass; functional
   gates alone will wave through subtle defects.
3. **Fable is planning-tier only.** Measured on a hard migration plan: fable
   8.0/8 vs opus 6.0/8 blind, at 1.7× cost — it caught a real soundness gap
   and grounding discrepancies opus missed. The premium pays where plan errors
   cascade into execution; never spend it on execution itself.
4. **Codex gpt-5.5's niche:** mechanical pattern-clones with sandbox-safe
   verification, in parallel waves that absorb its 4–5× wall time. Effort
   `high` never beat `medium`; reserve `xhigh` for cross-cutting work.

## Why This Matters

The live-routed validation built an entire multi-user feature (8 units) for
~$2.19 with zero rework — every unit on the cheapest tier that produced
correct code. The default before this change (executors inherit the session
model) silently ran every unit-executor on the session's model, e.g. Fable 5.

## When to Apply

Any `model:` choice on an Agent/workflow dispatch; any routing rubric like
`agents/executor-router.md` (see PR #21 for the implementation).

## Examples

`dogfood/LEDGER.md` — executive summary, findings 1–22, final routing table.
