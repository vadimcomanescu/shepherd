---
name: zero-context-planning
description: Use whenever you are writing a plan, unit, or task brief that a fresh-context agent or stranger must execute without access to your context. Also use when reviewing an existing plan for completeness gaps a zero-context reader would encounter.
---

Read this skill before authoring any plan, unit, or task brief — the same way
`CLAUDE.md` mandates reading `docs/workflows/README.md` before any workflow
work. A plan that a fresh agent cannot follow in isolation is a coordination
liability.

*Source: trycycle*

## Write for a skilled stranger with zero repo context

- Your reader is competent but has never seen this codebase. Do not rely on
  shared mental models, channel memory, or conversational context from
  earlier in this session.
- Assume questionable test taste: the agent will write what the plan says.
  If the plan is silent on test quality or coverage expectations, the agent
  fills the gap with its own defaults, which may be minimal or wrong.
- Every constraint, pattern, or naming rule the reader must follow must be
  stated in the brief itself or in a file the brief explicitly points to.

## Use exact repo-relative paths

- Never say "the utility file" or "the existing helper". Write
  `workflows/nadia-plan.mjs` or `agents/reviewer.md` — the exact path from
  the repo root.
- When a directory matters (test location, output destination), name it
  explicitly: `workflows/` holds coordinator scripts; `agents/` holds
  persona definitions.
- If you reference a path that does not exist yet, say so: "create
  `skills/foo/SKILL.md` (new file)".

## Cite patterns by path, not by description

- Point at a concrete file to mirror. For example: "mirror the frontmatter
  format in `skills/validating-agent-improvements/SKILL.md`" is actionable.
  "Follow the existing skill format" is not.
- One cited file per pattern is enough. If there are multiple valid
  exemplars, name the best one and say why it is the best.
- Do not paraphrase a pattern you can point at. Paraphrase introduces drift.

## Record decisions, not code

- The plan's job is to record what to do and why, not to pre-write the
  implementation. Write the decision ("use `pipeline()` because stages are
  independent and sequential") rather than the implementation ("add
  `pipeline([agentA, agentB])`").
- Pre-written code in a plan is both wrong (it will be stale) and harmful
  (the agent copies it instead of thinking). Reserve code snippets for
  disambiguation of interface shape only.
- If you find yourself writing more than a function signature or a YAML
  key, move it to a note and label it "illustrative only — do not copy".

## Surface unknowns explicitly

- Execution-time unknowns (values only knowable at runtime, e.g. the
  current branch name, a dynamic file count) belong in the agent prompt
  with a deferred placeholder: "pass the actual branch name here at
  dispatch time".
- Design-level unknowns must surface in the plan, not hide inside a
  sub-unit. If you are uncertain whether X is the right approach, write
  "open question: X or Y — choose X unless the test gate fails, then
  escalate". Burying the uncertainty in a unit means it emerges as a
  surprise failure instead of a visible decision point.
- Never write "TBD" without also writing who is responsible for resolving
  it and what the fallback is if it stays unresolved.
