---
title: "feat: Per-phase dispatchCounts in the shepherd-plan run summary"
type: feat
status: active
date: 2026-06-12
---

## Summary
Add an additive `dispatchCounts` field to shepherd-plan's machine-readable run summary: a plain object mapping each of the coordinator's seven phase names (Intake, Research, Gate, Draft, Review, Gates, Finalize) to the integer number of `agent()` dispatches the coordinator made in that phase, computed in pure coordinator JS via a single wrapper over the injected `agent` binding, and pinned by deepEqual test scenarios on every major terminal path.

## Problem Frame
Today a run's agent economics are only recoverable by reading FleetView or transcripts; the summary alone cannot answer how many agents each phase cost. Operators, run auditors, and shepherd-deliver callers need per-phase dispatch counts traceable from the summary itself. `budget.spent()` is token-only and the runtime exposes no per-phase agent counter, so the field is genuinely new.

## Requirements
R1. Every terminal summary return from `workflows/shepherd-plan.js` — the ready path and every halted path — includes a `dispatchCounts` field: a plain object with exactly seven integer keys matching the `meta.phases` titles (Intake, Research, Gate, Draft, Review, Gates, Finalize), with phases never reached reported as 0.
R2. Each `dispatchCounts` value equals the number of `agent()` invocations the coordinator made carrying that `opts.phase` string. Every invocation counts as one dispatch, including retry calls (e.g. `check-*-retry`, `parse-plan-retry`) and dispatches that resolve null (agent death).
R3. Counting happens in pure coordinator JS — no I/O, no new `agent()` calls for counting itself — implemented as one wrapper over the injected `agent` binding, installed before the first dispatch and before any roster thunk is defined, with zero per-call-site edits across the ~37 `agent()` call sites.
R4. The field is additive to the existing summary contract: no existing field is removed, renamed, or reshaped. `dispatchCounts` is merged at exactly one point — the `summary()` builder (`workflows/shepherd-plan.js`, currently line 396) — so every terminal return carries it without per-return edits.
R5. All 49 pre-existing scenarios in `workflows/shepherd-plan.test.mjs` keep passing, and `node workflows/shepherd-plan.test.mjs` exits 0.
R6. New test scenarios pin `dispatchCounts` by deepEqual of the full seven-key object with exact integer values on at least five terminal paths: the happy-path ready return, the S0 trivial-request halt, the intake-schema-rejection halt, the draft-halt path, and one variant research path that dispatches extra researchers (e.g. mixed research intent).

## Key Technical Decisions
- One agent-binding wrapper keyed on `opts.phase`, not per-call-site increments and not phase()-state tracking: the coordinator has ~37 `agent()` call sites, including `runChecker`'s dynamic `phaseName` parameter (line 1153) and `ctx.phase` helpers — per-call-site increments would be a large, fragile diff and would miss future call sites by default (the documented intake-enum learning shows unexercised branches pass tests silently). Every call site already carries `opts.phase` as a string (the FleetView-grouping contract, convention 12), so keying the increment on `opts.phase` is direct, attribution-correct even for dispatches fired from inside `pipeline()`/`parallel()` thunks, and immune to in-flight overlap with a later `phase()` call. Shadowing `phase()` to track a "current phase" was rejected as indirect and wrong under any overlap. The wrapper rebinds the injected `agent` parameter (`agent = wrapped(realAgent)`) before the first dispatch at line 408, so every later reference — including thunks defined afterward — flows through it.
- Seven zero-filled keys initialized from phase titles, not lazily created and not the six-key set from intake research: the intake recommendation omitted Gate, which carries exactly one dispatch (the strategy agent, line 693 `{ label: 'strategy-gate', phase: 'Gate' }`); a six-key map would silently drop a phase. Zero-filling before `phase('Intake')` makes the object shape stable on every terminal path including early halts, honoring the summary's "all fields always present" convention (convention 8) and enabling full-object deepEqual pins. The test harness rewrites `export const meta` to `const meta` (`workflows/shepherd-plan.test.mjs` line 9), meaning the coordinator body can reference `meta.phases` inside the harness; however, whether the live production runtime exposes `meta` as an in-scope binding to the coordinator body is unverified against the runtime docs or a live run. To avoid betting the run on unverified production scoping, implementation MUST use a local literal array `const PHASE_TITLES = ['Intake', 'Research', 'Gate', 'Draft', 'Review', 'Gates', 'Finalize']` for the zero-fill, and the test harness MUST add an assertion that `PHASE_TITLES` deepEquals `meta.phases.map(p => p.title)` (or the equivalent accessor) — ensuring the literal cannot drift from `meta.phases` without the harness catching it, achieving the no-drift goal without relying on production `meta` scoping.
- A stray `opts.phase` outside `meta.phases` increments a new key rather than being dropped or throwing: dropping would hide a real dispatch (against the no-silent-caps principle); throwing is forbidden outside the preflight zone (the coordinator's only throw zone, lines 16–35). The stray key surfaces immediately as a deepEqual shape mismatch in the full-object test pins. Verified today: every existing call site's phase string is a `meta.phases` title.
- Count semantics are raw `agent()` invocations: retries and null-resolving deaths each cost a real dispatch, so each counts as one. Budget-ceiling runtime throws never produce a summary and are out of scope. Successful-completion or logical-attempt counts were rejected — they answer a different question than "what did this run dispatch".
- Single merge point in the `summary()` builder: spreading `dispatchCounts` into the fixed field set at line 396–401 keeps the additive-contract constraint trivially auditable (one-line diff to the contract surface) versus editing each terminal return.

## Implementation Units

### U1. Dispatch accounting wrapper and summary field
**Goal**: The coordinator counts every `agent()` dispatch per phase in pure JS and every terminal summary carries the seven-key `dispatchCounts` object.
**Requirements**: R1, R2, R3, R4, R5
**Dependencies**: none
**Files**: `workflows/shepherd-plan.js`, `workflows/shepherd-plan.test.mjs`
**Approach**: In `workflows/shepherd-plan.js`, near the coordinator-state declarations (lines 380–391, before `phase('Intake')` at line 406 and before the first `agent()` call at line 408): initialize a `dispatchCounts` object zero-filled from the `meta.phases` titles, then rebind the injected `agent` parameter to a wrapper that increments `dispatchCounts[opts.phase]` (creating the key if absent) and delegates to the original binding with identical arguments and return value — preserving null-on-death semantics untouched. Add `dispatchCounts` to the spread in the `summary()` builder (line 396–401) without touching any existing field. In `workflows/shepherd-plan.test.mjs`, extend the harness agent shim (line 18–19) to also record `opts.phase` in `trace.calls` entries (additive trace field, no existing assertion touched), and append one new scenario before the runner block (line 1614) pinning the happy-path ready return: deepEqual the full seven-key `dispatchCounts` object with exact integers, plus a cross-check that the values sum to `trace.calls.length` (guards against vacuous assertions per the verification-scripts-need-sanity-checks learning).
**Patterns to follow**: state-declaration block and `summary()` builder shape at `workflows/shepherd-plan.js` lines 380–401; scenario authoring convention `S('SNN …', async () => { … return 'note' })` in `workflows/shepherd-plan.test.mjs`; structural-pin style of existing count assertions (`count(trace, prefix)` helpers).
**Test scenarios**:
- Happy-path ready run: the returned summary's `dispatchCounts` deepEquals the full seven-key object with exact integer values, every key a `meta.phases` title, and the values sum to the total number of recorded `agent()` calls (`trace.calls.length`).
- Ready-run summary still contains every pre-existing field (status, planPath, planVersion, depthTier, unitCount, requirementCount, roundsUsed, personaRoundsUsed, residualFindings, narrowedScope, openQuestions, committed, hygieneClean, haltStage, haltReason, nextStep, directPrompt) with unchanged values — additive contract observed.
- All 49 pre-existing scenarios pass without modification to their assertions.
**Verification**: `node workflows/shepherd-plan.test.mjs` exits 0 with 50 scenarios passing (49 pre-existing + 1 new); the new scenario's deepEqual pins exact per-phase integers including `Gate: 1`.

### U2. Terminal-path count pins for halts and variant research
**Goal**: The `dispatchCounts` accounting is pinned as a tested invariant on the halt paths and a variant research branch, per the accounting-invariant learning.
**Requirements**: R2, R5, R6
**Dependencies**: U1
**Files**: `workflows/shepherd-plan.test.mjs`
**Approach**: Append scenarios (before the runner block) that deepEqual the FULL seven-key `dispatchCounts` object — never a single spot-checked key — on: the S0 trivial-request halt (Intake counted, all later phases 0), the intake-schema-rejection halt, the draft-halt path, and one variant research path whose intake fixture sets a research intent that dispatches extra researchers (e.g. `mixed`), pinning the higher Research count. Derive each scenario's expected integers from the dispatcher fixtures it wires (the dispatcher controls exactly which agents run), and include the values-sum-equals-`trace.calls.length` cross-check in each. Reuse the existing dispatcher/fixture machinery (`makeDispatcher`, `INTAKE()`, label-prefix overrides) rather than building new harness plumbing.
**Patterns to follow**: existing halt-path scenarios in `workflows/shepherd-plan.test.mjs` (S0 trivial halt, intake-rejection, draft-halt scenarios) for dispatcher wiring; the deepEqual-full-stats-object pattern documented at `docs/solutions/architecture-patterns/pre-verification-dedup-capped-verifier-budget.md` section 8.
**Test scenarios**:
- S0 trivial-request halt: summary carries all seven keys; phases after the halt point are exactly 0; Intake equals the dispatches actually made before the halt.
- Intake-schema-rejection halt: the rejected intake dispatch (and any retry the coordinator makes) still counts; later phases are 0.
- Draft-halt path: Intake/Research/Gate/Draft carry positive integers matching the scenario's dispatcher; Review/Gates/Finalize are 0.
- Mixed-research-intent ready run: Research strictly exceeds the default-path Research count from U1's happy-path pin, with the exact integer pinned.
- In every new scenario, the seven values sum to `trace.calls.length` — no dispatch escapes the accounting.
**Verification**: `node workflows/shepherd-plan.test.mjs` exits 0 with all scenarios (49 pre-existing + U1's + these) passing; each new scenario asserts via `assert.deepEqual` on the whole `dispatchCounts` object with literal integers.

## Scope Boundaries
- No changes to `workflows/shepherd-deliver.js` or any other consumer of the run summary — consumers pick the field up when they choose to.
- No FleetView or transcript tooling changes.
- No token or cost accounting — `budget.spent()` already exists and is untouched.
- No per-agent labels, models, or timing beyond the per-phase integer counts.
- No distinction between fresh and replayed (deterministic-resume cached) dispatches — pure coordinator JS cannot tell them apart, and both increment identically.
- No behavioral change to any dispatch, halt path, or existing summary field in `workflows/shepherd-plan.js` — the wrapper delegates transparently and the only contract delta is the one additive field.

### Deferred to Follow-Up Work
- Pinning the remaining halt paths (Review-halt, Gates-halt, hygiene-halt variants) individually — under the lightweight tier they inherit correctness from the single-wrapper mechanism plus the five pinned paths.
- Surfacing `dispatchCounts` in shepherd-deliver's consumption of the summary, if a consumer ever wants to act on it.

## Assumptions
- The dispatchCounts keys are the coordinator's actual `phase()` literals (Intake, Research, Gate, Draft, Review, Gates, Finalize — `workflows/shepherd-plan.js` lines 406, 540, 676, 718, 867, 1714, 1998), all seven pre-seeded to 0, not the six-key approximation (ending in "Hygiene") from the original request — invalidated when: the requester insists on exactly the six listed keys or supplies an explicit rename map (e.g. Finalize must be reported as Hygiene).
- Wrapping the injected `agent` binding once covers every call site with zero per-site edits and without breaking the runtime contract — invalidated when: the wrapper breaks documented runtime semantics in the deterministic harness (e.g. null-on-death behavior or existing `trace.calls`/`trace.phases` assertions in `workflows/shepherd-plan.test.mjs` fail).
- Dispatches fired from inside `pipeline()`/`parallel()` thunks attribute to the correct phase because every call site passes its own `opts.phase`, independent of which top-level phase is "current" — invalidated when: a test scenario demonstrates a dispatch whose `opts.phase` differs from the phase that semantically owns it, producing a count attributed to the wrong phase.
- Every `agent()` call site passes an `opts.phase` string that is a member of the `meta.phases` titles (verified today: static literals plus `runChecker`'s `phaseName` and `ctx.phase` resolve only to Review/Gates) — invalidated when: a future call site passes a phase string outside `meta.phases`; the deepEqual full-object pins surface the stray key as a shape mismatch.
- Counting coordinator-side `agent()` invocations is the correct definition of "dispatches made", including on deterministic resume where replayed calls return cached results but increment identically — invalidated when: a consumer needs fresh-execution counts excluding replayed/cached dispatches, which pure coordinator JS cannot distinguish.
- Retry invocations (`check-*-retry`, `parse-plan-retry`, etc.) and dispatches whose agent dies (resolves null) each count as one dispatch, since each is a real `agent()` call with real cost — invalidated when: downstream consumers expect logical-attempt or successful-completion counts rather than raw agent-call counts.
- Pinning the full seven-key object on five terminal paths (ready, S0 trivial halt, intake-rejection halt, draft halt, one variant research path) is sufficient under the lightweight tier; remaining halt paths inherit correctness from the single-wrapper mechanism — invalidated when: a count regression appears on an unpinned halt path, indicating per-path pinning is needed despite the centralized wrapper.

## Open Questions
- **Stray-phase-key detection overclaims**: The plan's safety argument for choosing increment-a-new-key over dropping or throwing relies on the claim that deepEqual pins surface any stray key as a shape mismatch. This only holds when the stray call site executes on one of the five pinned terminal paths. The plan itself cites the intake-enum learning ('unexercised branches pass tests silently'), and the Deferred section explicitly leaves the remaining halt paths unpinned. A stray dispatch on an unpinned path (e.g. a Review-halt or Gates-halt variant) would not be caught by any deepEqual assertion. Whether the five pinned paths together cover all call sites that could realistically produce a stray key remains unverified.
- **U1 scenario count discrepancy**: U1's Approach describes adding "one new scenario" and Verification pins the count at "50 scenarios passing (49 pre-existing + 1 new)". However, U1's Test scenarios block lists two distinct new behavioral pins: (1) the dispatchCounts deepEqual and (2) a separate additive-contract check that the ready-run summary still contains every pre-existing field with unchanged values. If two scenarios are actually added in U1, the total after U2 would be 49 + 2 + 4 = 55 (or a different number), not the 50 stated in U1's Verification. The implementation unit should reconcile whether the additive-contract check is a separate scenario or an assertion within the same scenario, and update the passing-count claim accordingly.

## Deferred to Implementation
- Exact placement line of the zero-fill + wrapper inside the state-declaration block (anywhere after the `summary()` builder's closure variables are declared and before `phase('Intake')` at line 406 works; pick the spot that reads best next to the other accumulators).
- New scenario numbers (next free SNN values after the current S49) and their one-line success notes.
- Whether the variant-research pin uses `mixed` intent or `version-specific framework` — either exercises an extra-researcher branch; pick whichever existing fixture wiring is shorter.
- The literal expected integers in each pin — derived at implementation time from each scenario's dispatcher wiring, then sanity-checked against the sum-equals-`trace.calls.length` invariant before being recorded.
