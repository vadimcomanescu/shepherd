---
title: "Guard agent persona rules that reference optional external resources"
date: 2026-06-12
category: logic-errors
module: nadia-plan
problem_type: logic_error
component: documentation
symptoms:
  - "Agent flags domain terms as undefined even when no glossary exists in the repo"
  - "Review findings fire on repos that legitimately omit a CONTEXT.md or glossary file"
  - "Agent rules apply unconditionally but the source they check may be absent"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
tags: [agent-rules, plan-editor, domain-terms, glossary, nadia-plan, precondition-guard]
---

# Guard agent persona rules that reference optional external resources

## Problem

`agents/plan-editor.md` contained an `undefined-new-domain-term` rule that
flagged every term introduced by the plan that did not appear in `CONTEXT.md`.
The rule applied unconditionally — it ran whether or not the repo had a
`CONTEXT.md` at all, and whether or not the agent's `CODEBASE_CONTEXT`
variable showed a real glossary path.

In repos without a domain glossary, every term derived from file paths, ADRs,
READMEs, or the origin document itself would be flagged as an undefined term.
The result: the plan-editor blocked plans that were otherwise correct, on repos
that had no glossary to violate.

## Symptoms

- Plan-editor returns `NOT_READY` citing multiple undefined domain terms.
- The repo has no `CONTEXT.md` (or the `CODEBASE_CONTEXT` block shows "none detected").
- Terms flagged are derived from source paths, README sections, or ADR vocabulary
  that is well-established in the codebase but not in a formal glossary.

## What Didn't Work

Removing the rule entirely would suppress legitimate findings in repos that do
maintain a domain glossary — not acceptable.

## Solution

The fix in `agents/plan-editor.md` (commit `ccfba3e`) guards the rule with a
no-glossary conditional:

```
Before:
- undefined-new-domain-term: the plan introduces vocabulary absent from
  CONTEXT.md and the repo's ubiquitous language — grounded in the DDD thread
  of skills/interface-design and skills/decomposition; flag every term that
  has no entry in CONTEXT.md before recommending READY

After:
- undefined-new-domain-term: the plan introduces vocabulary absent from
  CONTEXT.md and the repo's ubiquitous language — grounded in the DDD thread
  of skills/interface-design and skills/decomposition; apply only when the
  Domain glossary block in CODEBASE_CONTEXT shows a real path (not "none
  detected"); when no glossary exists, terms derived from source paths, READMEs,
  ADRs, or the origin document are presumed valid and must not be flagged
```

The guard makes the rule conditional on the `CODEBASE_CONTEXT` variable that
the coordinator injects into the agent prompt, which already includes a "Domain
glossary" line set to either the real path or "none detected".

## Why This Works

Agent rules that check an optional external resource (a glossary, a schema file,
a configuration) must not assume the resource exists. When the coordinator
injects context that already describes the presence/absence of optional files,
the rule can consult that injected context as its precondition before firing.

The pattern generalizes: any agent rule of the form "check that X is consistent
with Y" should first verify that Y is present in the injected context. If Y is
absent, the rule should either skip silently or acknowledge the absence without
blocking.

## Prevention

When writing agent persona rules that reference optional files or resources:

1. Identify whether the referenced resource is always present or optionally
   present in the project.
2. If optional, add an explicit "apply only when ..." guard on the rule using
   a field the coordinator already injects (e.g., `CODEBASE_CONTEXT`,
   `ORIGIN`, `EXTERNAL_RESEARCH`).
3. Specify the fallback behavior: "if absent, terms derived from X, Y, Z are
   presumed valid and must not be flagged."
4. Add a test scenario (or verbatim pin) that exercises the no-resource path
   to confirm the rule skips cleanly.

## Related Issues

- `agents/plan-editor.md` — the guarded rule
- `workflows/nadia-plan.test.mjs` — S44 byte-pin verifies the verdict-correctness block (commit `c5e0b9f`)
