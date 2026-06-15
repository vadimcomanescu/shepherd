# shepherd-plan: the plan-production deep dive

`shepherd-plan` is the first half of the Shepherd practice (plan, then deliver). It takes a request (or an origin brainstorm doc), researches the target repo, challenges the framing, authors one `ce-plan`-format plan document, drives it through a bounded editor loop and final gates, and emits a machine-readable run summary a human uses to launch [`shepherd-deliver`](./deliver.md). The whole thing is a single dynamic-workflow coordinator script (`workflows/shepherd-plan.js`) over the substrate described in [`../workflows/README.md`](../workflows/README.md). The coordinator itself does no I/O: every repo read, file write, git command, and web fetch is performed by an agent.

New to the project? Start at the [practice hub](./README.md), skim the [fleet catalog](./fleet.md) for who the agents are, and read [verification.md](./verification.md) for the refutation and honesty mechanics this doc cross-links to.

## The args contract

`shepherd-plan` is invoked by convention through its `meta.name` (the script lives in `workflows/` and is whole-directory symlinked into `.claude/workflows/`). It runs autonomously: no interactive questions, and a blocking unknown becomes a structured halt rather than a prompt. The args (from `meta.whenToUse`, verified against the preflight zone in `shepherd-plan.js`):

| Arg | Type / default | Meaning |
|-----|----------------|---------|
| `request` | string | What to plan. `request` OR `origin` is **required** (the preflight zone throws if neither is present and non-empty). |
| `origin` | path | A brainstorm / requirements doc to plan from. Supplying it bypasses the trivial-request off-ramp (the caller deliberately wants a plan). |
| `originVersion` | hash-or-mtime, default `unversioned` | Pass a NEW value after editing the origin doc so a resume does not replay a stale cached research pass. |
| `depth` | `lightweight` \| `standard` \| `deep` | Pins the depth tier. Omitted -> the intake agent derives it. Any other value throws. |
| `editorRounds` | 1..5, default 3 | The single outer review-loop bound. An explicit value always wins; at `lightweight` the bare default lowers to 2. |
| `reviewRounds` | 1..3, default 2 | How many rounds the persona sub-stage stays active (NOT a second loop counter). At `lightweight` the bare default lowers to 1. |
| `spikes` | bool, default true | Enables the one-shot read-only spike branch in Review. |
| `externalResearch` | bool, default true | Enables web / external-grounding researchers. |
| `tokenBudget` | output-token target | The run halts gracefully at phase boundaries when the remaining budget falls to the 30000-token floor (`BUDGET_FLOOR`). A runtime `budget.total` takes precedence. |
| `commit` | bool, default false | `commit: true` IS the consent to commit the plan file. Strict `=== true`; nothing else commits. |
| `date` | `YYYY-MM-DD` | Pins the plan-file date. Omitted -> the author derives it. Bad format throws. |

The preflight args zone is the only place in the coordinator that `throw`s. Every later failure resolves to the fixed-shape run summary instead (`summary()` helper, milestone M17). An optional first-class `args.repo` exists (not in `whenToUse`): when set, the coordinator wraps the `agent()` dispatcher to prefix every prompt with a TARGET REPOSITORY grounding block so agents work against a sibling checkout, with an explicit carve-out that `skills/` doctrine paths still resolve from the session start directory.

## The seven phases

```
 S0 Intake     lock Confirmed Intent, classify unknowns, set depth tier, pick research intent
    |          (4 halt paths + trivial-request directPrompt off-ramp)
    v
 S1 Research   dynamic researcher roster in ONE parallel() barrier; assemble CODEBASE_CONTEXT
    |          (repo + learnings always; web/grounding by intent; flow at standard/deep; cross-plan)
    v
 S2 Gate       strategy/scope challenge BEFORE drafting -> proceed | adjust | halt (no redraft branch)
    |
    v
 S3 Draft      plan-author writes ONE file under docs/plans/ (permanent U-IDs/R-IDs);
    |          persona classifier selects conditional lenses + extracts KTDs
    v
 S4 Review     THE BOUNDED EDITOR LOOP (for r = 1..EDITOR_ROUNDS): personas -> synthesis ->
    |          refutation -> fixer -> checker -> editor verdict (+ one-shot spike). The heart.
    v
 S5 Gates      parse conformance (UNITS_SCHEMA) | releasability | origin coverage | cross-plan overlap
    |
    v
 S6 Finalize   hygiene check, optional commit, machine-readable RUN SUMMARY (planPath + planVersion)
```

The handoff from `shepherd-plan` to `shepherd-deliver` is **manual / operator-mediated**, not programmatic. The run summary carries `planPath`, `planVersion`, and a human-readable `nextStep` string; a person (or an outer tool) copies those into a separate `/shepherd-deliver` invocation. Plan output never flows automatically into deliver.

A word on stage tags: the `haltStage` values (`S0-intake`, `S2-strategy-gate`, `S4-halt-class-finding`, `S5-parse-gate`, and so on) are literal string tags written at each return site. They are not enumerated constants; the `S0`/`S1`/... numbering lives in comments and the tag strings, not a stage enum.

---

## S0: Intake

Intake dispatches the **`intake-classifier`** persona (label `intake`, `agentType: 'intake-classifier'`, `model: 'opus'`, schema `INTAKE_SCHEMA`). It produces the structured spine the rest of the run depends on:

- **Confirmed Intent**: a six-field object (`outcome`, `user`, `whyNow`, `success` as an observable statement, `constraints[]`, `outOfScope[]`). It is serialized to a `<confirmed-intent>` block and threaded into every downstream agent (each agent has a fresh context window and sees only what its prompt carries).
- **Unknown classification**: `blockingUnknowns` (could materially change the outcome AND would likely upset the requester if guessed wrong) vs `decidableUnknowns` (everything else, each decided with a hypothesis plus the observation that would invalidate it). Decidable unknowns flow into the plan's `## Assumptions` section.
- **One-thing split**: three tests (the `and` test, the independence test, the `what changed`/own-PR test). If the request is multiple, only the primary is planned; excluded items are routed to Scope Boundaries -> Deferred to Follow-Up Work.
- **Depth tier**: if `args.depth` was pinned, returned unchanged; otherwise derived as lightweight (2-4 units) / standard (3-6) / deep (4-8).
- **Research intent**: an enum (`implementation-guidance` | `landscape` | `mixed` | `version-specific framework` | `none`) plus a reason, which selects the conditional researchers in S1.
- **Below-floor judgment**: `belowFloor.verdict` is true ONLY when ALL hold -- touches at most 2 files, introduces no new module or interface boundary, carries no data/auth/migration/concurrency risk, needs no cross-component coordination, and its verification is a single obvious command or observation.

### The four S0 halt paths

Each returns through `summary('halted', ...)`:

1. `S0-intake` -- the intake agent returned null.
2. `S0-intake` -- `nonCodeDeliverable === true` (knowledge work; `shepherd-plan` only produces implementation plans for `shepherd-deliver`).
3. `S0-blocking-unknowns` -- `blockingUnknowns.length > 0`; the questions go to `openQuestions` and the caller must answer them before re-invoking.
4. `S0-below-floor` -- the trivial-request off-ramp.

### The trivial-request directPrompt halt

When `belowFloor.verdict === true` AND no depth is pinned AND no origin was supplied, the run halts at `S0-below-floor` and returns `directPrompt`. The `directPrompt` is a complete, self-contained **executor brief for a human or another tool**: it names the exact files and edits, states the repo conventions (conventional commit, stage touched files by name, run the repo's test command), and says what evidence to report back. It is NOT fed to `shepherd-deliver`. Pinning `args.depth` or passing an origin forces a full plan instead, because either signals the caller deliberately wants one.

---

## S1: Research

Research builds a **dynamic roster** of context-less researcher agents and dispatches the active subset in a single `parallel()` barrier. The barrier is justified (per [substrate principle 2](../workflows/README.md)): the S2 strategy gate and the `CODEBASE_CONTEXT` assembly both need the full prior result set together. Every researcher runs on `model: "sonnet"` because the work is mechanical digest extraction, and every one is grounded with `researchGrounding` (the Confirmed Intent block, the raw request, and the origin path + version when present).

| Researcher | `agentType` | When | Schema | Output |
|-----------|-------------|------|--------|--------|
| repo-researcher | `repo-researcher` | always | `REPO_RESEARCH_SCHEMA` | repoRoot, stackDigest, conventionsDigest, testingDigest, relevantFiles, contextMdPath |
| learnings-researcher | `learnings-researcher` | always | `DIGEST_SCHEMA` | digest (mined from `docs/solutions/`), sources |
| web-researcher | `web-researcher` | `externalResearch` AND intent `landscape` or `mixed` | `DIGEST_SCHEMA` | landscape / prior-art digest |
| external-grounding-researcher | `external-grounding-researcher` | `externalResearch` AND intent `implementation-guidance`, `version-specific framework`, or `mixed` | `DIGEST_SCHEMA` | current external implementation guidance |
| flow-analyzer | `flow-analyzer` | DEPTH is not `lightweight` | `FLOW_SCHEMA` | flow digest, edgeCases |
| cross-plan scanner | `cross-plan-scanner` | always, pushed last | `CROSS_PLAN_SCHEMA` | activePlans[] (path, title, files, riskSurfaces) from `status:active` plans |

On `mixed` intent both external researchers are added (web first, grounding second). The cross-plan scan uses the `cross-plan-scanner` persona (`model: 'sonnet'`); its failure is fail-open (the coordinator logs and pushes `cross-plan overlap unverified` into `openQuestions` rather than halting). See the [fleet catalog](./fleet.md) for the full persona descriptions; all six researchers above are personas (files in `agents/`).

The roster is capped to `RESEARCH_CAP` (lightweight 3, standard/deep 6) by `slice`; any dropped researcher is surfaced with `log()` (no silent caps). The outputs are folded into a single `<codebase-context>` block (`CODEBASE_CONTEXT`) carried into S2 and S3.

---

## S2: Gate

Before a single line of the plan is drafted, the **`strategy-gate`** persona (label `strategy-gate`, `agentType: 'strategy-gate'`, `model: 'opus'`, schema `STRATEGY_SCHEMA`) challenges the framing. It receives `CONFIRMED_INTENT`, `CODEBASE_CONTEXT`, and the optional origin doc, and applies a deliberate asymmetry: a LOW bar to redirecting the approach (do not preserve the intake framing just because it exists) and a HIGH bar to halting (halt only when proceeding would bake in a decision the requester must make). It separately reports a scope delta against the intake scope claim (capability already exists / approach conflicts with the architecture / scope is materially larger than stated).

It returns one of three verdicts:

- **proceed** -- no change.
- **adjust** -- replace the framing: `adjustedFraming` + `scopeDelta` are injected as an `<adjusted-framing>` block into the author's prompt, and `loggedAssumptions` are folded into the running assumptions list.
- **halt** -- return at `S2-strategy-gate` with `scopeDelta` and `haltReason` pushed to `openQuestions`.

There is no redraft branch: S2 is pre-draft by design. If the agent dies, the gate fails open (proceed with unadjusted framing).

---

## S3: Draft

Two agents run in sequence.

**plan-author** (the persona `agents/plan-author.md`, dispatched as `agentType: 'plan-author'`, `model: 'opus'`, schema `AUTHOR_SCHEMA`) writes **exactly one file** under `docs/plans/` and nothing else. It is the only plan-side persona holding `Write` and `Edit` tools. Before authoring it **reads five doctrine skills** (`skills/decomposition`, `skills/scoping`, `skills/interface-design`, `skills/test-strategy`, `skills/zero-context-planning`; all but `validating-agent-improvements`). It owns initial **U-ID** and **R-ID** assignment, which are permanent: never renumbered or reused across revisions. It derives the filename (`docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md`, NNN from counting today's files in `docs/plans/`) and writes against the `PLAN_TEMPLATE` hard floor (the minimum section set, byte-compatible with `ce-plan`'s catalog: frontmatter, Summary, Problem Frame, Requirements, Key Technical Decisions, Implementation Units, Scope Boundaries, Assumptions, Deferred to Implementation, Open Questions; plus include-when-material sections only when their rules fire, and never a section outside the catalog).

Its returned evidence (`planPath`, `uidNamePairs`, `rIds`, `unitCount`, `requirementCount`) is reported honestly because it is **cross-checked against an independent parse** downstream. The author's `detail` field is used only for logging and is never threaded into a later prompt (no-claim-passing). If the author returns null, the run halts at `S3-draft`.

The **`persona-classifier`** persona (label `classify-personas`, `agentType: 'persona-classifier'`, `model: 'sonnet'`, schema `CLASSIFY_SCHEMA`) then reads the written file at `planPath` and does two things:

- Selects conditional review lenses via five booleans with explicit trigger rules: `productLens` (challengeable premise OR strategic weight), `designLens` (UI/UX, flows, accessibility), `securityLens` (auth/authz, exposed endpoints, PII/credentials, trust boundaries), `scopeGuardian` (multiple priority tiers, >8 requirements, stretch goals, misaligned scope language), `adversarial` (high-stakes domain, new abstraction/framework, greenfield with no origin, scope extension, explicit tradeoffs; explicitly NOT triggered by structural complexity alone).
- Extracts the document's **Key Technical Decisions** (quoted, ordered most-load-bearing first) and `loadBearingAssumptions` for use in Review.

The selection is computed once and held for all review rounds. If the classifier fails, conditional lenses and KTD refutation are skipped (only the always-on coherence and feasibility lenses run) and an `openQuestions` entry is recorded.

---

## S4: Review (the bounded editor loop)

This is the heart of the practice. One outer loop runs `for (let r = 1; r <= EDITOR_ROUNDS; r++)`. There is no second loop counter; `PERSONA_ROUNDS` only controls how many rounds the persona sub-stage stays active. The loop starts each round with a budget-floor guard (halt `S4-budget-floor` if the remaining budget reaches the 30000-token floor). Per round, six sub-stages run in order, plus a once-per-run spike branch. The deep mechanics of refutation, verdict-inversion control, and honesty rules live in [verification.md](./verification.md); the loop shape is below.

### (a) Persona lenses

Active only in rounds `1..PERSONA_ROUNDS`. Two lenses are **always on**: coherence-lens and feasibility-lens. Up to five conditional lenses (product-lens, design-lens, security-lens, scope-lens, adversarial-lens) are appended per the classifier's selection. Three are owned lenses rebound to doctrine skills: scope-lens (`skills/scoping`), feasibility-lens (`skills/test-strategy`), coherence-lens (`skills/interface-design` + `skills/decomposition`). The roster is capped at `PERSONA_CAP` (standard/deep 8, lightweight 4) and dispatched as a `parallel()` barrier (synthesis needs the full round's findings).

**Each lens is dispatched through `codex-executor` at Codex `gpt-5.5` / `xhigh` as the default.** Each lens dispatch uses `agentType: 'codex-executor'`, `model: 'sonnet'` (operator tier), and carries a `<codex-exec-brief>` DATA block naming the lens role file, the Codex model and effort, the serialized `PERSONA_FINDINGS_SCHEMA`, the plan path, and the full assembled review context from `reviewPrompt(p, r)` (the entire string including `<review-context>`, `CONFIRMED_INTENT`, `CODEBASE_CONTEXT`, `primerBlock()`, `ANCHOR_RUBRIC`, and any per-lens appendix). The executor reads the lens role file from disk and concatenates its content into `prompt.md`. When a lens's `codex-executor` run returns `ran: false`, the coordinator re-dispatches that lens on its native Claude `agentType` (e.g. `coherence-lens`) at the session model. Every lens always contributes a full review. Each lens returns `PERSONA_FINDINGS_SCHEMA` (section, title, severity P0-P3, findingType error|omission, confidence in {0,25,50,75,100}, autofixClass safe_auto|gated_auto|manual, verbatim evidence, whyItMatters, suggestedFix). Reviewers are never handed the author's free text; reviewing the path is what keeps the review independent of the author's claims. In rounds beyond `PERSONA_ROUNDS`, the persona stage is disabled (editor-convergence rounds).

### (b) Synthesis (pure coordinator JS, zero agents)

Merge this round's findings with carried findings; drop confidence 0/25; fingerprint-group (`norm(section)::norm(title)`) and merge pairs (severity wins, then confidence, then suggestedFix lexicographic); **cross-persona promotion** (2+ distinct reviewers on one fingerprint raise confidence one step and flag `promoted`); R29 primer suppression (drop findings already decided rejected/documented with evidence overlap); contradiction resolution; deterministic sort. Anchor-50 findings are split off as advisory FYIs (never refuted or fixed, surfaced as residuals at the end); confidence >= 75 becomes actionable.

### (c) Refutation (adversarial, fail-closed)

A finding is **gating** (subject to refutation) if P0 or P1, OR if promoted AND error AND manual. Gating findings beyond `FINDING_REFUTER_CAP` (standard/deep 16, lightweight 6) are routed to documentation without verification (logged).

- **Halt-class findings** (P0 AND manual AND no suggestedFix) are evaluated FIRST, with a **3-way `skeptical-refuter` majority** (`VERDICT_SCHEMA = {refuted, reason}`, `model: 'opus'`). Null votes count as refuted (fail-closed against halting). If **2 of 3** sustain, the run halts at `S4-halt-class-finding`. `HALT_CLASS_CAP` (standard/deep 3, lightweight 1) bounds these procedures per run; overflow is documented.
- **Remaining gating findings (singles)** get one `skeptical-refuter` each via `pipeline()` (`model: 'opus'`). A null or a `refuted: true` drops the finding (fail-closed). Survivors become `confirmedGating`.
- **KTD / assumption refutation** runs once in round 1, and again only after a fixer touched the Key Technical Decisions section (`ktdDirty`), bounded by `KTD_PASSES_CAP`. One `skeptical-refuter` agent per claim (label `ktd-refute-p<pass>-N`, `model: 'opus'`) via `pipeline()` returns a **referent-explicit** verdict (`KTD_VERDICT_SCHEMA`): `claim-correct` (refutation failed), `claim-refuted` (concrete contradicting evidence), or `unverifiable` (cannot be settled from code and docs). An `unverifiable` verdict **surfaces to Open Questions** (a `pendingDocEntry` plus an `openQuestions` line) and does NOT block, per fail-if-uncertain-means-surface. A `claim-refuted` verdict triggers a separate **2-of-3 arbitration of the DECISION ITSELF** (`KTD_ARBITRATION_SCHEMA`: `ktd-is-wrong` | `ktd-is-right` | `cannot-tell`); the arbiters receive the KTD and the challenge directly, never a wrapped finding, which is the mechanism that kills verdict-inversion from stacked negations. 2-of-3 `ktd-is-wrong` halts at `S4-halt-class-finding`. KTD arbitrations beyond `KTD_HALT_CAP` increment `refutedKtdOverflow`, route the claim to Open Questions, and **permanently void any READY exit** for the run.

### (d) Reconciliation + fixer

Two authority classes get applied; everything else is documented. `confirmedGating` findings with a `suggestedFix` get `refutationSurvived: true` and go to the fix-now batch; non-gating findings at `safe_auto` + confidence 100 with a `suggestedFix` get `refutationSurvived: false` and also go fix-now. Both batches are paraphrase-deduped, then a single sequential **`plan-fixer`** (label `fix-round-${r}`, `agentType: 'plan-fixer'`, `model: 'sonnet'`, `FIX_SCHEMA`) applies the fixes and documents the rest. Protected surfaces (Requirements set, Scope Boundaries, U-ID/Dependencies structure) require `refutationSurvived: true` to edit; scope-widening proposals are returned unapplied; U-IDs/R-IDs may be added or deleted, never renumbered. The fixer must account for every finding (`applied` / `documented{routedTo}` / `unapplied{reason}`); unaccounted findings become residuals. A decision-primer entry is written per finding (one bucket each), feeding R29 suppression and the next round's reviewer prompts.

### (e) Checker + JS battery

A post-mutation checker (`check-${tag}`, `model: "sonnet"`, `CHECKER_SCHEMA`, one bounded retry) re-reads the document and reports fix fidelity plus the structural inventory. A pure-JS battery then: re-opens fixes that did not land faithfully; drops stale findings; runs a **U-ID/R-ID stability diff** (a vanished or renumbered ID triggers a `refix-uid` agent and a recheck; persistent violation halts at `S4-uid-stability`); injects P1 findings for independent units sharing a file with no dependency path; and refreshes the evidence counts. A double-null checker halts at `S4-post-mutation-check`.

### (f) Editor verdict

A fresh **plan-editor** (the persona `agents/plan-editor.md`, `agentType: 'plan-editor'`, `model: 'opus'`, `EDITOR_SCHEMA`) is solicited each round. It is **read-only** (it never edits; fixes are applied and verified by other agents), reads the same five doctrine skills, and is judged on verdict correctness (an unnecessary rewrite is a failure; missing a real problem is a failure). It must enumerate every way executing the plan could fail before choosing `READY` or `REVISED`, and reports `designUnknowns`, per-unit `approachValidated`, and an evidence block (`planPath`, `unitCount`, `requirementCount`, `sectionsPresent`) from its own reading.

The loop **exits READY** only when ALL hold: `ed.verdict === 'READY'`, the editor's self-reported `blockingCount === 0`, the coordinator's own recount of P0/P1 findings (`editorBlocking`) is 0, `designUnknowns.length === 0`, `refutedKtdOverflow === 0`, and the evidence block matches coordinator state. A READY whose evidence is wrong is **discarded** (treated as REVISED). A READY that fails ONLY on count/path evidence triggers one `check-evidence-r${r}` arbitration (the checker, not either self-report, owns the counts); if that reconciles, READY is accepted. A READY carrying only P2/P3 minor findings is accepted and the minors are documented (anti-churn). Any rejected READY carries its findings forward as `carryFindings`.

### (g) Spike branch (once per run)

Guarded by a boolean `spikeDone`, this fires when the editor reports `designUnknowns`, spikes are enabled, and a round remains to consume the results. Spikes are **read-only investigations** (no execution of any kind; a question answerable only at runtime returns `runtime-blocked`), dispatched via `pipeline()` up to `SPIKE_CAP` (standard/deep 3, lightweight 1). Each returns `SPIKE_SCHEMA` (`resolved` | `documented-trade-off` | `runtime-blocked`); a `revise-spike` agent folds results into the document in one pass (resolved -> update Approach; trade-off -> append to Assumptions; blocked -> append to Open Questions), respecting protected surfaces. A second spike request in a later round carries the unknowns as P1 findings instead.

If the loop exhausts `EDITOR_ROUNDS` without a READY exit, it halts at `S4-editor-cap`, listing the unresolved P0/P1 findings, design unknowns, and refuted-KTD overflow titles. A nonzero `refutedKtdOverflow` deliberately rides the loop to this cap halt.

---

## S5: Gates

Four sequential checks on the finished document, fronted by a budget-floor guard (halt `S5-budget-floor`).

1. **Parse conformance (M11)** -- a **`plan-parser`** (`agentType: 'plan-parser'`, `model: 'sonnet'`, `UNITS_SCHEMA`) parses the document into the structured unit/requirement representation. `UNITS_SCHEMA` is the **one schema byte-copied** between `shepherd-plan.js` and `shepherd-deliver.js`; that byte-copy is the compatibility guarantee, since `ce-work`'s own parser is the release test. A pure-JS `parseViolations` then checks for zero units, missing `dependsOn` targets, dependency cycles (Kahn's algorithm, 100-iteration guard), undefined R-ID references, and file-overlap between units with no dependency path. Violations get one `parse-fix` round (authorized by `GATE_AUTHORITY`, not `refutationSurvived`); persistent violations halt at `S5-parse-gate`. Parse failures auto-retry once; two nulls also halt `S5-parse-gate`. (`riskSurfaces` well-formedness is filtered fail-open, not gated, because it is parser-derived.)
2. **Releasability (M12)** -- the **`releasability-checker`** persona (`agentType: 'releasability-checker'`, `model: 'sonnet'`, `RELEASE_SCHEMA`) evaluates seven named items: `scope-boundaries-substantive`, `verification-observable`, `no-design-unknown-deferred`, `no-oversized-unit`, `unit-count-within-tier`, `scenarios-final-non-tautological`, `ktd-rationale-present`. A missing item is synthesized as a failure (`{pass: false, evidence: 'not reported'}`) so a partial agent return cannot vacuously pass.
3. **Origin coverage (M14)** -- skipped with a log when no origin was provided. When present, the **`origin-coverage-auditor`** persona (`agentType: 'origin-coverage-auditor'`, `model: 'sonnet'`, `ORIGIN_COVERAGE_SCHEMA`) walks every origin section and requires each **normative** list item (principles, lessons, rules, requirements, decisions) to be individually traced (addressed or explicitly deferred). **Illustrative** lists (alternative options, candidate approaches, background examples) are exempt: the plan may select a subset without the rest counting as omissions. A zero-section walk is treated as verifier failure (coverage becomes `unverified` in `openQuestions`, not a gate failure).
4. **Cross-plan overlap (M15)** -- pure JS comparing the parsed file set and risk surfaces against active sibling plans. Shared files become `openQuestions` entries fed to the gate-fix round; shared risk surfaces produce an advisory log only.

The three agent-driven failures (releasability, origin coverage, overlap) are batched into a **single shared `gate-fix` round** (once; inherits the session model, `FIX_SCHEMA`). After it runs, a checker plus the JS battery re-verify, then only what originally failed is re-checked (`releasability-retry`, `origin-coverage-retry`). If releasability still fails -> halt `S5-releasability`; origin-only still fails -> halt `S5-origin-coverage`; overlap-only failure logs and continues. If the document mutated, a final `parse-plan-final` blesses the new bytes (worst-case 4 parse dispatches per run, bounded; violations halt `S5-parse-gate`). After all gates pass, `unitCount`, `requirementCount`, and `slug` are refreshed from the final parse.

---

## S6: Finalize

Fronted by its own budget-floor guard (which, if hit, returns a `ready` summary instructing a manual commit and `git hash-object` before deliver).

- **Optional commit (M16)** -- only when `args.commit === true`. The **`committer`** persona (`agentType: 'committer'`, `model: 'sonnet'`, `COMMIT_SCHEMA`) runs `git add <planPath>` by name and `git commit -m "docs(plans): add <slug> plan"`, then reports the sha and the file list. If the commit contains anything other than the plan file, it logs a WARNING and sets `commitDirty`.
- **Hygiene check** -- always dispatched via the **`hygiene-checker`** persona (`agentType: 'hygiene-checker'`, `model: 'sonnet'`, `HYGIENE_SCHEMA`, read-only). It runs `git status --porcelain`, computes `onlyPlanChanged` (untracked files outside `docs/plans/` count as violations), and computes `planVersion` with `git hash-object <planPath>`. A dirty workspace or a dirty commit forces `hygieneClean: false`; a hygiene failure leaves `hygieneClean` and `planVersion` null.

### The machine-readable run summary

Every terminal path calls `summary()` exactly once. It returns a fixed-shape object (all fields always present; nulls explicit, arrays empty not missing) including `status`, `planPath`, `planVersion`, `depthTier`, `unitCount`, `requirementCount`, `roundsUsed`, `personaRoundsUsed`, `residualFindings`, `narrowedScope`, `openQuestions`, `committed`, `hygieneClean`, `haltStage`, `haltReason`, `nextStep`, and `directPrompt`. `summary()` also folds the anchor-50 FYI advisories into `residualFindings` (class `fyi`) -- its one merge point.

The fields a human actually uses to launch deliver are `planPath` and `planVersion`, encoded into the `nextStep` string (for example, `Run shepherd-deliver with { plan: "<planPath>", planVersion: "<planVersion>" }`, or, when not committed, prefixed with the `git add`/`git commit` commands). `shepherd-deliver` reads only `args.plan` and `args.planVersion` from its own caller; it does not read this summary object, and it re-parses the plan independently in its own Recon phase using the same `UNITS_SCHEMA`.

---

## Depth tiers and caps

The depth tier (pinned via `args.depth` or derived by intake) scales the machinery to task size. `lightweight` is the only lighter tier; `standard` and `deep` are byte-identical in `CAPS_BY_TIER`.

| Lever | lightweight | standard / deep |
|-------|-------------|-----------------|
| Unit budget | 2-4 | 3-6 (standard) / 4-8 (deep) |
| `EDITOR_ROUNDS` default | 2 | 3 |
| `PERSONA_ROUNDS` default | 1 | 2 |
| flow-analyzer | skipped | dispatched |
| `RESEARCH_CAP` | 3 | 6 |
| `PERSONA_CAP` | 4 | 8 |
| `FINDING_REFUTER_CAP` | 6 | 16 |
| `HALT_CLASS_CAP` | 1 | 3 |
| `KTD_CAP` / `KTD_PASSES_CAP` / `KTD_HALT_CAP` | 3 / 1 / 1 | 8 / 2 / 3 |
| `SPIKE_CAP` | 1 | 3 |

At `lightweight`, the round-count lowering applies only when the caller did not pass an explicit `editorRounds` / `reviewRounds`; an explicit arg always wins. Every cap drop is surfaced with `log()`.

---

## Related docs

- [practice/README.md](./README.md) -- the practice hub (overview, pillars, skills).
- [deliver.md](./deliver.md) -- the `shepherd-deliver` deep dive (the other half).
- [fleet.md](./fleet.md) -- the full agent / persona catalog.
- [routing.md](./routing.md) -- executor and model routing (deliver-side).
- [verification.md](./verification.md) -- the refutation / honesty doctrine the Review loop is built on.
- [../workflows/README.md](../workflows/README.md) -- the dynamic-workflow substrate (coordinator rules, primitives, constraints, patterns).
- [../../STRATEGY.md](../../STRATEGY.md) -- product direction. [../../CONTEXT.md](../../CONTEXT.md) -- domain glossary.
