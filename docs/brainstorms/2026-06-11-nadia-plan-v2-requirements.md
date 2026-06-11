# nadia-plan v2 — Requirements

Refactor `workflows/nadia-plan.js` (and its two personas) into a world-class planner: engrain interface-design depth (Ousterhout deep modules, design-it-twice) into the plans it produces, and slim its prompts to smarter-model steering — without touching the deterministic machinery that encodes observed live failures.

## Problem Frame

nadia-plan v1 is mechanically solid (deterministic gates, bounded loops, structured halts, ce-plan format compatibility) but falls short on two fronts:

1. **Content gap.** The plans it produces carry vertical slicing and observable verification, but no interface-design depth: no deep-module thinking, no seam/adapter vocabulary, no dependency-category-driven test strategy. Key Technical Decisions are single-shot by the author and only *challenged* after the fact (refuters/arbiters) — never *competitively generated* (design-it-twice).
2. **Prompt ceremony.** Prompt factories and personas enumerate behaviors rule-by-rule — the built-for-weaker-models style that current prompting guidance (the Fable-5 guide) identifies as degrading output on smarter models. That guidance condemns prescriptive *prompts*; it explicitly *endorses* fresh-context verifier subagents and evidence-grounded claims, so the verification architecture is not the target.

## Distilled Source Principles (carry into the plan; agents must not re-derive these)

**From the Fable-5 prompting guide:**
- Brief steering beats enumerating each behavior by name; one short instruction replaces a rule list.
- Skills/prompts developed for prior models are often too prescriptive and degrade output — remove instructions where default model behavior is better.
- Separate, fresh-context verifier subagents outperform self-critique (endorsement of the existing editor/refuter architecture).
- Ground progress claims in evidence from tool results (endorsement of the existing evidence cross-checks).

**From mattpocock improve-codebase-architecture (LANGUAGE.md / DEEPENING.md / INTERFACE-DESIGN.md) — the design vocabulary, to be used exactly:**
- **Module**: anything with an interface and an implementation (scale-agnostic). **Interface**: everything a caller must know — types, invariants, ordering, error modes, config — not just signatures. **Seam**: where an interface lives; a place behavior can be altered without editing in place. **Adapter**: a concrete thing satisfying an interface at a seam. **Depth = leverage at the interface**: a lot of behavior behind a small interface; shallow = interface nearly as complex as the implementation. **Locality**: change, bugs, and knowledge concentrate in one place.
- **Deletion test**: imagine deleting the module — if complexity vanishes it was a pass-through; if it reappears across N callers it was earning its keep.
- **The interface is the test surface**: tests cross the same seam callers do; testing past the interface means the module is the wrong shape.
- **One adapter = hypothetical seam; two adapters = real seam.**
- **Dependency categories drive test strategy**: in-process (test through the interface directly) / local-substitutable (stand-in like PGLite in the suite) / remote-but-owned (port + in-memory adapter for tests, HTTP adapter for prod) / true-external (injected mock for third-party services).
- **Design it twice**: spawn parallel designers with radically different constraints (minimize the interface / optimize for the most common caller / ports-and-adapters when cross-seam dependencies exist), then compare by depth, locality, and seam placement; give one opinionated recommendation, hybrid allowed.

**From trycycle-planning:** write plans for a skilled engineer with zero context for the codebase and questionable test-design taste — the plan supplies both. Strategy gate: low bar for changing direction, high bar for stopping to ask.

**From ce-plan:** research intent routing — implementation-guidance (approach settled, fetch best practices / version-specific framework docs) vs landscape (option set unsettled, web scan first) vs mixed (sequential: landscape first, then implementation-guidance against the shortlist only). Prose economy: one idea per sentence, cut hedges and intensifiers, precision (paths, IDs, thresholds) is not padding.

## Requirements

R1. A new Design phase runs between the strategy gate (S2) and draft (S3) for standard and deep tiers only; lightweight tier skips it with a log line. It fans out exactly 3 parallel design agents with opposed constraints — (a) deep-module: minimize the interface, deletion-test every seam; (b) optimize for the most common caller; (c) ports-and-adapters when the work has remote/third-party dependencies, otherwise flexibility/extension — followed by one judge agent that compares designs by depth, locality, and seam placement and returns a chosen/hybrid design plus KTD seeds, each with rationale and rejected alternatives.

R2. The Design phase degrades fail-open: dead design agents are filtered and logged; zero surviving designs or a dead judge logs the loss and proceeds to draft without a design block. It never halts the run.

R3. The judge's output threads into the author prompt as a delimited design-direction block; the author treats KTD seeds as the starting KTD set (may refine, must not silently drop, must carry rejected alternatives into rationale).

R4. A shared design-vocabulary block (module / interface / seam / adapter / depth-as-leverage / locality / deletion test / one-adapter-hypothetical / interface-is-the-test-surface, distilled to ~10 lines) is interpolated into the design, judge, author, and editor prompts so all speak the same language.

R5. `agents/plan-author.md` gains, within roughly its current length: zero-context-implementer framing; module-depth discipline (each unit delivers an interface; prefer few deep units over shallow pass-throughs; deletion test on forwarding units); test strategy by dependency category (in-process / local stand-in / port+adapter / third-party mock), with test scenarios stated at the unit's interface, never internal state; and design-direction KTD handling per R3. Existing load-bearing rules (U-ID permanence, vertical slices, no horizontal layering, contract-first units, risk-early ordering, oversized-unit signals, observable verification, scope-boundaries discipline) are all preserved.

R6. `agents/plan-editor.md` gains three diagnostics — shallow units (interface as complex as implementation; pass-throughs failing the deletion test), test scenarios aimed past a unit's interface, and KTD rationale missing rejected alternatives when a design-direction existed — while its verdict-correctness framing ("judged on VERDICT CORRECTNESS... unnecessary rewrite is a failure") is preserved verbatim (eval-backed).

R7. The S1 research stage re-enables `compound-engineering:ce-framework-docs-researcher` (it is present in the current agent registry; the "not in the verified agent registry" log line is stale and is removed). The intake schema's research object gains an intent classification (implementation-guidance | landscape | mixed | none) routing dispatch: implementation-guidance adds best-practices + framework-docs to the parallel roster; landscape adds web only; mixed runs web first and feeds its digest into best-practices/framework-docs via a pipeline continuation (no added barrier).

R8. Every prompt factory in the coordinator is slimmed to brief steering plus schema contract plus grounding blocks (Fable-5 style): enumerated micro-rules collapse to single sentences where one sentence carries the behavior; restatements of schema fields already described in schema `description`s are cut. Preserved verbatim: referent-explicit KTD verdict wording, GATE_AUTHORITY, protected-surface rules, the confidence-anchor rubric's anchors, and all caps language.

R9. The `meta` export's description, whenToUse, and phases array reflect the new Design phase; `phase()` titles match meta exactly.

R10. `workflows/nadia-plan.test.mjs` is extended to pin: design phase fires on standard/deep (3 designers + 1 judge) and skips on lightweight with the log line; design-direction reaches the author prompt; all-dead designers and dead judge fail open; framework-docs dispatch on implementation-guidance intent, absent on landscape, sequential ordering on mixed; the stale registry log line is gone; the vocabulary block reaches design/judge/author/editor prompts. Existing assertions pinning now-slimmed prompt text are updated to assert mechanisms, not prose. The full suite passes via `node --test workflows/nadia-plan.test.mjs`.

R11. The coordinator still satisfies all contract gates: `node --check` passes; `meta` is the first statement as a pure literal; no `Date.now()` / `Math.random()` / bare `new Date()`; no coordinator I/O; throws only in the preflight zone; every terminal path returns the structured run summary.

## Invariants (must not change — verbatim or semantically identical)

- ce-plan document format: PLAN_TEMPLATE, section catalog, frontmatter fields, U-ID/R-ID stability rules. UNITS_SCHEMA stays a byte-copy of nadia-deliver's.
- All pure-JS machinery: uidStabilityViolations, fileOverlapViolations, Kahn cycle check, paraphrase dedup (sameFinding, 0.8 threshold), primer suppression, synthesis merge/promotion/sort, halt-class caps, budget-floor guards, summary() single merge point, args-as-string acceptance, REPO grounding chokepoint.
- KTD machinery in full: KTD_VERDICT_SCHEMA, KTD_ARBITRATION_SCHEMA, 2-of-3 arbitration, halt allowances, re-refutation pass. An A/B on the KTD verdict-referent hypothesis is still pending; this machinery encodes observed live failures and is explicitly out of bounds for simplification.
- Phase structure S0–S6 (Design inserts as a new phase, removing nothing), all S5 gates (parse, releasability, origin coverage, cross-plan overlap), S6 finalize (hygiene, optional commit, run summary).
- The existing run-summary shape: no new fields (the Design phase's effect is visible in the plan document itself).

## Scope Boundaries

Out of scope:
- Any change to `workflows/nadia-deliver.js`, `agents/skeptical-refuter.md`, `agents/finding-verifier.md`, or the S5 gate set.
- Collapsing or simplifying KTD arbitration, primer suppression, or paraphrase dedup (conservative cut — locked decision).
- Playground A/B simulation (separate follow-up per the validating-agent-improvements skill; until it runs, the behavior-quality claims of this refactor are hypotheses; the deterministic harness proves data-flow only).
- New run-summary fields or args.

## Success Criteria

- Full test suite green (`node --test workflows/nadia-plan.test.mjs`), including the new pins in R10.
- `node --check workflows/nadia-plan.js` passes; grep confirms no banned forms and no coordinator I/O.
- Both persona files preserve every load-bearing rule listed in R5/R6 (diffable against the invariants).
- Coordinator line count does not grow beyond v1's 1979 lines despite the added Design phase (the prompt slimming pays for it).
