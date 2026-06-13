---
title: "Adding an intake enum value requires a matching coordinator dispatch branch"
date: 2026-06-12
category: logic-errors
module: shepherd-plan
problem_type: logic_error
component: development_workflow
symptoms:
  - "A research intent option is described in the intake prompt but never triggers its researcher"
  - "The merged persona's Path B or alternate code path is dead — never reachable at runtime"
  - "Tests pass because the intent value is simply not exercised by any scenario"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags: [coordinator, intake-schema, dispatch-routing, dead-code, shepherd-plan, enum]
---

# Adding an intake enum value requires a matching coordinator dispatch branch

## Problem

The `shepherd-plan` coordinator uses a JSON schema (`INTAKE_SCHEMA`) to classify
the incoming request, with a `research.intent` enum that controls which
researcher agent is dispatched. When a new intent value (`version-specific
framework`) was added to the merged `external-grounding-researcher` persona's
documentation as "Path B", neither the INTAKE_SCHEMA enum nor the coordinator's
dispatch `if/else if` chain was updated to match.

The feature was described in the agent persona file (`agents/external-grounding-researcher.md`)
and referenced in the plan's design documents, but the intake schema would reject
the new value (as an invalid enum), and even if it accepted it, the coordinator
had no branch to route it — the intake classifier could never select it and the
researcher could never be dispatched via that path.

## Symptoms

- Agent persona documents describe a capability ("Path B: version-pinned
  framework docs") that cannot be triggered by any real request.
- The intake prompt does not mention the new intent value, so the classifier
  never learns to select it.
- Tests pass silently because no scenario exercises the unreachable branch.

## What Didn't Work

Adding the dispatch logic to the persona file alone is not sufficient — the
coordinator's intake schema enum is the canonical list of valid intents. The
persona file is instructions for the agent, not the routing logic.

## Solution

Three changes together make a new intent value fully reachable (commit `7df2cb8`
for the coordinator; earlier commits for the persona):

**1. Add the value to `INTAKE_SCHEMA.research.intent` enum:**

```js
// Before
intent: { type: 'string', enum: ['implementation-guidance', 'landscape', 'mixed', 'none'] }

// After
intent: { type: 'string', enum: ['implementation-guidance', 'landscape', 'mixed', 'version-specific framework', 'none'] }
```

**2. Add intake-prompt guidance so the classifier knows when to select it:**

```
// Added to the intake agent's prompt:
recommend version-specific framework when the request targets a specific
version-pinned library or framework and requires version-matched documentation
(e.g. "use Next.js 16 cache components", "upgrade to Rails 8.1");
```

**3. Add the dispatch branch in the coordinator:**

```js
// Before: no branch for 'version-specific framework'
} else if (intake.research.intent === 'landscape') {
  researchRoster.push(webResearcher('landscape'))
} else if (intake.research.intent === 'mixed') {

// After:
} else if (intake.research.intent === 'landscape') {
  researchRoster.push(groundingResearcher('landscape'))
} else if (intake.research.intent === 'version-specific framework') {
  researchRoster.push(groundingResearcher('version-specific framework'))
} else if (intake.research.intent === 'mixed') {
```

## Why This Works

The coordinator's `if/else if` chain is the canonical routing table. The INTAKE_SCHEMA
enum is the canonical list of valid classifier outputs. The intake prompt
guidance is what tells the classifier to select the value. All three must be
consistent for a dispatch path to be reachable.

A feature described only in an agent persona file is documentation, not routing.
The coordinator does not read agent persona files — it only consults the intake
schema and dispatch logic it embeds directly.

## Prevention

When adding a new research intent or dispatch variant to a coordinator-based workflow:

1. Update the intake schema enum first — this is the contract.
2. Update the intake prompt's guidance paragraph — this is what the classifier reads.
3. Add the coordinator dispatch branch — this is what actually routes the call.
4. Add a test scenario that passes the new intent value and asserts the correct
   agent type and routing appear in the trace. A `scriptSrc` pin alone is not
   sufficient — it only asserts the code exists, not that it is exercised.

The three changes are atomic: missing any one of them leaves the feature
unreachable or the schema inconsistent.

## Related Issues

- `workflows/shepherd-plan.js` — INTAKE_SCHEMA enum and dispatch chain
- `agents/external-grounding-researcher.md` — Path B doctrine (version-specific framework)
- `workflows/shepherd-plan.test.mjs` — S40/S42 persona-on-disk pins that exercise agent routing
