# The agent fleet

Shepherd is an engineering practice (plan then deliver) built on dynamic-workflow coordinator scripts. The coordinators do no real work themselves: every file read, every edit, every test run, every git operation is performed by a dispatched agent. This page catalogs the **fleet** that does that work.

The fleet is **35 single-purpose personas**, one Markdown file each under [`agents/`](../../agents/). A coordinator dispatches one by passing `agentType: '<name>'` to `agent()`; the runtime loads `agents/<name>.md` as that subagent's system prompt. The binding is **by convention**, not a registry: the repo symlinks `.claude/agents -> ../agents`, and the runtime resolves the `agentType` string against a file of the same name in that directory (the grounding principle). There is no manifest mapping names to files.

Two facts shape everything below:

- **Each persona gets a fresh context window.** It cannot see the coordinator's variables, the plan document, or any other agent's output unless that data is in its prompt. Every dispatch must ground the agent with exactly the paths, facts, and schema it needs (the grounding principle).
- **Personas carry no intrinsic model tier**, with two exceptions (`codex-runner`, `codex-reviewer`). Every other agent's model is decided at the dispatch site or inherited from the session. See the [Models](#models) note and [`./routing.md`](./routing.md).

The 35 personas split as: **27 plan-side** (5 research + 2 authoring + 7 review lenses + 12 role-extracted gate and loop agents + 1 Codex executor mechanism) and **8 deliver/shared** (5 delivery + 2 verifiers + 1 CI). Every dispatcher in both coordinators carries an `agentType` backed by a file in `agents/`; there are no inline-prompt agents on the plan side. The groups below follow that split.

---

## 1. Plan research (5 personas)

Dispatched in parallel during the Research phase (S1) of [`shepherd-plan`](./plan.md). All five run on `sonnet` (extraction and digest work is mechanical, not design judgment). The researcher roster is conditional: the two external researchers are dispatched only when intake classifies a matching research intent, and `flow-analyzer` runs at the standard and deep depth tiers only.

| Persona | Role (one line) | Reads / receives | Returns (schema) | Model | Notes |
|---|---|---|---|---|---|
| `repo-researcher` | Harvests stack, architecture, conventions, and implementation patterns from the live codebase | The research grounding prompt; reads repo files (`Read, Grep, Glob, Bash`) | `REPO_RESEARCH_SCHEMA` (`repoRoot`, `stackDigest` <=30 lines, `conventionsDigest` <=20, `testingDigest` <=20, `relevantFiles`, `contextMdPath`) | sonnet | Runs a Phase 0 root-manifest sweep first; supports a `Scope:` prefix to run only named phases (technology, architecture, patterns, conventions, issues, templates). |
| `learnings-researcher` | Mines `docs/solutions/` for applicable past learnings via frontmatter metadata | Grounding prompt; reads `docs/solutions/` (`Read, Grep, Glob, Bash`) | `DIGEST_SCHEMA` (`digest` <=25 lines, `sources[]`) | sonnet | Returns up to 5 ranked findings. Its **Step 0** looks for `CONCEPTS.md` at the repo root; **this repo ships `CONTEXT.md`, not `CONCEPTS.md`**, so the persona's own rule ("if it does not exist, skip this step") makes Step 0 a clean no-op here. |
| `web-researcher` | Phased web research for prior art, competitors, adjacent solutions, cross-domain analogies | Grounding prompt; `Read, Grep, Glob, Bash, WebFetch, WebSearch` | `DIGEST_SCHEMA` | sonnet | Dispatched only when `intake.research.intent` is `landscape` or `mixed`. Verifies a web-search and a web-fetch tool are reachable before any work, else reports unavailable and stops. |
| `external-grounding-researcher` | External best-practices and version-specific framework docs for a named technology | Stated intent (`implementation-guidance` or `version-specific framework`); `Read, Grep, Glob, Bash, WebFetch, WebSearch, mcp__context7__*` | `DIGEST_SCHEMA` | sonnet | Dispatched for `implementation-guidance`, `version-specific framework`, or `mixed`. Runs a mandatory deprecation/sunset check before recommending any external API or SDK. |
| `flow-analyzer` | Maps user/data/control flows and the edge cases a plan must not miss | Grounding prompt; reads repo files (`Read, Grep, Glob, Bash`) | `FLOW_SCHEMA` (`digest`, `edgeCases[]`) | sonnet | **Standard/deep tiers only.** At lightweight it is skipped (the coordinator logs `Spec-flow analysis skipped: lightweight tier`). Searches the codebase before reading the spec and never flags a gap the codebase already handles. |

The Research phase uses a `parallel()` barrier (not `pipeline()`) because the strategy gate and the assembled `CODEBASE_CONTEXT` need the full prior result set together. A per-tier `RESEARCH_CAP` (3 at lightweight, 6 at standard/deep) bounds the roster; dropped agents are logged.

---

## 2. Plan authoring (2 personas)

The two personas that produce and judge the plan document. Both are **pinned to `model: 'opus'`** at the dispatch site: plan authoring and the editor verdict are the highest-stakes judgment work in an autonomous pipeline that ships a plan with no human review between agents. This is a deliberate exception to the inherit-the-session-model default (see [Models](#models) and [`./routing.md`](./routing.md)).

| Persona | Role (one line) | Reads / receives | Returns (schema) | Model | Notes |
|---|---|---|---|---|---|
| `plan-author` | Writes the single plan document; owns U-ID/R-ID assignment | Locked Confirmed Intent, codebase context, template, depth tier, assumptions; reads **5 doctrine skills**; `Read, Grep, Glob, Bash, Write, Edit` | `AUTHOR_SCHEMA` (`planPath`, `uidNamePairs[]`, `rIds[]`, `unitCount`, `requirementCount`, `sectionsPresent[]`, ...) | **`opus` (pinned)** | The **only plan-side persona with `Write`/`Edit`**, and it may create or modify exactly one file (the plan under `docs/plans/`). U-IDs/R-IDs are assigned once and are permanent. Evidence fields are cross-checked against an independent parse, so it must report them honestly. |
| `plan-editor` | The review loop's judge: returns READY or REVISED with structured findings | The drafted plan, a decision primer of prior findings; reads the **same 5 doctrine skills**; `Read, Grep, Glob, Bash` | `EDITOR_SCHEMA` (`verdict` READY\|REVISED, `failureModesConsidered[]`, `findings[]`, `blockingCount`, `designUnknowns[]`, `units[]`, `evidence`) | **`opus` (pinned)** | **Read-only**: never edits the plan; fixes are applied and verified by other agents. Must enumerate every way the plan could fail (14 named failure-mode classes) before choosing a verdict, and is judged on verdict correctness, not on whether it found something. A READY verdict with wrong evidence counts is discarded. |

Both read the same 5 of the 6 doctrine skills under [`skills/`](../../skills/) before acting: `decomposition`, `scoping`, `interface-design`, `test-strategy`, `zero-context-planning` (all but `validating-agent-improvements`). Skill paths resolve from the **session's starting directory**, not the target repo.

---

## 3. Review lenses (7 personas)

Seven specialized reviewers run during the Review phase of [`shepherd-plan`](./plan.md). Each owns a distinct dimension so they run in parallel without overlapping. **Coherence and feasibility are always-on** (spawned every persona round unconditionally); the other five are **conditional**, activated by a `sonnet` classifier that reads the drafted plan.

**The 7 lenses are dispatched through `codex-executor` at Codex `gpt-5.5` / reasoning-effort `xhigh` by default.** Each lens dispatch uses `agentType: 'codex-executor'` with `model: 'sonnet'` on the `agent()` opts; the Codex model, effort, lens role file path, and assembled review context travel as per-call DATA in a `<codex-exec-brief>` block in the prompt. The `codex-executor` persona reads the lens role file from disk, concatenates its content into the Codex `prompt.md`, and returns findings in `PERSONA_FINDINGS_SCHEMA`. When a lens's `codex-executor` run returns `ran: false` (Codex absent or sandboxed), the coordinator re-dispatches that lens on its native Claude `agentType` (e.g. `coherence-lens`) at the session model, so every lens always contributes a full review and an unreviewed plan can never ship. See [`./verification.md`](./verification.md) for the precision/recall caveat this routing carries.

| Persona | Activation | Dimension it owns | Distinctive output | Rebound to doctrine skills |
|---|---|---|---|---|
| `coherence-lens` | **Always-on** | Internal consistency: contradictions, terminology drift, broken references, ambiguity | Six `safe_auto` patterns at confidence 100 (header/body count mismatch, dead cross-reference, terminology drift, summary/detail mismatch, prose contradiction, derivable missing list entry). Only lens with **no `Bash`** (`Read, Grep, Glob`). | `skills/interface-design` + `skills/decomposition` (DDD naming pass) |
| `feasibility-lens` | **Always-on** | Will the approach survive contact with reality: architecture conflicts, shadow paths, dependencies, migration safety, implementability | Plan-only **shadow-path tracing** (happy/nil/empty/error per new data flow) and an "could an engineer start tomorrow?" implementability check. | `skills/test-strategy` (test-surface reasoning) |
| `scope-lens` | Conditional | Scope alignment and unjustified complexity | Complexity smell test (`>8` files or `>2` new abstractions needs a proportional goal); applies the appetite doctrine (cut scope, not quality; deferred items keep their R-IDs). | `skills/scoping` |
| `product-lens` | Conditional | Premise, strategic consequences, goal-work alignment, prioritization | Five techniques as a senior product leader; identifies product context (external/internal/hybrid) first; working confidence ceiling 75, suppresses findings below 50. | (none) |
| `security-lens` | Conditional | Auth/authz assumptions, data exposure, attack surface, missing threat-model elements | A mandatory **plan-level threat model: top 3 exploits** (most likely, highest impact, most subtle), one sentence each plus mitigation. | (none) |
| `design-lens` | Conditional | Information architecture, interaction states, user flows, AI-slop risk | **Dimensional 0-10 rating** per applicable dimension (`[Dimension]: [N]/10 ... A 10 would have [x]`), findings only at 7/10 or below, plus an **AI-slop check** (3-column grids, purple/blue gradients, colored icon circles, etc.). | (none) |
| `adversarial-lens` | Conditional | Epistemological quality: whether premises hold, assumptions are warranted, decisions survive reality | A **5-technique falsification** pass (premise challenge, assumption surfacing, decision stress-test, simplification pressure, alternative blindness) with **depth calibration** (Quick / Standard / Deep scaling effort by document size and risk). Constructs counterarguments, not checklists. | (none) |

The lens role files carry the judgment contracts only (doctrine plus a `skills/` rebinding block where applicable), with no executor language and no per-call data. The `codex-executor` persona is the Codex operator that reads them from disk at runtime.

Activation, when conditional, is keyed off classifier flags from intake. `adversarial-lens` fires on high-stakes domains (auth/payments/billing/migrations/privacy/compliance/external integrations/crypto), new abstraction, framework, or architectural pattern; greenfield-with-no-origin; scope extension, or explicit alternatives or unresolved tradeoffs; `scope-lens` (the classifier flag is `scopeGuardian`) fires on multiple priority tiers, `>8` requirements, stretch goals, or scope language misaligned with goals. When the classifier fails, the workflow falls back to **always-on coherence + feasibility only**.

Three lenses are **rebound to doctrine skills**: their frontmatter delegates part of the review to a named skill under `skills/` rather than carrying that logic inline. The other four carry their logic in-file.

Naming note (cosmetic): `adversarial-lens` self-labels "shepherd-plan fleet" in its frontmatter, while the other six say "shepherd review fleet" / "shepherd reviewer fleet". The wording differs; the dispatch and behavior do not.

---

## 4. Delivery (5 personas)

The personas that turn a plan unit into merged, tested code in [`shepherd-deliver`](./deliver.md). Routing (who executes, at what tier) is decided per task and explained in [`./routing.md`](./routing.md).

| Persona | Role (one line) | Reads / receives | Returns (schema) | Model | Notes |
|---|---|---|---|---|---|
| `task-splitter` | Splits one plan unit into context-window-sized task dossiers | One unit (goal, files, approach, scenarios), repo conventions, plan context; `Read, Grep, Glob, Bash` | `TASKS_SCHEMA` | inherited | **Read-only** (reads code only to judge size). A task fits one iteration when it is ONE concern, `<= ~5` impl files, `<= ~300` lines, self-contained, one test command. Same-unit tasks touching the same file are chained via `dependsOn` to avoid worktree collisions at merge. |
| `executor-router` | Picks executor + effort + Claude tier for one task | Codex-availability flag, task metadata (risk, ambiguity, est-diff, files), full dossier; `Read, Grep, Glob` | `ROUTE_SCHEMA` (`executor` codex\|claude, `effort`, `model` haiku\|sonnet\|opus, `reason`) | sonnet | **Pure judgment, modifies nothing.** Routes to Codex only for mechanical, sandbox-verifiable work with no network. High risk escalates the **verification pass**, not the model. The Claude `model` it picks becomes `unit-executor`'s tier and the fallback/finisher tier. See [routing](./routing.md). |
| `unit-executor` | Implements one task in an isolated worktree, test-first | Task dossier, worktree/branch coordinates, repo conventions, test command (no plan document) | `EXEC_SCHEMA` (`status`, `branch`, `worktreePath`, `filesModified`, `verificationSummary`, `issues`) | **routed tier** (`t.route.model`), never inherited | TDD RED-GREEN-REFACTOR per behavior slice; may spawn nested subagents for pattern archaeology. Reports `completed` only after a fresh passing test run **this session**; never weakens a test to get green; strict worktree discipline (no push, own branch only). Also serves as the codex **fallback** and **finisher** at its routed tier. |
| `codex-runner` | Drives `codex exec` for one task and classifies the result | Codex binary path, worktree/branch, test command, sandbox flag, effort, dossier; `Bash, Read, Write` | `EXEC_SCHEMA` | **`sonnet` (pinned in frontmatter)** | **Mechanical protocol operator**: implements nothing; Codex does the work. Substitutes the literal scratch path into every Bash call (shell vars do not survive between calls), maps Codex's snake_case output to camelCase, and reports `completed` only if Codex did AND a commit now exists on the branch. |
| `codex-reviewer` | Runs `codex exec` as a read-only second-model reviewer over a branch diff | Worktree path, branch, diff context; `Bash, Read, Write` | `CODEX_REVIEW_SCHEMA` (`ran`, `findings[]`) | **`sonnet` (pinned in frontmatter)** | **Mechanical protocol operator**: performs no review judgment and modifies nothing. Instructs Codex to hunt logic errors, broken edge cases, and contract violations a same-model reviewer might rationalize away. Verifies the worktree is untouched after the run; never invents or drops findings. |

`codex-runner` and `codex-reviewer` are the **only two personas that pin a model in their own frontmatter** (both `sonnet`): the heavy reasoning is offloaded to the external Codex model, so the operator persona only needs sonnet. `unit-executor`'s tier comes exclusively from the router's `ROUTE_SCHEMA.model` and is never inherited from the session.

The third Codex mechanism, `codex-executor`, is detailed below in [Codex mechanisms](#codex-mechanisms).

---

## 5. Verifiers (2 personas)

Two adversarial verifiers grade findings, with **deliberately opposite defaults**. This is the practical edge of the honesty doctrine: choose the failure that costs less when you are uncertain. Both are read-only with `Read, Grep, Glob, Bash` and no model pinned in frontmatter. The full doctrine is in [`./verification.md`](./verification.md).

| Persona | Side | Default when uncertain | Verdict shape | Why this default |
|---|---|---|---|---|
| `finding-verifier` | **Deliver** | **PLAUSIBLE** (recall-biased; never REFUTED) | `VERDICT_SCHEMA` = `{ verdict: CONFIRMED\|PLAUSIBLE\|REFUTED, evidence }` | A dropped real defect in shipped code costs more than a kept uncertain one. Grades on a three-state ladder: CONFIRMED needs named triggering inputs **and** a quoted offending line; REFUTED needs a constructible disproving invariant or guard. |
| `skeptical-refuter` | **Plan** | **`refuted: true`** | `VERDICT_SCHEMA` = `{ refuted: boolean, reason }` | An unverified finding that triggers rework on a plan is more expensive than a dropped one. Prefers **execution over reading** for deterministic runtime claims (evaluates exact inputs via `node -e` / `python -c` and quotes the observed output). |

The contrast is the point: on the **deliver** side, uncertainty keeps a finding alive (recall-biased) so a real bug is not waved through; on the **plan** side, uncertainty kills a finding (precision-biased) so the editor loop does not churn on unconfirmed objections. The two `VERDICT_SCHEMA` definitions are genuinely different shapes (one boolean `refuted`, one three-state `verdict` enum), defined independently in each coordinator. They are not a shared schema.

---

## 6. CI (1 persona)

| Persona | Role (one line) | Reads / receives | Returns (schema) | Model | Notes |
|---|---|---|---|---|---|
| `ci-watcher` | One watch-fix-push iteration of a PR's CI checks | PR URL, worktree path/branch, test command, iteration N-of-M | `CI_SCHEMA` | inherited (CI diagnosis is genuine reasoning) | The orchestrator owns the loop; this persona watches once and fixes at most once. **Reproduce-before-fix gate**: it must reproduce the CI failure locally the same way before touching code (a local failure that differs counts as "does not reproduce" and limits it to evidence-named environment/config fixes). Never weakens a test; commits `fix(ci): ...` and returns `red` with `fixedAndPushed=true` so the orchestrator re-watches. |

---

## 7. Plan-side role agents (12 personas)

Every plan-side dispatch that was previously an inline-prompt agent is now a named persona backed by a file in `agents/`. The judgment contract (what the role decides, what authority it respects, what it returns) lives in the role file; per-call data (paths, fix batches, violation lists) is passed at the dispatch site. All 12 pin `model: 'sonnet'` (mechanical gate and loop work). Multiple dispatch labels route to the same role file when the judgment contract is identical across sites.

| Persona | Labels (dispatch sites) | Phase | What it decides | Model |
|---|---|---|---|---|
| `intake-classifier` | `intake` | Intake | Classifies request into Confirmed Intent, depth tier, research intent, below-floor verdict, and unknown types | `sonnet` |
| `strategy-gate` | `strategy-gate` | Gate | Challenges the framing before drafting; may halt, adjust, or proceed | `opus` (see note) |
| `cross-plan-scanner` | `research-cross-plan` | Research | Scans `status:active` plans for file and risk-surface overlap | `sonnet` |
| `persona-classifier` | `classify-personas` | Draft | Selects conditional review lenses; extracts KTDs and load-bearing assumptions | `sonnet` |
| `plan-fixer` | `fix-round-${r}`, `refix-uid-${tag}`, `revise-spike`, `parse-fix`, `gate-fix` | Review/Gates | Applies confirmed/safe-auto fixes; respects the authority class named in the brief | `sonnet` |
| `plan-checker` | `check-${tag}`, `check-${tag}-retry`, `check-refix-${tag}`, `check-evidence-r${r}` | Review | Re-reads the document after mutations; reports fix fidelity and structural inventory (`CHECKER_SCHEMA`) | `sonnet` |
| `spike-investigator` | `spike-${i}` | Review | Read-only design-unknown investigation; returns resolved / documented-trade-off / runtime-blocked | `sonnet` |
| `plan-parser` | `parse-plan`, `parse-plan-retry`, `parse-plan-final` | Gates | Parses the plan into `UNITS_SCHEMA` for conformance checking (distinct schema from `plan-checker`) | `sonnet` |
| `releasability-checker` | `releasability`, `releasability-retry` | Gates | Evaluates the seven-item releasability checklist (`RELEASE_SCHEMA`) | `sonnet` |
| `origin-coverage-auditor` | `origin-coverage`, `origin-coverage-retry` | Gates | Walks origin sections; requires normative items traced, exempts illustrative lists | `sonnet` |
| `committer` | `commit-plan` | Finalize | Runs `git add <planPath>` and `git commit` when `args.commit === true` | `sonnet` |
| `hygiene-checker` | `hygiene` | Finalize | Runs `git status --porcelain`; computes `planVersion` via `git hash-object` | `sonnet` |

**Note on `intake-classifier` and `strategy-gate` model tiers:** `intake-classifier` pins `model: 'sonnet'` (classification is mechanical). `strategy-gate` pins `model: 'opus'` (challenging the framing before any drafting is the highest-stakes gate judgment). Both are deliberate exceptions to the inherit-the-session-model default; see [Models](#models).

---

## 8. Codex mechanisms (3 personas)

Three personas operate the Codex CLI as mechanical protocol operators. All three pin `model: 'sonnet'` in their own frontmatter (heavy reasoning is offloaded to the external Codex model) and never perform review or implementation judgment themselves.

| Persona | Coordinator | Role | Codex mode |
|---|---|---|---|
| `codex-runner` | deliver | Drives `codex exec` for one implementation task; classifies the result | `read-write` (workspace sandbox) |
| `codex-reviewer` | deliver | Runs `codex exec` as a read-only second-model reviewer over a branch diff | `read-only` (diff review) |
| `codex-executor` | plan | Role-agnostic Codex operator: reads any lens role file from disk, concatenates it into `prompt.md`, launches `codex exec` read-only, and returns findings in the caller-supplied schema | `read-only` (plan review) |

`codex-executor` is the **third Codex mechanism**, introduced to route the 7 review lenses through Codex at `gpt-5.5` / `xhigh`. It differs from the other two in being **role-agnostic**: it reads its Codex model, reasoning-effort, output schema, document path, and review instructions from a `<codex-exec-brief>` DATA block in its dispatch prompt (not from a hard-coded charter), then reads the named lens role file from disk and concatenates its content into `prompt.md` before launching Codex. It carries no lens-specific doctrine inline. On missing/malformed output or when Codex is not found (binary absent or nested-sandbox detected), it returns `{ ran: false, reason }` so the coordinator can re-dispatch that lens on its native Claude `agentType`.

---

## Inline-prompt agents (deliver side only)

Every dispatcher in `shepherd-plan.js` now carries an `agentType` backed by a file in `agents/`. The deliver coordinator still dispatches some steps as **inline-prompt agents** (a label and schema, no `agentType` and no file in `agents/`); their logic lives in the coordinator's prompt factory, not in a reusable persona file.

**Deliver side (`shepherd-deliver.js`):**

| Inline agent (label) | Phase | What it does |
|---|---|---|
| `repo-recon` | Recon | Reconnoiters the target repo (stack, conventions, test command) for the run |
| `final-validation` | Validate | Traces requirements, runs the full suite and lint (`VALIDATION_SCHEMA`) |
| `simplify` | Quality | Applies the simplification pass over the integrated diff |
| `merge-<id>` (integrator) | Integrate | Merges each task branch into the integration branch in dependency order (`MERGE_SCHEMA`) |
| `gate-recheck` | Ship/CI | Re-runs the gate as a mechanical run-and-report before shipping |
| `audit-fixes` | Quality | Mechanical commit-vs-claim check that applied fixes actually landed |
| `audit-compound` | Compound | Audits the compound (learnings-recording) step |
| `proof` | Proof | Browser-proofs affected routes (mechanical pass/fail) |
| `ship` | Ship | Commits, pushes, and opens the PR (steps and PR-body sections fully specified) |
| `ci-residual` | CI | Records unresolved CI status into the PR body when the bounded fix loop gives up |

These are illustrative, not the complete inline-agent inventory: the deliver coordinator also dispatches inline triage waves, a diffstat, a sweep, per-file fix applications, and ship-verify. The rule is uniform on the deliver side: **if there is no `agents/<name>.md` file and no `agentType` on the dispatch, it is an inline-prompt agent, not a persona.** On the plan side, every dispatch now carries an `agentType`.

---

## External integration surface (compound-engineering)

Several deliver phases depend on the **compound-engineering plugin**, an externally-installed dependency not shipped in this repo's `agents/` or `skills/` directories. The two kinds of dependency below behave differently when the plugin is absent: the `skillGuide()` skills fall back to inline prompts, but the reviewer personas currently do not.

**Quality-phase reviewer personas**, dispatched via `agentType: 'compound-engineering:<name>'`, these are not files in this repo:

| agentType | Always-on? |
|---|---|
| `compound-engineering:ce-correctness-reviewer` | Always-on |
| `compound-engineering:ce-maintainability-reviewer` | Always-on |
| `compound-engineering:ce-testing-reviewer` | Always-on |
| `compound-engineering:ce-project-standards-reviewer` | Always-on |
| `compound-engineering:ce-security-reviewer` | Conditional (auth/payments/crypto/public-api risk surface) |
| `compound-engineering:ce-data-migration-reviewer` | Conditional (migrations risk surface) |
| `compound-engineering:ce-api-contract-reviewer` | Conditional (public-api risk surface) |
| `compound-engineering:ce-adversarial-reviewer` | Conditional (diff >= 50 lines or auth/payments risk surface) |

**These reviewer personas have no `ceSkillsRoot` guard and no inline fallback today.** When the plugin is absent their `agentType` values do not resolve, so the Quality phase loses its structured persona-review roster; the local `codex-reviewer` and inline-angle reviewers still run, and `finding-verifier` still grades what they produce. This hard coupling, and the plan to make the product plugin-independent, is tracked in [#26](https://github.com/vadimcomanescu/shepherd/issues/26).

**ce-* skills**, used as authoritative instruction sources via `skillGuide()`, with inline fallbacks when the plugin is absent:

- `ce-simplify-code`: guides the Simplify (dead-code elimination) step
- `ce-test-browser`: guides browser-proof route verification
- `ce-compound`: guides the learnings-recording (Compound) step
- `ce-commit-push-pr`: guides commit conventions, push mechanics, and PR creation

The `skillGuide()` helper resolves these from the installed plugin's `skills/` directory. When the plugin is not installed, `ceSkillsRoot` is empty and each call falls back to the inline fallback string baked into the coordinator.

---

## Models

Model policy and its plan-side exceptions (see also [`./routing.md`](./routing.md) and the substrate's authoring rules in [`../workflows/README.md`](../workflows/README.md)):

- **Only `codex-runner`, `codex-reviewer`, and `codex-executor` pin a model in their persona frontmatter**, all `model: sonnet`. They are mechanical protocol operators that drive the external Codex model, so sonnet is enough; the reasoning is offloaded.
- **Every other persona's tier is set at the dispatch site or inherited**, with a documented plan-side exception (below).
- **Plan-side opus exception (deliberate override).** Five plan-side roles are pinned to `model: 'opus'` at the dispatch site: `plan-author` (label `author-plan`), `plan-editor` (label `editor-r${r}`), `intake-classifier` (label `intake`), `strategy-gate`, and `skeptical-refuter` (all four dispatch labels: `refute-halt-r*`, `refute-r*`, `ktd-refute-p*`, `refute-halt-ktd-p*`). Rationale: plan authoring, intake classification, the strategy gate, the editor verdict, and adversarial refutation are the highest-stakes judgment work in an autonomous pipeline that ships a plan with no human review between agents. Inherit-the-session-model is correct for self-paced interactive work; it is not correct here. `intake-classifier` is `sonnet` (classification is mechanical); the others are `opus`.
- **All mechanical plan-side roles pin `model: 'sonnet'`**: the five researchers, `persona-classifier`, `cross-plan-scanner`, `plan-fixer`, `plan-checker`, `plan-parser`, `spike-investigator`, `releasability-checker`, `origin-coverage-auditor`, `committer`, `hygiene-checker`, and the `codex-executor` operator dispatch.
- **Deliver genuine-reasoning steps inherit the session model** by omitting `model`: `task-splitter`, the deliver persona reviewers, and `ci-watcher`.
- **`unit-executor` is the exception to "set or inherited":** its tier comes from the router's `ROUTE_SCHEMA.model` (`haiku`, `sonnet`, or `opus`) and is **never inherited from the session**. `haiku` and `opus` reach an agent only through that field on the deliver side; the plan-side `opus` pins are the only other place either tier appears in a coordinator.

The net observable pattern: every plan-side `model:` literal is either `'sonnet'` (mechanical work) or `'opus'` (the five named roles above); inherit (no `model`) is absent from plan dispatches by design. The deliver side has `'sonnet'` literals for mechanical work and inherits for genuine reasoning.

---

## See also

- [`./plan.md`](./plan.md) and [`./deliver.md`](./deliver.md): the two coordinators that dispatch this fleet.
- [`./routing.md`](./routing.md): how `executor-router` and the model policy decide executor and tier per task.
- [`./verification.md`](./verification.md): the honesty doctrine behind the opposite-default verifiers.
- [`../workflows/README.md`](../workflows/README.md): the dynamic-workflow substrate (coordinator contract, primitives, constraints, patterns).
- [`../../CONTEXT.md`](../../CONTEXT.md): the domain glossary. [`../../STRATEGY.md`](../../STRATEGY.md): product direction.
