---
name: test-strategy
description: Use whenever you are deciding what to test, choosing mock or stand-in strategy per dependency, deriving test scenarios from requirements, or reviewing whether verification effort matches risk.
---

Read this skill before writing test plans, test scenarios, or verification
strategy. Treat it like the workflow README consumption pattern: load the
doctrine before acting, then let the specific repo decide commands and files.

## Pick the test surface

- The interface is the test surface; never test past it.
- Test the behavior the caller is allowed to observe, not the private path
  that happens to produce it today.
- If a test must inspect internals to make an assertion, either the interface
  is missing an observable contract or the test is reaching too far.
- Preserve refactor freedom by pinning only public inputs, actions, outcomes,
  emitted events, persisted state, return values, or documented errors.
- source: mattpocock DEEPENING

## Pick the dependency strategy

- The dependency category picks the strategy; do not choose mocks by habit.
- in-process -> test through the interface.
- local-substitutable -> stand-in.
- remote-owned -> port + in-memory adapter.
- third-party -> injected mock.
- Keep the substitution at the same boundary the production code owns.
- Do not hide contract drift with a fake that knows less than the dependency
  contract the feature depends on.
- source: shepherd-plan

## Derive scenarios

- Scenarios derive from requirements, not from implementation branches.
- Shape each scenario as input -> action -> outcome so the test explains the
  user-visible or system-visible promise it protects.
- Cover the normal path, meaningful edge cases, and failure modes named or
  implied by the requirement.
- Prefer fewer scenarios with clear outcomes over exhaustive branch tours.
- source: trycycle

## Make verification observable

- Verification must be observable: the test must watch a thing the system
  exposes, records, emits, returns, or changes.
- Use numeric checks where applicable: counts, thresholds, deltas, totals,
  timings, retries, limits, or exact amounts.
- Replace vague assertions like "works" or "improves" with measured evidence
  tied to the scenario outcome.
- If the only evidence is an agent's confidence or a log sentence, keep
  looking for an observable result.
- source: mattpocock DEEPENING, shepherd-plan

## Right-size effort to risk

- Test effort is right-sized to risk: spend more where failure is costly,
  likely, hard to notice, or hard to repair.
- Keep low-risk glue covered by a small interface test instead of elaborate
  harnesses.
- Escalate verification when behavior crosses trust boundaries, mutates
  durable state, controls money or access, or coordinates multiple agents.
- Use the lightest test that would have failed for the bug or requirement miss
  you are trying to prevent.
- source: trycycle, shepherd-plan
