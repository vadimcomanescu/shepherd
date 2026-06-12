---
title: "Distinguish normative from illustrative lists in origin-coverage prompts"
date: 2026-06-12
category: best-practices
module: nadia-plan
problem_type: best_practice
component: documentation
severity: medium
applies_when:
  - "Writing a completeness-checker agent that walks an origin document section by section"
  - "An origin doc contains lists of alternative approaches, example options, or candidate selections"
  - "The plan deliberately selects a subset of the list and omits the rest"
tags: [origin-coverage, completeness-checker, agent-prompts, false-positives, nadia-plan]
---

# Distinguish normative from illustrative lists in origin-coverage prompts

## Context

The `nadia-plan` workflow runs an origin-coverage agent that walks each section
of the origin document and checks whether the generated plan addresses every
coverage unit. When the origin section contains a list, the agent must decide
whether each list item is an individual coverage unit or whether only the overall
section matters.

Without an explicit distinction, a coverage agent treats every list item as a
normative requirement. This causes false positives: when an origin doc lists
multiple candidate approaches and the plan deliberately selects one, the agent
reports every unselected option as an omission.

This was discovered during the `refactor-nadia-plan-v2-fleet-sovereignty` review
pass. The origin-coverage prompt's `R13` rule said "each list item is an
individual coverage unit" without carving out illustrative lists. A plan that
correctly selected one of several documented alternatives was flagged as missing
coverage for the alternatives it intentionally did not choose.

## Guidance

In origin-coverage agent prompts, explicitly distinguish two kinds of lists:

**Normative lists** — principles, rules, requirements, decisions, lessons learned.
Each item is a requirement that the plan must address. A section marked
"addressed" while specific normative items remain untraced is an omission.

**Illustrative lists** — alternative approaches, candidate options, background
examples where only some items are intended as requirements. A plan that
deliberately selects a subset of such a list is satisfying the intent; unselected
items are intentional non-requirements, not omissions.

The production fix to `workflows/nadia-plan.js` (commit `7df2cb8`):

```
Before:
When an origin section contains a list (principles, lessons, rules, examples),
each list item is an individual coverage unit — do not judge the whole section
"addressed" if member items were not individually traced to the plan.

After:
When an origin section contains a normative list (principles, lessons, rules,
requirements, decisions), each list item is an individual coverage unit — do not
judge the whole section "addressed" if member items were not individually traced
to the plan. A section marked "addressed" while specific normative list items
are unaddressed is an omission. Exception: illustrative lists (alternative
options, candidate approaches, background examples where only some items are
intended as requirements) are NOT individual coverage units — if the plan
deliberately selects a subset of such a list, the unselected items are
intentional non-requirements, not omissions.
```

## Why This Matters

Without the carve-out, every origin document that presents design alternatives
or "you could do X, Y, or Z" examples will generate false coverage findings on
every plan that makes a choice. This floods the review with noise and erodes
trust in the coverage agent's verdicts — reviewers start ignoring findings.

The distinction is also load-bearing for plan quality: a plan that only selects
from a set of alternatives is demonstrably complete; the coverage agent should
confirm the selection was made, not demand the plan justify every unchosen option.

## When to Apply

Any agent prompt that checks document completeness against a source that
contains lists. The same pattern applies to:

- Requirements coverage checks (stories vs examples)
- ADR option analysis (decisions vs considered alternatives)
- Brainstorm-to-plan coverage (approaches section contains candidates)

## Examples

**False positive scenario (before fix):**

Origin section:
```
## Routing approach
Options considered:
- A) Route by intent enum in coordinator
- B) Route by a dispatcher function
- C) Static switch in intake handler
```

Plan says: "Route via the coordinator's intent-enum dispatch branch (Option A)."

Before fix: coverage agent reports B and C as omissions.
After fix: agent recognizes this as an illustrative list; the plan's selection of A is sufficient coverage.

**True positive that still fires correctly:**

Origin section:
```
## Required constraints
- The plan must not exceed the 1000-agent lifetime ceiling
- Every loop must have a stop condition
- Verification must be adversarial
```

Plan omits the adversarial-verification constraint entirely.

After fix: agent still reports "adversarial verification" as an omission — normative list items remain per-item coverage units.

## Related

- `workflows/nadia-plan.js` — origin-coverage prompt, `R13` rule
- `docs/solutions/architecture-patterns/pre-verification-dedup-capped-verifier-budget.md` — related pattern for completeness enforcement in the delivery pipeline
