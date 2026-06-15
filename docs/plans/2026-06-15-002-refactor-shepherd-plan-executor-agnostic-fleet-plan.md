---
title: "refactor: shepherd-plan executor-agnostic role fleet + Codex lenses ON by default"
type: refactor
status: active
date: 2026-06-15
---

## Summary
De-inline every `agent()` dispatch in `workflows/shepherd-plan.js` into slim,
executor-agnostic `agents/*.md` role files (grouped by role), add one generic
`agents/codex-executor.md` mechanism, route the 7 review lenses through it at
Codex `gpt-5.5`/`xhigh` as the LIVE DEFAULT, pin the planning-tier roles to
Claude opus, and bring the practice docs and the test harness into agreement —
all in one plan, shipped ON. The `PERSONA_FINDINGS_SCHEMA` seam and the entire
synthesis/refutation/gate logic stay behaviorally unchanged.

## Problem Frame
`shepherd-deliver` already implements the target executor model: executor is a
dispatch-time choice (`ROUTE_SCHEMA.executor` enum at
`workflows/shepherd-deliver.js:141`; `agentType: useCodex ? 'codex-runner' :
'unit-executor'` at `:624`) and `codex-runner`/`codex-reviewer` are generic
Codex mechanisms resolved by `agentType`. `shepherd-plan` still dispatches ~12
roles as inline string prompts with no `agentType` and no Codex seam (e.g.
`intake` at `:408`, `strategy-gate` at `:678`, `classify-personas` at `:830`,
`research-cross-plan` at `:612`, every fixer/checker/parser/gate/finalize site),
and routes its 7 lenses to Claude only.

A previous run on this same request (now superseded and removed) halted at the M13
file-overlap gate: it spread `workflows/shepherd-plan.js` edits across four
units (U2 Intake/Research/Draft, U6 Review-loop, U7 Gates/Finalize, U3
lens-wiring) with **no `dependsOn` edge between the same-file units**, which is
exactly the condition `fileOverlapViolations` (`workflows/shepherd-plan.js:1121`)
flags. That prior plan also made a different, reasoned architectural call: it
shipped the Codex lens path SELECTABLE and OFF-BY-DEFAULT, gating any default
flip behind a playground A/B. The maintainer is deliberately overriding both:
(1) all `shepherd-plan.js` edits land in ONE implementation unit (every other
unit touching a shared file serializes via `dependsOn`), which removes the M13
cause; and (2) the Codex lenses ship ON by default at `gpt-5.5`/`xhigh`, no
flag, no A/B gate, no Change-A/Change-B split. The override of the off-by-default
decision is the maintainer's to make and is honored; the substantive risk it
carries (an unvalidated behavioral change to the DEFAULT review path) is
recorded honestly in `## Assumptions` and in the Codex-default KTD rationale,
not hidden.

## Requirements
R1. Every `agent()` dispatch in `workflows/shepherd-plan.js` carries an
`agentType` backed by an existing-or-new `agents/<name>.md` role file; zero
inline string-prompt agents remain. The dispatch carries the per-call DATA; the
role file carries the judgment contract.
R2. Extracted roles are grouped by ROLE, not by call-site: a single
`agents/plan-fixer.md` backs all five fixer dispatch sites (`fix-round-${r}`,
`refix-uid-${tag}`, `revise-spike`, `parse-fix`, `gate-fix`); a single
`agents/plan-checker.md` backs all four checker sites (`check-${tag}`,
`check-${tag}-retry`, `check-refix-${tag}`, `check-evidence-r${r}`);
`agents/plan-parser.md` stays distinct from `plan-checker` (different gate
schemas: `UNITS_SCHEMA` vs `CHECKER_SCHEMA`); `releasability-checker` and
`origin-coverage-auditor` stay distinct role files.
R3. Every new role file is executor-agnostic and carries NO Claude/Codex
mechanism language; it mirrors the existing lens files (e.g.
`agents/coherence-lens.md`: doctrine plus a `skills/` rebinding block, no
executor language, no per-call data). The coordinator passes only per-call DATA
at the dispatch site.
R4. Exactly ONE generic, role-agnostic Codex executor exists at
`agents/codex-executor.md`; there are NO per-role Codex agents. It mirrors the
`agents/codex-reviewer.md` mechanism: read-only (`-s read-only`), mktemp scratch
dir with literal-path discipline, a `schema.json` with every property in
`required` and `additionalProperties: false` at every object level, background
launch, foreground poll to a brief-supplied cap, worktree-untouched check, and
result classification (missing/malformed -> empty findings + `ran=false`; valid
-> findings carried verbatim in the caller-supplied schema's shape).
R5. `PERSONA_FINDINGS_SCHEMA` (`workflows/shepherd-plan.js:204-219`) is
byte-for-byte unchanged as a coordinator JS object. The Codex-required
`additionalProperties: false` is added by `agents/codex-executor.md` when it
serializes `schema.json` to disk, never by mutating the coordinator's object.
R6. The dedup/promotion (`mergePair`/cross-persona +1), R29 suppression,
contradiction, sort, refutation/KTD-arbitration, fixer-routing, gate-battery, and
`summary()` logic in `workflows/shepherd-plan.js` are behaviorally unchanged:
findings flow into `roundFindings` and through the existing pure-JS pipeline
regardless of which executor produced them. No synthesis, dedup, promotion,
contradiction, sort, or gate predicate at those steps is edited. Sanctioned
addition: a per-lens Claude fallback at the lens dispatch — when a lens's
`codex-executor` run returns `ran === false` (codex absent, sandboxed, or its
flags rejected), the coordinator re-dispatches that lens on its native Claude
`agentType` (`p.type`, e.g. `coherence-lens`) at the session model and uses those
findings. Every lens therefore always yields a full review from one executor or
the other, so `rawFindings` is never short a lens and an unreviewed plan can never
ship. Log which lenses fell back (no silent cap). This fallback is a dispatch-layer
retry that does NOT alter any downstream synthesis step.
R7. Model pins land exactly as specified: `plan-author` (label `author-plan`),
`plan-editor` (label `editor-r${r}`), `intake-classifier` (label `intake`), and
`strategy-gate` pin `model: 'opus'`; `skeptical-refuter` pins `model: 'opus'` at
all four dispatch sites (`refute-halt-r*`, `refute-r*`, `ktd-refute-p*`,
`refute-halt-ktd-p*`); all mechanical roles (the five researchers,
`persona-classifier`, `cross-plan-scanner`, `plan-fixer`, `plan-checker`,
`plan-parser`, `spike-investigator`, `releasability-checker`,
`origin-coverage-auditor`, `committer`, `hygiene-checker`, and the
`codex-executor` operator dispatch) pin `model: 'sonnet'`.
R8. The 7 review lenses route through `agents/codex-executor.md` at Codex model
`gpt-5.5` / reasoning-effort `xhigh` as the LIVE DEFAULT: every lens dispatch
(`review-r${r}-${p.key}`) carries `agentType: 'codex-executor'`,
`model: 'sonnet'` on `agent()` opts, and a prompt DATA block encoding the lens
role, `gpt-5.5`, `xhigh`, the serialized `PERSONA_FINDINGS_SCHEMA`, the document
path, and the lens's review instructions. There is no run flag gating this path
and no off-by-default branch.
R9. `workflows/shepherd-plan.test.mjs` asserts, with the existing fixtures
updated: (a) across a four-run coverage union (the default happy-path run; a run
with `args.origin`+`originVersion` set to fire `origin-coverage-auditor`; a run
whose classifier/editor stubs emit a non-empty `designUnknowns` to fire
`spike-investigator`; and the persona-on union run) every `agent()` call carries
a non-empty `agentType`; (b) every `review-r*-*` dispatch carries
`agentType: 'codex-executor'`, `model: 'sonnet'`, and a prompt containing
`gpt-5.5` and `xhigh`; (c) `author-plan`/`editor-r1`/`intake`/`strategy-gate`
and all four `skeptical-refuter` sites carry `model: 'opus'`, while mechanical
roles carry `model: 'sonnet'`; (d) the `PERSONA_FINDINGS_SCHEMA` literal in the
coordinator source is byte-identical to its pre-refactor definition.
R10. The fleet line-budget gate S42 stays green: the union of dispatched
`agentType` files (now including `codex-executor` and the 12 new role files)
sums to fewer than 1471 lines; the assertion is exercised at test time so an
overrun is caught by the language gate, not post-merge.
R11. `docs/practice/parity-ce-plan.md` exists: a completeness-parity matrix
mapping every ce-plan agent, phase, and doctrine element to shepherd coverage,
plus an enumeration of shepherd's additions (adversarial refutation, KTD
arbitration, plan-editor verdict, structural checkers, gate battery, autonomous
halts). It classifies ce-plan's known gaps faithfully, marking the
thin-section-enrichment and dynamic-depth-upgrade gaps as STILL open (this
refactor touches neither).
R12. `docs/practice/fleet.md`, `docs/practice/routing.md`,
`docs/practice/plan.md`, `docs/practice/verification.md`, and the `CLAUDE.md`
principle-8 model-policy note (mirror in `AGENTS.md` if it restates the policy)
are updated to the post-refactor state: no inline-prompt-agents class on the
plan side; the new role files and their pins; `codex-executor` as a third Codex
mechanism; the lens Codex-default path; the documented plan-side opus exception;
and the precision-vs-recall caveat on the Codex lens path.
R13. The existing `shepherd-plan.test.mjs` suite plus the new assertions pass
under the repo language gate: `node workflows/shepherd-plan.test.mjs` exits 0
and `node --check workflows/shepherd-plan.js` passes.

## Key Technical Decisions
- **All `workflows/shepherd-plan.js` edits live in ONE implementation unit (U2);
  every other unit touching a shared file declares `dependsOn` U2.** Rationale:
  the M13 file-overlap gate (`fileOverlapViolations`,
  `workflows/shepherd-plan.js:1121`, asserted over the plan's own units at
  `:1780`) halts when one file is owned by two units with no `dependsOn` path
  between them. The superseded plan split the coordinator across U2/U3/U6/U7 with
  no such edge and halted on exactly this. The de-inline is one cohesive change
  anyway (move every prompt body to a role file, add `agentType`+`model` to every
  dispatch, route lenses through `codex-executor`), so one unit is both correct
  and natural. Rejected alternative: split the coordinator by pipeline phase
  (the prior plan's shape) — rejected because it reintroduces the exact
  same-file/no-dependency-edge condition the gate forbids, and the phase seam is
  not a real contract boundary (synthesis state threads across all phases).
- **Codex lenses ship ON by default at `gpt-5.5`/`xhigh`, with no flag and no
  off-by-default branch.** Rationale: the maintainer's locked decision. The 7
  lenses are cross-cutting review work, the tier for which
  `docs/solutions/architecture-patterns/model-tier-routing-by-ambiguity-and-size.md`
  records `xhigh` as correct ("effort high never beat medium; reserve xhigh for
  cross-cutting work"); read-only lens runs are sandbox-safe by construction.
  Rejected alternative: the superseded plan's selectable, off-by-default Codex
  lens path gated behind a playground A/B. That alternative's rationale is real
  and verified — plan-side lens findings flow into the PRECISION-biased
  `skeptical-refuter` (drop-on-uncertainty, `docs/practice/verification.md`),
  which is the INVERSE verdict default from where Codex-as-producer was validated
  on deliver (the RECALL-biased `finding-verifier`, keep-on-uncertainty), and no
  measured Codex datum in this repo is on reviewing a markdown plan with no
  compile/test signal. It is rejected here because the maintainer chose to ship
  the Codex path live now; the unvalidated-behavior risk it carries is preserved
  as testable `## Assumptions` entries with a post-ship A/B as the named
  invalidation, not buried.
- **Codex model and reasoning-effort travel as per-call DATA in the dispatch
  prompt; the operator dispatch carries `model: 'sonnet'`.** Rationale: the
  `agent()` `model` field accepts only the Claude tier `haiku|sonnet|opus`
  (`ROUTE_SCHEMA.model` in deliver; CLAUDE.md principle 8). Setting
  `model: 'gpt-5.5'` on `agent()` opts would be misrouted as a Claude identifier.
  Deliver's discipline is the precedent: `codex-runner` dispatches at
  `model: 'sonnet'` and renders the Codex effort into the launch command inside
  the prompt (`workflows/shepherd-deliver.js:558`, `:626`). `codex-executor`
  follows the same pattern via a `<codex-exec-brief>` DATA block. Rejected
  alternative: add a Codex-effort field to `agent()` opts — out of scope (no
  coordinator-API change) and unnecessary since the prompt already carries Codex
  protocol detail.
- **`additionalProperties: false` is added by the executor at schema-write time,
  not in the coordinator's `PERSONA_FINDINGS_SCHEMA` object.** Rationale: Codex
  strict structured output requires `additionalProperties: false` at every object
  level and every property in `required` (`agents/codex-reviewer.md:26`), but R5
  fixes `PERSONA_FINDINGS_SCHEMA` byte-for-byte. The tension resolves by location:
  the coordinator passes the schema definition through the prompt; the executor
  adds the Codex-required field when serializing `schema.json` to disk. Rejected
  alternative: mutate the coordinator object — forbidden by R5 and the field would
  have no effect on any non-Codex consumer.
- **Codex model `gpt-5.5` is pinned explicitly in the launch command via the
  `-c model="gpt-5.5"` config form, alongside `-c model_reasoning_effort="xhigh"`.**
  Rationale: deliver's `codex-runner` pins only effort and relies on the installed
  default (`workflows/shepherd-deliver.js:558`); the request asks for an explicit
  model pin so the lens reviewer is coordinator-visible and stable across fleet
  machines. The `-c key="value"` config form is confirmed valid against the
  installed `codex-cli 0.139.0` (`codex exec --help` lists `-c, --config
  <key=value>` with example `-c model="o3"`; `-s read-only` is a valid sandbox
  value). Rejected alternative: leave the model unset like deliver — rejected
  because a default change on a fleet machine would silently swap the reviewer
  with no coordinator-visible signal.
- **Keep the single plan-author + single plan-editor authoring topology; keep
  `external-grounding-researcher` folded.** Rationale: faithful to ce-plan (no
  architect/synthesizer/per-unit-author fan-out). The existing dispatch sites
  (`author-plan` at `:778`, `editor-r${r}` at `:1582`) already use one author and
  one editor; this refactor only adds `model: 'opus'`. `external-grounding-
  researcher` already covers both ce best-practices and version-specific framework
  docs via the `intentDescriptor` parameter (`:576-584`); the request forbids
  splitting it. Rejected alternative: re-author the lenses/researchers from
  scratch — rejected because the existing `agents/*.md` lens and researcher files
  are already slim ce re-derivations; "re-derive" here is a verify-and-trim pass
  that preserves ce doctrine and KEEPS shepherd's `skills/` rebinding blocks.
- **Pinning the planning roles and the refuter to opus is a deliberate exception
  to CLAUDE.md principle 8, documented in-plan and in the docs — not surfaced as
  a blocking conflict.** Rationale: plan-authoring, intake classification, the
  strategy gate, the editor verdict, and adversarial refutation are the
  highest-stakes judgment work in an autonomous pipeline that ships a plan with no
  human review between agents; inherit-the-session-model is correct for
  self-paced interactive work, not here. The refuter pin also realizes cross-model
  find/refute (Codex lenses find, Claude opus refutes). R12 includes explicit work
  to update CLAUDE.md principle 8 and `docs/practice/routing.md` to record this
  plan-side exception.

## Implementation Units

### U1. Generic Codex-executor mechanism + the schema seam
**Goal**: Add `agents/codex-executor.md` as a role-agnostic Codex mechanism that
runs any caller-supplied role's doctrine through `codex exec` read-only against a
caller-supplied output schema, returning findings in that schema's shape.
**Requirements**: R4, R5
**Dependencies**: none
**Files**: `agents/codex-executor.md`
**Approach**: Author the file mirroring `agents/codex-reviewer.md` step-for-step:
the frontmatter (`name`, `description`, `tools: Bash, Read, Write`,
`model: sonnet`), the scratch-path discipline note, then the same read-only
protocol (mktemp; write `schema.json`; write `prompt.md`; background launch via
the Bash tool's `run_in_background`; foreground poll to the brief's cap;
worktree-untouched check; classify result). The one structural difference from
`codex-reviewer`: this file is role-agnostic — it reads its Codex model,
reasoning-effort, output schema, document path, and review instructions from a
`<codex-exec-brief>` DATA block in its dispatch prompt rather than hard-coding a
diff-review charter. State the load-bearing schema-write rule: serialize the
caller's schema with `additionalProperties: false` added at every object level
and every property forced into `required`, so the caller's
`PERSONA_FINDINGS_SCHEMA` JS object stays byte-identical while the on-disk
`schema.json` satisfies Codex strict output. Launch always uses `-s read-only`
(never the workspace-write/bypass sandbox `codex-runner` uses). On
missing/malformed `result.json` or when `codex` is not found return empty
`findings` + `ran=false`; on valid return the findings verbatim in the supplied
schema's shape (NO snake_case remap layer — unlike `codex-runner`, the caller
supplies the schema, so the executor's return shape IS the caller's schema).
Carry NO lens-specific doctrine: the lens role text is NOT inlined in this file
and is NOT passed in the dispatch brief — instead, the executor reads the lens
role file from disk at `agents/<lens-role-name>.md` (the lens role name is passed
as a field in the `<codex-exec-brief>` DATA block, e.g. `role_file:
agents/coherence-lens.md`) and concatenates the role file content into
`prompt.md` before launching Codex. This is the sanctioned exception to the
no-mechanism-language rule: `codex-executor` is the Codex operator and must
name the discovery step and the flag form — the same "never improvise flags"
discipline applies: the executor renders only the flags named explicitly in the
brief, using the `-c key="value"` form confirmed valid in `codex-cli 0.139.0`.
Discovery step (mirroring `shepherd-deliver.js:342/:356`): (1) check
`$CODEX_SANDBOX` and `$CODEX_SESSION_ID` — if either is set, the executor is
running inside a Codex sandbox where launching a nested Codex process is
unsupported; return `{ ran: false, reason: 'sandboxed' }` immediately without
running `command -v codex`; (2) run `command -v codex`; if not found, return
`{ ran: false, reason: 'binary-absent' }`. Both paths produce a `ran=false`
result and a named reason; the coordinator treats them identically (fail-closed
on all-`ran=false`). The executor names both env-var names explicitly so the
guard is grep-verifiable.
The wait-round/poll cap comes from the brief's `poll_cap` field (default: 30
rounds if absent). Keep the file slim (target ≤ 60 lines; budget headroom is
tight per the S42 note in U2). This unit ships the mechanism only; no coordinator
dispatch points at it yet.
**Execution note**: Contract-defining unit (per `skills/decomposition`: "place a
contract-defining unit before the units that share that contract"). U2's lens
wiring depends on the `<codex-exec-brief>` shape and the schema-write rule fixed
here.
**Patterns to follow**: `agents/codex-reviewer.md` (the read-only mechanism,
scratch-path discipline, classify rules, strict-output schema note at line 26);
`agents/codex-runner.md` (the XML-section prompt-assembly-from-brief style and
the "never improvise flags" discipline; do NOT copy its snake_case-remap step,
which is specific to deliver's orchestrator contract).
**Test scenarios**:
- (file-content present) the file exists and names `-s read-only`, the
  `additionalProperties: false` schema-write rule, `command -v codex` binary
  discovery, and reading model/effort/schema/role_file from the dispatch brief
  (not inlining lens doctrine) — a file-content assertion mirroring S44's
  file-content pin style.
- (role-agnostic) the file contains no single lens role name (no
  "coherence"/"feasibility"/etc. charter string) and no inline lens doctrine,
  proving role-agnosticism — a negative grep assertion.
- (binary-discovery) the file names the `command -v codex` discovery step and
  the `ran=false` return when codex is absent.
- (sandbox-guard) the file names both `$CODEX_SANDBOX` and `$CODEX_SESSION_ID`
  as the nested-sandbox detection env vars and returns `ran=false` with a named
  reason before running `command -v codex` when either is set — a grep assertion
  confirming both env-var names appear in the file; the `codexUnavailable` stub in
  U3 stands in for BOTH the binary-absent and sandboxed (binary-present-but-unusable)
  conditions.
**Verification**: `agents/codex-executor.md` is present; a grep for `read-only`,
`additionalProperties`, `command -v codex`, `CODEX_SANDBOX`, and
`CODEX_SESSION_ID` succeeds; a grep for any single lens role name fails; the
file is ≤ 60 lines.

### U2. De-inline the whole coordinator, wire Codex lenses live, pin tiers
**Goal**: In ONE change to `workflows/shepherd-plan.js`, replace every inline
string-prompt `agent()` dispatch with an `agentType` backed by a slim role file
(grouped by role), route the 7 lenses through `agents/codex-executor.md` at
`gpt-5.5`/`xhigh` as the live default, and apply every model pin — with the
`PERSONA_FINDINGS_SCHEMA` seam and all synthesis/refutation/gate logic
behaviorally unchanged. The 12 new role files are authored as siblings in this
same unit so they exist on disk before the coordinator dispatch references them
(S40 requirement).
**Requirements**: R1, R2, R3, R5, R6, R7, R8
**Dependencies**: U1
**Files**: `workflows/shepherd-plan.js`,
`agents/intake-classifier.md` (new),
`agents/strategy-gate.md` (new),
`agents/cross-plan-scanner.md` (new),
`agents/persona-classifier.md` (new),
`agents/plan-fixer.md` (new),
`agents/plan-checker.md` (new),
`agents/spike-investigator.md` (new),
`agents/plan-parser.md` (new),
`agents/releasability-checker.md` (new),
`agents/origin-coverage-auditor.md` (new),
`agents/committer.md` (new),
`agents/hygiene-checker.md` (new)
**Approach**: For each currently-inline dispatch, move the role's *judgment
contract* (what it decides, what authority it respects, what it returns) into its
named role file, leaving per-call *data* (paths, the `CONFIRMED_INTENT` block,
research-intent guidance, fix batches, violation lists) in the coordinator's
prompt factory. Add `agentType` plus the specified `model` to each dispatch. The
coordinator keeps all schema objects, all pure-JS synthesis
(`fingerprint`/`mergePair`/`fileOverlapViolations`/`uidStabilityViolations`/
`postMutationChecks`/`normalizeRelease`/`summary`), and all prompt-factory data
assembly. Grep dispatches by their label string — line numbers below are
indicative and may have drifted.

Inline-to-role map (group by ROLE; `plan-fixer` and `plan-checker` are each ONE
file across multiple sites):
- `intake` -> `intake-classifier`, `model: 'opus'`. The role file carries the
  below-floor judgment, the one-thing split tests, the unknown classification,
  and the research-intent enum guidance. The research-intent guidance is
  load-bearing: the `INTAKE_SCHEMA.research.intent` enum
  (`workflows/shepherd-plan.js:120`), the role file's guidance paragraph, and the
  coordinator's research-roster dispatch branches (`:587-599`) must stay mutually
  consistent (see Assumptions and the intake-enum learning in
  `docs/solutions/logic-errors/intake-enum-value-with-no-coordinator-dispatch.md`).
- `strategy-gate` -> `strategy-gate`, `model: 'opus'`.
- `research-cross-plan` (today has NO `agentType`, `:619`) -> `cross-plan-scanner`,
  `model: 'sonnet'`. Easy to miss: this is the one research dispatch with no
  `agentType` today; adding it brings the dispatch into S40's on-disk check.
- `classify-personas` -> `persona-classifier`, `model: 'sonnet'`. The role file
  notes its `CLASSIFY_SCHEMA` output feeds coordinator variables only
  (`personaSel`, `ktds`, `loadBearingAssumptions`), never a downstream agent
  prompt.
- `fix-round-${r}`, `refix-uid-${tag}`, `revise-spike`, `parse-fix`, `gate-fix`
  -> `plan-fixer`, `model: 'sonnet'` (ONE file across all five sites). The role
  file states the role-level judgment contract (apply confirmed/safe-auto fixes;
  respect the authority class the brief names; never widen scope; report
  applied/documented/unapplied + sectionsTouched) without hard-coding any one
  call's authority regime — the per-call DATA carries the refutation-survived
  rules (S4 fixer), the spike off-limits rules (`revise-spike`), and
  `GATE_AUTHORITY` (`parse-fix`/`gate-fix`).
- `check-${tag}`, `check-${tag}-retry`, `check-refix-${tag}`,
  `check-evidence-r${r}` -> `plan-checker`, `model: 'sonnet'` (ONE file;
  `CHECKER_SCHEMA`, distinct from `plan-parser`'s `UNITS_SCHEMA`).
- `spike-${i}` -> `spike-investigator`, `model: 'sonnet'`.
- `parse-plan`, `parse-plan-retry`, `parse-plan-final` -> `plan-parser`,
  `model: 'sonnet'` (`UNITS_SCHEMA`).
- `releasability`, `releasability-retry` -> `releasability-checker`,
  `model: 'sonnet'`. `RELEASE_IDS` and the 7-item enumeration stay coordinator JS
  (pure data); `normalizeRelease()` stays coordinator JS.
- `origin-coverage`, `origin-coverage-retry` -> `origin-coverage-auditor`,
  `model: 'sonnet'`. The R13 normative-vs-illustrative list carve-out (the
  coordinator's origin-coverage prompt, `:1877`) MUST be copied verbatim into the
  role file (per
  `docs/solutions/best-practices/origin-coverage-normative-vs-illustrative-lists.md`;
  its absence would false-positive on every plan that selects a subset of an
  illustrative list — exactly what the parity matrix in U4 does).
- `commit-plan` -> `committer`, `model: 'sonnet'`.
- `hygiene` -> `hygiene-checker`, `model: 'sonnet'`.
- Add `model: 'opus'` to the existing `author-plan` (`plan-author`) and
  `editor-r${r}` (`plan-editor`) dispatches (both inherit today).
- Add `model: 'opus'` to all four `skeptical-refuter` dispatches
  (`refute-halt-r*`, `refute-r*`, `ktd-refute-p*`, `refute-halt-ktd-p*`), which
  read `model: 'sonnet'` today.

Lens wiring (R8): at the lens dispatch (`:1252-1253`), replace
`agent(reviewPrompt(p, r), { agentType: p.type, schema: PERSONA_FINDINGS_SCHEMA })`
with a dispatch of `agentType: 'codex-executor'`, `model: 'sonnet'`,
`schema: PERSONA_FINDINGS_SCHEMA` (kept on the `agent()` opts to preserve S43's
`assert.ok(c.schema)` assertion verbatim), carrying a `<codex-exec-brief>` DATA
block in the prompt with: `role_file: agents/<p.type>.md` (the executor reads
this file from disk and concatenates its content into `prompt.md` before
launching Codex — this is the doctrine-transport mechanism), `model: gpt-5.5`,
`reasoning_effort: xhigh`, the serialized `PERSONA_FINDINGS_SCHEMA` (the
executor adds `additionalProperties: false` at write-time per U1),
`document_path: ${planPath}`, and `poll_cap: 30`. The `context` field of the
`<codex-exec-brief>` MUST carry the FULL output of `reviewPrompt(p, r)` for
that lens — the entire assembled string including the opening `<review-context>`
block (carrying `Document type: ${documentType}` and `Origin: ${ORIGIN ||
'none'}`), the `CONFIRMED_INTENT`, `CODEBASE_CONTEXT`, `primerBlock()`,
`ANCHOR_RUBRIC` blocks, and any per-lens appendix (e.g. the glossary appended
for the coherence lens at lines 923-924). The simplest implementation is to pass
the entire `reviewPrompt(p, r)` return value as the `context` field and have
`codex-executor` concatenate the role file content ahead of it in `prompt.md`.
Do NOT hand-pick a subset of the blocks: `agents/adversarial-lens.md` branches
its entire protocol on the `<review-context>` Document-type/Origin fields, and
`agents/coherence-lens.md` uses the glossary appendix; omitting either would
silently disable those lens branches. The executor reads the role file itself
from disk (`Read tool`) — it does I/O; the coordinator does not.
Keep the label `review-r${r}-${p.key}` so the harness label-prefix routing and
every existing `review-`-prefixed scenario keep working. The returned shape stays
`PERSONA_FINDINGS_SCHEMA`, so the `reviews.forEach(... roundFindings.push)`
synthesis entry (`:1254-1260`) is unchanged. Surface the path with `log()` (no
silent path selection). Do NOT add a flag or an off-by-default branch — this is
the only lens path.

Codex-unavailable fallback (per-lens, mirroring deliver's codex-failed -> Claude
recovery at `shepherd-deliver.js:663`): the `codex-executor` agent returns
`ran=false` when `command -v codex` finds no binary (see binary-discovery note in
U1) or when the nested-sandbox guard fires (see U1). Gate predicate: a lens result
is treated as "ran" unless it carries `ran === false` explicitly — the production
`codex-executor` success return MUST include `ran: true`, so absence of an explicit
`ran === false` means the codex run is trusted. When a lens result carries
`ran === false`, the coordinator re-dispatches THAT lens on its native Claude
`agentType` (`p.type`, e.g. `coherence-lens`) at the session model and uses those
findings instead. Every lens thus always contributes a full review (Codex by
default, Claude on fallback), so the round never proceeds short a lens and an
unreviewed plan can never ship. Log the fell-back lenses (no silent cap, per
non-negotiable principle 6). This is NOT an off-by-default branch or a flag: Codex
stays the live default and the Claude path is a per-lens availability fallback
only. Because the fallback re-dispatches `agentType: p.type`, the 7 lens files
remain in the dispatched fleet union on any run that exercises it; the on-disk
lens-existence check in U3 covers the codex-available path where they are not
otherwise dispatched.

Guard rules for the extracted role files (institutional-learnings audit):
- Any role-file rule of the form "check X against Y" (e.g. a glossary,
  `CONTEXT.md`, `CODEBASE_CONTEXT`) must first verify Y is present in injected
  context and skip silently when absent (per
  `docs/solutions/logic-errors/agent-rule-fires-without-precondition-guard.md`;
  `agents/plan-editor.md:64-66` is the existing exemplar of this guard).
- Do NOT spread-copy `PERSONA_FINDINGS_SCHEMA` entries from `codex-executor`
  output before they reach the synthesis accumulator; the coordinator's
  `roundFindings`/`carryFindings` arrays are the canonical objects (per
  `docs/solutions/architecture-patterns/pre-verification-dedup-capped-verifier-budget.md`).

Do NOT edit any synthesis step, gate predicate, the `fileOverlapViolations`
function, or the `summary()` builder. This unit is behavior-preserving for
synthesis/gate LOGIC by construction (the deterministic harness is the proof);
the model-tier raises on the refuter and the gate sites are intentional tier
changes per the run config, not no-ops, and that characterization is NOT used to
skip the post-ship A/B in `## Assumptions`.

**Execution note**: This is one coherent commit ("de-inline shepherd-plan into
role files, route lenses through codex-executor, pin tiers"). Authoring the 12
role files in this unit is required by S40 (the coordinator's new `agentType`
values must resolve to on-disk files in the same shippable state). Keep every new
role file slim — see the S42 budget note below.
**Patterns to follow**: existing executor-agnostic lens files
`agents/coherence-lens.md` and `agents/scope-lens.md` (doctrine + `skills/`
rebinding block, no executor language, no per-call data); `agents/plan-editor.md`
(a read-only judgment-contract persona with the optional-resource guard); the
deliver selectable-executor branch (`workflows/shepherd-deliver.js:618-626`) and
the Codex-config-in-prompt pattern (`codexRunnerPrompt`,
`workflows/shepherd-deliver.js:546-569`).
**Test scenarios**: (these belong to U3; listed here so the executor knows what
this unit must satisfy)
- every `agent()` call carries a non-empty `agentType` across the four-run union
  (no inline agents) — catches `committer`, `hygiene-checker`,
  `origin-coverage-auditor`, `spike-investigator`, `cross-plan-scanner`.
- the 7 lens dispatches carry `agentType: 'codex-executor'`, `model: 'sonnet'`,
  and a prompt containing `gpt-5.5` and `xhigh`.
- `author-plan`/`editor-r1`/`intake`/`strategy-gate` and the four
  `skeptical-refuter` sites carry `model: 'opus'`; mechanical roles carry
  `model: 'sonnet'`.
- the S1/S5/S6 happy-path outcomes (status `ready`, unit/requirement counts,
  residual classes) are identical to pre-refactor, and the existing S2-S49
  scenarios that do not assert `agentType`/`model` still pass.
- each `INTAKE_SCHEMA.research.intent` enum value still routes to its research
  dispatch branch.
**Verification**: `node --check workflows/shepherd-plan.js` passes; a grep of
`workflows/shepherd-plan.js` for `agent(` shows every call carrying `agentType:`;
the `PERSONA_FINDINGS_SCHEMA` literal is unchanged versus the pre-refactor bytes;
all 12 new `agents/*.md` files exist.

**S42 fleet line-budget note (hard authoring constraint, governs U1 + U2)**: The
pre-refactor dispatched-`agentType` union totals **967 lines** (verified by
`wc -l` over the 15 files dispatched in the S42 two-run coverage). S42 is a
strict `assert.ok(totalLines < 1471)` (`workflows/shepherd-plan.test.mjs:1467`).
The 13 new files (12 role files + `agents/codex-executor.md`) must therefore sum
to **at most 503** lines (967 + 503 = 1470 < 1471; 504 fails the strict `<`),
about 38 lines/file. Allocation, calibrated so the actual sum is ≤ 503:
heavier-doctrine roles (`plan-fixer`, `origin-coverage-auditor`,
`intake-classifier`, `releasability-checker`, `codex-executor`) up to ~55 lines
each; lighter mechanical roles (`committer`, `hygiene-checker`,
`cross-plan-scanner`, `persona-classifier`, `spike-investigator`) held to ~25
lines each; the remainder (`strategy-gate`, `plan-checker`, `plan-parser`) ~35-45
lines each. The per-file ceiling is a stated constraint from the moment authoring
begins. If the authored total of all 13 files exceeds 503, U3's S42 scenario
catches it at test time; the only sanctioned response is to trim, or (last
resort) raise the 1471 constant and state the new value with its justification in
U3's verification note.

### U3. Update the test harness to assert the new invariants
**Goal**: Bring `workflows/shepherd-plan.test.mjs` into agreement with the
refactored coordinator: assert every dispatch carries `agentType`, the lenses
route through `codex-executor` at `gpt-5.5`/`xhigh`, the opus pins, the sonnet
pins, `PERSONA_FINDINGS_SCHEMA` byte-identity, and the S42 budget over the new
fleet — and fix the assertions the refactor breaks.
**Requirements**: R9, R10, R13
**Dependencies**: U2
**Files**: `workflows/shepherd-plan.test.mjs`
**Approach**: Update the breaking assertions and add the new ones. The known
breaks from the refactor:
- S1 (`:218-219`): lens `agentType` assertions
  (`review-r1-coherence -> coherence-lens`) must change to
  `review-r1-coherence -> codex-executor` (and similarly any lens-agentType
  assertion in S20 at `:741`, which asserts `review-r1-security -> security-lens`).
- S22 (`:840-841`): `ktd-refute-p1-0` `model` flips `'sonnet'` -> `'opus'`
  (`agentType: 'skeptical-refuter'` stays).
- S27 (`:1001-1002`): `intake` and `author-plan` `model` flip `undefined` ->
  `'opus'`; rename the scenario's claim accordingly. Keep the mechanical-site
  sonnet assertions (`research-repo`, `fix-round`, `refix-uid`, `revise-spike`,
  `parse-fix`) — they hold unchanged.
- S43 (`:1488-1492`): `assert.ok(c.schema, ...)` for every `review-r*-*`
  dispatch is PRESERVED, not broken. U2 keeps `schema: PERSONA_FINDINGS_SCHEMA`
  on the `agent()` opts alongside the `<codex-exec-brief>` prompt block (the
  schema appears in both places: opts for the harness assertion, serialized body
  for the Codex executor). S43 therefore requires no change.
Add new scenarios (or extend existing ones):
- **no-inline (four-run union)**: union dispatched `agentType` values across (i)
  the default happy path, (ii) a run with `args.origin`+`originVersion` set to
  fire `origin-coverage-auditor`, (iii) a run whose classifier/editor stubs emit
  a non-empty `designUnknowns` to fire `spike-investigator`, and (iv) the
  persona-on union run; assert none is `undefined` across `trace.calls`. This is
  the completeness gate for the whole de-inline.
- **lens-via-codex**: every `review-r*-*` dispatch carries
  `agentType: 'codex-executor'`, `model: 'sonnet'`, and a prompt containing
  `gpt-5.5` and `xhigh`; the synthesized run outcome (status, residual classes)
  on identical stubbed findings matches the pre-refactor outcome.
- **opus pins**: `author-plan`, `editor-r1`, `intake`, `strategy-gate`, and the
  four `skeptical-refuter` labels each carry `model: 'opus'`.
- **schema byte-identity**: the `PERSONA_FINDINGS_SCHEMA` literal in the
  coordinator source string is byte-identical to its pre-refactor definition
  (a `scriptSrc`-substring pin, like S44's file-content style).
- **codex-unavailable (per-lens Claude fallback)**: using the `codexUnavailable`
  dispatcher branch (returns `{ findings: [], ran: false }` for `codex-executor`
  dispatches when the stub flag is set), simulate a round where the lens codex runs
  report `ran=false`; assert each such lens is re-dispatched on its native
  `agentType` (`coherence-lens`...`adversarial-lens`) and that the round completes
  with a full finding set rather than converging to `READY` with zero findings or
  halting; assert a `log()` line names the fell-back lenses (no silent cap).
- **S40 / S42 extension**: the on-disk union check (S40, `:1390`) and the
  budget union check (S42, `:1439`) automatically pick up `codex-executor` and
  the 12 new role files because they derive the fleet from `trace.calls`
  agentTypes; confirm both pass, and that the four-run union (not just the
  two-run union) feeds the on-disk and budget checks so `committer`,
  `hygiene-checker`, `origin-coverage-auditor`, and `spike-investigator` are
  covered.
The harness records `agentType` already (`:19`) and routes by label prefix, so
lens dispatches keeping `review-r*-*` labels still resolve via the existing
dispatcher when `agentType` becomes `codex-executor`. A dedicated dispatcher
branch IS needed for the fallback simulation: add a branch that returns
`{ findings: [], ran: false }` for any `codex-executor` label when the scenario
sets a `codexUnavailable` stub flag, and assert that the coordinator re-dispatches
each such lens on its native `agentType` and completes the round with a full
finding set (not a zero-finding READY, not a halt). Also update the default
`review-` dispatcher stub (`:170`, currently returns `{ findings: [] }`) to return
`{ findings: [], ran: true }` so the default-stub scenarios (all that do NOT set
`codexUnavailable`) keep the codex-available path and never trip the fallback. The
`codexUnavailable` branch is additive alongside the updated default stub; the two
cover (i) the normal Codex-succeeds path and (ii) the per-lens Claude-fallback
path; the `codexUnavailable` flag also stands in for the sandboxed case
(binary-present-but-unusable) as well as the binary-absent case.
**Execution note**: One commit ("update shepherd-plan tests for the
executor-agnostic fleet + Codex lenses"). This unit only edits the test file; it
depends on U2 because the assertions describe U2's coordinator behavior.
**Patterns to follow**: the existing structural-pin style in S1/S20/S22/S27
(label lookup + `agentType`/`model` assertions); S40 (`:1390`, on-disk union)
and S42 (`:1439`, budget union) for the trace-derived fleet; S44 (`:1496`, a
`scriptSrc`/file-content byte-identity pin) for the schema-identity assertion.
**Test scenarios**:
- (self-verifying) `node workflows/shepherd-plan.test.mjs` exits 0 with all new
  and amended assertions; the no-inline four-run union reports zero `undefined`
  agentTypes; S42 reports a fleet total < 1471.
**Verification**: `node workflows/shepherd-plan.test.mjs` exits 0; the suite
count is >= the pre-refactor 49 scenarios; the lens-via-codex, opus-pins,
no-inline-union, and schema-identity assertions are present and pass.

### U4. Author the ce-plan parity matrix
**Goal**: Create `docs/practice/parity-ce-plan.md` mapping every ce-plan agent,
phase, and doctrine element to shepherd coverage, with shepherd's additions
enumerated and ce-plan's open gaps classified faithfully.
**Requirements**: R11
**Dependencies**: none
**Files**: `docs/practice/parity-ce-plan.md` (new)
**Approach**: Structure as a row per ce-plan agent/phase/doctrine element with its
shepherd coverage (covered / covered-stronger / intentionally-not-implemented /
gap), drawing on the existing untracked `docs/comparisons/ce-plan-vs-shepherd-
plan.md` as raw material (left in place, not relocated or promoted to be the
deliverable). Enumerate shepherd's additions: adversarial refutation, KTD
arbitration, plan-editor verdict, structural checkers, gate battery, autonomous
halts. Classify ce-plan's gaps from the comparison faithfully: the
thin-section-enrichment gap and the dynamic-depth-upgrade gap are STILL open
(this refactor touches neither — do NOT mark them closed); the test-first/legacy
`executionNote` tagging gap and the risk-specialists gap per their actual status.
Keep the normative-vs-illustrative distinction between "shepherd additions absent
from ce-plan" and "ce-plan capabilities shepherd intentionally omits" (Slack
research, HTML output, interactive checkpoints, in-place plan re-open) so the
matrix does not conflate the two classes. Link it from the
`docs/practice/README.md` hub.
**Execution note**: This unit is standalone (no coordinator or test dependency)
but is listed in `docs/practice/README.md`, which U5 also edits — to avoid a
shared-file overlap on the README, U4 creates `parity-ce-plan.md` only and U5
owns the README hub-link edit (U5 `dependsOn` U4). If instead U4 adds the README
link, U5 must `dependsOn` U4; the chosen split keeps `docs/practice/README.md`
owned by U5 alone.
**Patterns to follow**: `docs/comparisons/ce-plan-vs-shepherd-plan.md` (the
side-by-side table structure and the gap/not-gap/plus-something framing);
`docs/practice/README.md` (hub-link conventions and deep-dive doc style).
**Test scenarios**:
- (content) the matrix names ce-plan's gaps and marks the thin-section and
  dynamic-depth gaps as open (not closed) — a manual review check.
- (additions) the six shepherd additions are each enumerated.
**Verification**: `docs/practice/parity-ce-plan.md` exists; it contains a gap row
for each ce-plan gap with thin-section and dynamic-depth marked open; the six
additions are listed.

### U5. Update the practice docs and the model policy
**Goal**: Bring `fleet.md`, `routing.md`, `plan.md`, `verification.md`, the
`docs/practice/README.md` hub, and the CLAUDE.md principle-8 note into agreement
with the refactored coordinator.
**Requirements**: R12
**Dependencies**: U2, U4
**Files**: `docs/practice/fleet.md`, `docs/practice/routing.md`,
`docs/practice/plan.md`, `docs/practice/verification.md`,
`docs/practice/README.md`, `CLAUDE.md`, `AGENTS.md`
**Approach**:
- `fleet.md`: remove the plan-side "inline-prompt agents (not personas)" class;
  document the 12 new role files and their tiers, the lens `codex-executor`
  routing at `gpt-5.5`/`xhigh`, and `codex-executor` as a third Codex mechanism
  alongside `codex-runner`/`codex-reviewer`. Update the stated persona count to
  match the actual `agents/*.md` count.
- `routing.md`: note that `shepherd-plan` now shares the
  executor-as-dispatch-time-choice model with deliver, with the 7 lenses routed
  through Codex at `gpt-5.5`/`xhigh` by default; record the plan-side opus
  exception (planners + refuter) as a deliberate override of the
  inherit-the-session-model default.
- `plan.md`: update the intake/strategy-gate/cross-plan/classify descriptions
  from "inline-prompt agent" to their role files; update the lens model note and
  the fixer/editor/refuter pins.
- `verification.md`: add the load-bearing caveat — plan-side findings flow into
  the PRECISION-biased `skeptical-refuter`, which is the INVERSE of deliver's
  validated RECALL-biased Codex pairing; state that the Codex lens path ships ON
  by default and that a post-ship A/B is the named mechanism for revisiting it
  (cross-reference the `## Assumptions` entries in this plan). State the exact
  failure mode concretely, not just the abstract polarity: "Codex's cross-model
  phrasing may differ enough from Claude's same-family phrasing that the
  precision-biased `skeptical-refuter` refutes Codex findings at a higher rate
  than Claude findings for the same underlying real problems, degrading plan-side
  recall; the A/B experimenter must measure the surviving-finding rate per arm,
  not merely whether findings are present." This specificity is required so the
  A/B experimenter knows exactly what to measure.
- `docs/practice/README.md`: add the hub link to `parity-ce-plan.md`.
- `CLAUDE.md` principle 8: add a documented exception clause (do NOT change the
  general rule) recording the plan-side opus pins on
  `plan-author`/`plan-editor`/`intake-classifier`/`strategy-gate`/
  `skeptical-refuter` and the sonnet pins on mechanical roles. Mirror in
  `AGENTS.md` only if it restates the principle-8 policy.
**Execution note**: One commit ("update practice docs + model policy for the
executor-agnostic fleet"). Depends on U2 for the final fleet shape/counts and on
U4 for the parity-matrix link target.
**Patterns to follow**: the existing doc voice and cross-link style in each file;
`docs/practice/verification.md` (the precision-vs-recall framing to extend).
**Test scenarios**:
- (consistency) no practice doc still calls a now-extracted plan-side dispatch an
  "inline-prompt agent"; `fleet.md`'s stated persona count equals the on-disk
  `agents/*.md` count.
- (caveat present) `verification.md` states the Codex-lens precision/recall
  inversion and that the path ships ON by default with an A/B as the revisit
  mechanism.
- (policy) `CLAUDE.md` principle 8 carries the documented opus exception for the
  five named roles.
**Verification**: a grep of `docs/practice/` for "inline-prompt agent" returns no
plan-side references; `verification.md` contains the inversion caveat and the
ON-by-default statement; `CLAUDE.md` principle 8 names the opus exception;
`fleet.md`'s stated count is consistent with the post-refactor fleet.

## Scope Boundaries
- No de-inlining of `workflows/shepherd-deliver.js`. Its inline agents stay; only
  `shepherd-plan.js` is de-inlined.
- No unifying of deliver's `codex-runner` / `codex-reviewer` into the new generic
  `codex-executor`. The three mechanisms coexist; `codex-executor` serves the
  plan lens path only.
- No splitting `external-grounding-researcher` back into two researchers. It stays
  folded under one role with the `intentDescriptor` parameter.
- No `slack-researcher`. The plan side mines `docs/solutions/` instead; Slack is a
  ce-plan-only capability documented as intentionally-omitted in the parity matrix.
- No change to `PERSONA_FINDINGS_SCHEMA` or any other coordinator schema object,
  and no change to the dedup/promotion/contradiction/sort/refutation/KTD/gate-battery
  steps or the `summary()` builder. The refactor changes agent-definition LOCATION,
  model pins, and the leaf lens executor only. SANCTIONED ADDITION: a per-lens
  Claude fallback at the lens dispatch — a lens whose `codex-executor` run returns
  `ran === false` is re-dispatched on its native Claude `agentType` (`p.type`) so
  every lens always contributes a full review (the fell-back lenses are logged, per
  non-negotiable principle 6); this addition does NOT alter any downstream synthesis
  step and is explicitly outside the "behaviorally unchanged" perimeter of R6 (see
  R6 amended text).
- No change to the authoring topology (single author + single editor); no
  architect/synthesizer/per-unit-author fan-out.
- No off-by-default Codex lens path, no run flag gating the Codex default, no
  Change-A/Change-B split, no playground-A/B gate on the default, and no deferral
  of the Codex path. The lenses ship through Codex live in this plan.
- No change to the `agent()` primitive or the dynamic-workflow runtime API (no new
  Codex-effort opt). Codex config travels as prompt DATA.
- No re-authoring of the 7 lens or 5 researcher role files from scratch: the
  "re-derive from ce-plan sources" work is a verify-and-trim pass that preserves
  ce doctrine and KEEPS shepherd's `skills/` rebinding blocks. Material doctrine
  drift discovered during that pass, if any, is routed to Deferred (it is not in
  this plan's editing scope beyond verification).
- (known-cost) The 13 new always-dispatched-or-referenced files (12 role files +
  `codex-executor`) enter the S42 fleet-line-budget union. The 1471 constant is
  held unless the authored total overruns 503 new lines, in which case U3's
  verification note states the raised ceiling and its justification. The per-file
  ceiling is a constraint from the start of authoring; U3's S42 scenario asserts
  the full-union total at test time so an overrun is caught by the language gate.

### Deferred to Follow-Up Work
- The post-ship playground A/B that would confirm-or-reverse the Codex-lens
  default (Claude-lens vs Codex-lens, identical briefs, >= 2 runs per arm, judged
  on findings that survive the precision-biased refuter). It is a measurement
  program, not a code change, and cannot run inside the deterministic harness.
- An xhigh-vs-medium effort A/B for plan-document lenses (the model-tier doc found
  effort-high never beat medium for non-cross-cutting work; whether xhigh beats
  medium for plan review specifically is unmeasured).
- ce-plan thin-section enrichment (scoring section confidence and dispatching
  fresh research to shore up weak-but-coherent sections) — a real capability
  shepherd-plan still lacks; this refactor does not add it.
- ce-plan dynamic depth upgrade post-research (bumping lightweight to standard
  when research reveals a crossed external contract) — still absent; unchanged
  here.
- ce-plan test-first/legacy `executionNote` auto-tagging and risk specialists for
  migration/performance/rollout depth — recorded in the parity matrix; not in
  this plan's scope.
- Post-refactor Codex cost monitoring must read the `~/.codex` session jsonl, not
  the printed "tokens used" line (the printed count understates ~6.5x by excluding
  cached input). A monitoring follow-up, not a code change here.
- Material ce-doctrine drift between the compound-engineering ce-plan source docs
  and the current shepherd lens/researcher files, if the U2 verify-and-trim pass
  surfaces any — folded into a follow-up rather than expanded here.

## Assumptions
- The generic `codex-executor` renders the pins with `-c model="gpt-5.5"` plus
  `-c model_reasoning_effort="xhigh"`, with model and effort passed as per-call
  DATA in the `<codex-exec-brief>` and the operator dispatch carrying
  `model: 'sonnet'` on `agent()` opts (the opts `model` field is a Claude-tier
  identifier only). The `-c key="value"` config form is confirmed valid against
  the installed `codex-cli 0.139.0` (`codex exec --help`: `-c, --config
  <key=value>`, example `-c model="o3"`; `-s read-only` is a listed sandbox
  value). — invalidated when: a fleet `codex-cli` upgrade changes the accepted
  config-flag syntax, OR the "role files carry NO mechanism language" constraint
  is read to forbid `codex-executor` from naming the flag form at all (forcing the
  coordinator to pass a fully-rendered launch command), OR the installed Codex
  default drifts off `gpt-5.5` making the explicit model pin load-bearing rather
  than belt-and-suspenders.
- `codex-executor` returns lens findings already shaped to
  `PERSONA_FINDINGS_SCHEMA` (its camelCase fields, the `confidence` enum
  `[0,25,50,75,100]`, the `findings` array-of-objects) with no snake_case remap
  layer, because Codex enforces strict structured output against the
  caller-supplied schema and the seam IS `PERSONA_FINDINGS_SCHEMA` verbatim. —
  invalidated when: `codex exec` strict-output rejects the nested/enum shape and
  forces a flattened intermediate schema plus a remap step inside the executor,
  which would put per-schema mapping logic in the executor and break its
  role-agnosticism.
- The 12 extracted role files plus `codex-executor` can each be authored slim
  enough that the dispatched-fleet line total (counting `plan-fixer` and
  `plan-checker` once each despite multiple dispatch sites) stays under the strict
  S42 ceiling of 1471, starting from the live 967-line baseline (~503 lines of
  headroom for 13 files, ~38 lines/file). — invalidated when: the authored total
  of the new files plus the existing fleet reaches or exceeds 1471 at test time
  (strict `<` fails at equality), forcing further trimming or a deliberate,
  surfaced raise of the 1471 constant in U3's verification note.
- All `shepherd-plan.js` edits fit in one implementation unit (U2): the de-inline,
  the lens wiring, and the model pins are one atomic change, and sibling units
  (new role files, tests, docs) depend on U2 via `dependsOn` rather than
  co-owning the coordinator file. — invalidated when: a coordinator edit cannot be
  expressed without a second unit also writing `workflows/shepherd-plan.js` on an
  independent path, which the M13 file-overlap gate would then halt (the failure
  mode that stopped the superseded plan).
- `PERSONA_FINDINGS_SCHEMA` is the executor-orthogonal seam: because the
  synthesis/refutation/gate pipeline consumes findings through it regardless of
  producer, swapping the leaf lens executor from Claude to Codex keeps the
  synthesis CODE byte-identical, and the deterministic harness proves the wiring
  and the default-path outcome on identical stubbed findings. — invalidated when:
  any post-ship A/B run shows the executor swap changes WHICH findings reach
  synthesis (it will — the executor is behaviorally non-orthogonal even though the
  synthesis code is unchanged); the deterministic harness cannot detect this, so
  the claim is testable only via the playground sim.
- scope/framing: Codex `gpt-5.5` at `xhigh` reviewing a markdown PLAN read-only
  (no compile/test/sandbox-execution signal) produces lens findings at least as
  useful as the current Claude lenses on the same briefs. — invalidated when: a
  post-ship A/B (Claude-lens vs Codex-lens, identical briefs, >= 2 runs per arm,
  judged on findings that survive the precision-biased refuter) shows the Codex
  arm producing fewer or lower-quality surviving findings, at which point the
  ON-by-default decision is revisited.
- scope/framing: feeding Codex-produced lens findings into the PRECISION-biased
  `skeptical-refuter` (drop-on-uncertainty) preserves plan quality despite being
  the INVERSE verdict default from where Codex-as-producer was validated on
  deliver (the RECALL-biased `finding-verifier`, keep-on-uncertainty + conservative
  fix). — invalidated when: an A/B shows the Codex+precision-refuter arm drops a
  materially higher fraction of real findings (lower plan-side recall) than the
  Claude+precision-refuter arm — i.e. the refuter refutes Codex's cross-model
  phrasings more readily than Claude's same-family phrasings.
- `docs/practice/parity-ce-plan.md` is authored fresh under `docs/practice/` as
  the canonical hub-linked matrix, using the existing untracked
  `docs/comparisons/ce-plan-vs-shepherd-plan.md` as raw material (left in place,
  not relocated or promoted to be the deliverable). — invalidated when: the
  maintainer intends the existing `docs/comparisons/` artifact itself to BE the
  parity deliverable (merely moved), or wants the parity doc under
  `docs/comparisons/` rather than `docs/practice/`.
- The test harness needs a dedicated `ran=false` dispatcher branch (added in U3):
  it records `agentType` already (`workflows/shepherd-plan.test.mjs:19`) and
  routes by label prefix, so lens dispatches keeping `review-r*-*` labels still
  resolve via the existing dispatcher when `agentType` becomes `codex-executor`;
  BUT the all-lenses-ran=false scenario requires a branch that returns `{ findings:
  [], ran: false }` for `codex-executor` dispatches when a `codexUnavailable` stub
  flag is set. — invalidated when: the coordinator's `ran=false` guard is
  implemented at the data shape level (checking the returned object shape rather
  than a stub flag), removing the need for a special dispatcher branch.
- Nested-Codex-sandbox detection: `codex-executor` guards against the nested-sandbox
  case (binary present but unusable) by checking `$CODEX_SANDBOX` and
  `$CODEX_SESSION_ID` before running `command -v codex`, mirroring
  `shepherd-deliver.js:342/:356`. The `codexUnavailable` stub in U3 covers BOTH
  the binary-absent and sandboxed conditions — the two are operationally
  indistinguishable to the coordinator (both yield `ran=false`). — invalidated
  when: a future Codex CLI version introduces a different env-var name for nested
  sandbox detection, or the harness needs to distinguish the two `ran=false` reasons
  (e.g. for a more targeted error message), requiring separate stub branches.
- S42 budget arithmetic is built on the baseline of the LIVE trace-derived union
  (967 lines / 14 files — verified by running the suite), not on a static 15-file
  list. Critically, R8 / U2 lens-wiring replaces the 7 lens dispatches from
  `agentType: p.type` (coherence-lens...adversarial-lens) to `agentType:
  'codex-executor'`, which means the 7 lens agentType strings DROP from the
  trace-derived union and are replaced by a single `codex-executor` entry. The
  plan's stated S42 arithmetic (967 baseline + 503 new = 1470) double-counts the
  lens files: the live post-refactor baseline is closer to (967 - 229 lens lines)
  + new-files, giving significantly more headroom than the stated 503-line budget.
  Implementers should run S42 after authoring and treat the test gate as the
  source of truth; the 1471 constant is held unless the gate fails. — invalidated
  when: the S42 trace-union includes a dispatch path that re-adds the lens
  agentType strings (e.g. a fallback branch that dispatches `agentType: p.type`
  for non-codex lenses), restoring them to the counted fleet.
- Numeric-enum + nested-object strict-output risk: `PERSONA_FINDINGS_SCHEMA`
  carries a numeric `confidence` enum (`[0,25,50,75,100]`) and a nested
  `findings` array-of-objects with four string enums. The only proven Codex
  strict-output schema in this repo (`agents/codex-reviewer.md`) is flat with
  string-only enums. The assumption that `codex exec` accepts the nested/numeric
  schema shape for strict output is unvalidated. — invalidated when: `codex exec`
  strict-output rejects the numeric confidence enum or the nested findings array,
  forcing a flattened intermediate schema and a remap step inside
  `codex-executor`; if this occurs, `codex-executor` can no longer be fully
  role-agnostic (it would carry per-schema mapping logic) and the design must be
  revisited.
- Codex I/O protocol unverified by test harness: the deterministic harness
  validates wiring on stubbed findings only; no test exercises `codex-executor`'s
  actual I/O protocol (mktemp scratch dir, schema serialization, background launch,
  poll loop, `ran: true` on success). The Codex lens path therefore ships with zero
  executable verification of the executor's own behavior; the harness stubs
  `agent()` by label (`workflows/shepherd-plan.test.mjs:18-27`; `:170` returns
  `{ findings: [] }` for `review-*` labels), so lens-via-codex tests return
  coordinator-supplied stub findings and never actually run `codex exec`. —
  invalidated when: an integration test or a separate executor-smoke test runs
  `codex-executor` end-to-end against a fixture plan and verifies that the returned
  object contains `ran: true` and a conforming `PERSONA_FINDINGS_SCHEMA` shape.

## Open Questions
- S42 budget arithmetic assumes all 13 new files are counted, but the existing
  two-run S42 union may never dispatch `committer`, `origin-coverage-auditor`,
  and `spike-investigator` under the DEFAULT dispatcher path. S42 derives its
  fleet from trace.calls agentTypes across the registered runs; if those three
  roles only fire in the extended four-run union (the `origin`+`originVersion`,
  `designUnknowns`, and on-union runs), they appear only in the FOUR-run union
  check. U3 must confirm the four-run union (not just the two-run union) feeds
  the S42 budget check so those three files are not silently excluded from the
  line-count. Open until U3's updated S42 scenario is written and passes.
- S42 budget arithmetic may contradict R8 lens-dispatch change: the 7 lens
  files will drop from the trace-derived union once their agentType changes from
  `p.type` (coherence-lens...adversarial-lens) to `'codex-executor'`. If S42
  uses a two-run union that currently includes those 7 types, the post-refactor
  baseline drops (the lens files are no longer counted), and the headroom figure
  changes. U3 must recompute the actual headroom AFTER the refactor by running
  the test, not by relying on the pre-refactor baseline. Open until U3 runs S42
  against the refactored fleet.
- Floor-lowering on releasability and gate-fix (inherit -> sonnet): R7 pins
  mechanical roles to `model: 'sonnet'`, including `releasability-checker` and
  `gate-fix`. These dispatches currently carry NO model field and inherit the
  session model. Pinning them to `'sonnet'` FLOORS those dispatches at sonnet
  even when the autonomous pipeline runs under an opus session, silently
  downgrading the releasability check from opus to sonnet when run in an opus
  session. Is this the intended behavior, or should `releasability-checker` and
  `gate-fix` also be listed in the plan-side opus-override exception? Open until
  the maintainer confirms or the R7 rationale ("all mechanical roles stay sonnet")
  is accepted as covering these two sites explicitly.
- Numeric-confidence enum strict-output probe must be run before U1 is
  implemented: the spike found that the only proven Codex strict-output schema in
  this repo (`agents/codex-reviewer.md` line 26) uses flat, string-only enums
  while `PERSONA_FINDINGS_SCHEMA` carries a numeric `confidence` enum
  (`[0,25,50,75,100]`) and a nested `findings` array-of-objects. Whether `codex
  exec` strict output accepts this shape is unvalidated. The probe consists of
  two arms: Arm A submits `PERSONA_FINDINGS_SCHEMA` verbatim (with
  `additionalProperties: false` injected at every object level) to `codex exec
  --strict` with a trivial prompt and observes accept/reject; Arm B replaces
  `confidence: { enum: [0,25,50,75,100] }` with `confidence: { type: "number" }`
  (or string equivalents) and confirms it succeeds. If Arm A fails, `codex-executor`
  cannot be fully role-agnostic: it must add a named schema-remap step (converting
  numeric confidence enums to string equivalents before writing `schema.json`, and
  remapping back to numbers in returned findings); this remap is small but
  per-schema-specific and must be documented as a named exception to
  role-agnosticism in `agents/codex-executor.md`, not hidden. If Arm A succeeds,
  proceed with the design as written — the `PERSONA_FINDINGS_SCHEMA` seam is
  compatible and no remap layer is needed. Open until the probe is run by U1's
  executor; the result resolves the existing Assumption at lines 788-798 (the
  "Numeric-enum + nested-object strict-output risk" entry).

- S42 budget arithmetic double-counting: the '503 new lines / ~38 lines per
  file' authoring constraint double-counts the 7 lens files that leave the
  trace-derived S42 union. S42 (`workflows/shepherd-plan.test.mjs:1455-1467`)
  derives the fleet from `trace.calls` agentTypes. After R8 the 7 lens dispatches
  change from `agentType: p.type` to `agentType: 'codex-executor'`, so the 7 lens
  files (229 lines, verified by `wc -l`) DROP from the union. The real
  post-refactor baseline is (967 - 229) = 738 lines, giving ~733 lines of headroom
  (738 + 733 = 1471; strict `<` passes). The per-file ceiling stated in U2 is
  therefore conservative; implementers should treat the test gate (S42) as the
  source of truth and use the additional headroom rather than over-trimming. Open
  until U3 runs S42 against the refactored fleet and records the actual total.
- U2 budget arithmetic contradiction: U2's '967 + 503 = 1470' arithmetic is
  contradicted by the plan's own lens-drop consequence: S42 derives the counted
  fleet from `trace.calls` agentTypes (`workflows/shepherd-plan.test.mjs:1455-
  1467`); when the 7 lens dispatches change from `agentType: p.type` to
  `agentType: 'codex-executor'` (R8), the 7 lens files (229 lines total) DROP out
  of the union and are no longer counted. The real headroom is ~733 lines, not 503.
  U3 must recompute by running S42, not by relying on the stated 503-line figure.
  Open until U3 records the actual post-refactor S42 total.
- Lens context field gap: RESOLVED. U2's Approach now specifies that the
  `context` field of the `<codex-exec-brief>` must carry the FULL output of
  `reviewPrompt(p, r)` for that lens — the entire assembled string including the
  `<review-context>` block (Document type / Origin), `CONFIRMED_INTENT`,
  `CODEBASE_CONTEXT`, `primerBlock()`, `ANCHOR_RUBRIC`, and per-lens appendices
  (e.g. the coherence glossary). The simplest implementation passes the entire
  `reviewPrompt(p, r)` return value as `context` and has `codex-executor`
  concatenate the role file ahead of it in `prompt.md`. The instruction to NOT
  hand-pick a subset is now explicit in U2's Approach, with the adversarial-lens
  and coherence-lens dependencies named as the reason.
- S43 per-review schema assertion breakage: RESOLVED. U2 KEEPS
  `schema: PERSONA_FINDINGS_SCHEMA` on the `agent()` opts of every
  `review-r*-${p.key}` dispatch alongside the `<codex-exec-brief>` prompt block.
  The schema appears in both places: the `agent()` opts field preserves S43's
  `assert.ok(c.schema)` assertion verbatim; the serialized body field provides it
  to the Codex executor. S43 requires no change. U3's known-break enumeration
  records this as a non-break.
- Floor-lowering on releasability and gate-fix under opus session: R7 pins
  `releasability-checker` and `gate-fix` to `model: 'sonnet'`, which floors them
  below opus when the pipeline runs under an opus session. This is an intentional
  behavior change (inherit -> sonnet). The plan's stated rationale ("all mechanical
  roles stay sonnet") covers it, but the floor-lowering is a real quality
  downgrade for the releasability check specifically. Open until the maintainer
  confirms or the R7 rationale is explicitly accepted as covering these two sites.
- Plan-side Codex consent model gap: this plan routes lenses through Codex
  unconditionally (no operator opt-out, only an availability guard), while
  `shepherd-deliver` makes Codex an explicit opt-out-able choice
  (`CODEX_ENABLED = args.codex !== false`). The plan correctly notes the captive
  operator context justifies the difference; the gap remains a documented
  architectural divergence between the two coordinators. Open as a known-cost
  observation; no blocking action required unless the maintainer later standardizes
  the opt-out contract across both coordinators.
- Re-derived lens files and S40/S42 budget coverage after the refactor: S40
  (`workflows/shepherd-plan.test.mjs:1407-1416`) derives its on-disk check from
  `trace.calls` agentTypes. After R8 the 7 lens agentType strings
  (coherence-lens...adversarial-lens) no longer appear in any dispatch, only
  `codex-executor` does, so S40 stops requiring `agents/coherence-lens.md` etc.
  to exist on disk. The lens files are still read by `codex-executor` at runtime
  (via the `role_file` field), but no test enforces their on-disk presence after
  R8. U3 must add an explicit on-disk existence check for the 7 lens files
  independent of the trace-derived S40 union (e.g. a static list grep or a file-
  exists assertion), so a deleted lens file is caught at test time. Open until U3
  adds this assertion.
- Committer excluded from S40/S42 coverage: the prescribed four-run S40/S42 union
  never fires `commit-plan` because `args.commit === true` is never set in the
  test ARGS (`workflows/shepherd-plan.test.mjs:188`); S14 case (b) at `:554` is
  the only commit run. U3's four runs (default, origin+originVersion,
  designUnknowns, persona-on) do not include a commit run, so `committer` is
  excluded from the on-disk and budget coverage. U3 must either add a fifth run
  with `args.commit = true` to the coverage union, or add a static assertion that
  `agents/committer.md` exists on disk, to prevent a missing committer file from
  silently bypassing the gate. Open until U3 resolves the committer coverage gap.

## Deferred to Implementation
- The exact prose wording of each extracted role file's judgment contract (within
  the per-file line ceiling) — an authoring detail, provided the doctrine moved
  from the coordinator's inline prompt is preserved and the `skills/` rebinding
  blocks (where applicable) are kept.
- The exact `<codex-exec-brief>` field ordering and tag names inside the
  `codex-executor` dispatch prompt — an authoring detail, provided the block
  carries role, `gpt-5.5`, `xhigh`, the serialized schema, the document path,
  role_file, and the assembled context from `reviewPrompt(p, r)`.
- Whether the README hub-link to `parity-ce-plan.md` is added in U4 or U5 — U5
  owns `docs/practice/README.md` in the chosen split; if reassigned, the
  `dependsOn` edge follows the owner.
