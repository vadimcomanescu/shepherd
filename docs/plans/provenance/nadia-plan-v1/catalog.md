# nadia-plan: Candidate-Improvement Catalog

Synthesis of seven research reports in `/tmp/nadia-plan-build/research/`:
`nadia-repo.md`, `ce-plan.md`, `ce-doc-review.md`, `trycycle.md`, `osmani-local.md`, `osmani-web.md`, `trycycle-web.md`.
All citations below are to those report files (which themselves cite primary sources) — section references are to the report sections.

---

## A. BASE CONTRACT (non-negotiable facts)

These are not candidates. They are the floor nadia-plan stands on. Any candidate that contradicts them is flagged with conflict risk below.

### A.1 The ce-plan flow nadia-plan inherits (the evolved base)

Source: `ce-plan.md` §1.

- **Phase 0 — Resume/Source/Scope**: resolve output format (pipeline mode forces md), resume-or-new, approach-altitude check, find upstream brainstorm in `docs/brainstorms/`, classify task domain, classify outstanding questions (planning-owned vs blocking), assess depth tier (Lightweight 2–4 units / Standard 3–6 / Deep 4–8), solo-mode scoping synthesis (three-bucket Stated/Inferred/Out-of-scope draft → tier-budgeted scope claim + 0–6 call-outs; headless mode skips confirmation and routes Inferred bets to `## Assumptions`).
- **Phase 1 — Research**: always-on parallel local research (`ce-repo-research-analyst`, `ce-learnings-researcher`); conditional external research (`ce-best-practices-researcher`, `ce-framework-docs-researcher`, `ce-web-researcher`) gated on intent + risk + thin-local-patterns; conditional `ce-spec-flow-analyzer` for Standard/Deep; consolidation step where external findings must land in decisions, not appendices; depth reclassification when external contract surfaces appear.
- **Phase 2 — Resolve planning questions**: classify resolved-during-planning vs deferred-to-implementation; never run tests or probe runtime.
- **Phase 3 — Structure**: title + filename, stakeholder awareness, break into implementation units (one meaningful change ≈ one atomic commit) with **stable U-IDs never renumbered** (gaps fine), high-level technical design when material, anti-expansion routing of tangential work to `### Deferred to Follow-Up Work`.
- **Phase 4 — Write** (NEVER CODE): depth guidance, section contract, planning rules — repo-relative paths, no implementation code, **no git commands or exact test command recipes, no RED/GREEN/REFACTOR micro-steps**.
- **Phase 5 — Review/Write/Handoff**: pre-write checklist (incl. origin re-read + HTD presence audit + U-ID uniqueness), brainstorm-sourced scoping synthesis, write plan file to disk, confidence check + deepening (per-section scoring, deterministic section→agent mapping, ≤8 agents soft cap), **mandatory headless ce-doc-review for markdown plans**, post-generation menu (skipped in pipeline mode).
- In lfg, ce-plan is step 1; the only downstream gate is **plan-file existence**; nothing runs between ce-plan and ce-work; all plan-side review happens inside ce-plan (`ce-plan.md` §4).

### A.2 The output contract: the plan document ce-work-deterministic consumes

Source: `nadia-repo.md` §2 (UNITS_SCHEMA, lines 38–69 of the coordinator; parse-plan prompt lines 278–290) and `ce-plan.md` §2.

- **Format**: YAML frontmatter with `status: active` (Ship agent flips to `completed`); plan title; `## Requirements` with R-IDs; `"Deferred to Implementation"` questions; `"Scope Boundaries"`; Implementation Units as level-3 headings `### U1. Name` with bold fields **Goal**, **Requirements** (optional), **Dependencies**, **Files**, **Approach**, **Execution note** (optional), **Patterns to follow**, **Test scenarios**, **Verification**.
- **UNITS_SCHEMA required fields** — root: `['planTitle','slug','units','requirements','riskSurfaces']`; per unit: `['uid','name','goal','dependsOn','files','approach','patterns','testScenarios','verification']`.
- **Downstream consumption**: `riskSurfaces` (subset of auth/payments/migrations/crypto/public-api/deps) drives Quality-phase persona selection; `deferredQuestions` + `scopeBoundaries` injected into every split-agent prompt; `requirements` + per-unit `verification` traced in the Validate agent; `planTitle` → PR title; `slug` → branch slug; `dependsOn` → wave topology (Kahn).
- **The plan file must be a committed repo file** before ce-work-deterministic runs (Ship agent locates it inside the worktree to flip status; `nadia-repo.md` §4.2). Convention: `docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md` (`ce-plan.md` §2; `nadia-repo.md` §4.1; nadia's `plans/` dir exists but is empty and the test fixture uses `docs/plans/test.md`).
- `execution: knowledge-work` frontmatter signals a zero-unit plan to the parser.

### A.3 nadia coordinator + test conventions

Source: `nadia-repo.md` §1, §3, §5.

- `meta` is the **first statement**, a pure object literal (`name`, `description`, `whenToUse`, `phases[{title,detail}]` matching `phase()` calls). Args destructured immediately after with `args.X !== false` booleans and `Math.max/min` clamping. Only required arg pattern: throw early if missing.
- **Coordinator does NO I/O** — every read/write/git/network action is an agent. Banned forms that throw: `Date.now()`, `Math.random()`, `new Date()`. Timestamps/dates must arrive via args (ce-work uses `args.startedAt`). Plain JavaScript only; no imports.
- `pipeline()` by default; `parallel()` only for genuine barriers (dedup across set, zero-count early exit, cross-referencing). Ground every agent (no coordinator-variable visibility). Adversarial verification with refuters + majority, fail-if-uncertain. No silent caps (every drop logged with reason). Bounded loops guarded on `budget.total` truthiness (`belowBudgetFloor` pattern). Model policy: omit `model` by default; `'sonnet'` for grunt work (extraction, mechanical authoring, runners); `'opus'` reserved.
- All schemas are top-level const objects passed as `opts.schema`. Prompt factories are top-level const arrow functions returning template literals with XML-ish wrappers; test S14 asserts no `<PLACEHOLDER>`/`undefined` leaks into prompts.
- Null handling: first critical nulls throw hard; later nulls handled via failed-sets / `.filter(Boolean)`; fail-open vs fail-closed chosen per step.
- Hard limits: concurrency min(16, cores−2); 1000 agents lifetime; 4096 items per pipeline/parallel; 1-level nesting.
- Persona files live in `agents/*.md` (symlinked to `.claude/agents`), referenced via `agentType`; ce-work also uses plugin agentTypes like `'compound-engineering:ce-correctness-reviewer'`. **nadia-plan needs its own personas** (plan-author, plan-editor, etc.) — none exist yet (`nadia-repo.md` §6). `skeptical-refuter.md` already exists and is reusable.
- Test harness contract: `node workflows/nadia-plan.test.mjs`; AsyncFunction injection after stripping `export const meta = `; `makeRuntime(dispatcher,{budgetTotal,costPerCall})` fakes; `makeDispatcher` routing by label prefix with `__hardThrow` on unhandled labels; `S(name,fn)` scenarios; `node:assert` only (`nadia-repo.md` §3.8).
- **Consequence for review-fix mechanics**: ce-doc-review's "orchestrator edits the document directly" cannot be reproduced — in nadia every document edit must be performed by an agent, and (per principle 4) verified.

### A.4 The ce-doc-review persona set and synthesis machinery

Source: `ce-doc-review.md` §1–§4.

- Always-on: `ce-coherence-reviewer` (model haiku — internal-consistency, primary owner of safe_auto) and `ce-feasibility-reviewer` (inherit — "could an implementer start tomorrow without making decisions the plan should have made?").
- Conditional: `ce-product-lens-reviewer` (challengeable premise or strategic weight), `ce-design-lens-reviewer` (UI/UX signals; sonnet), `ce-security-lens-reviewer` (auth/endpoints/PII/integrations; sonnet), `ce-scope-guardian-reviewer` (priority tiers, >8 requirements; sonnet), `ce-adversarial-document-reviewer` (high-stakes domains, new abstractions, greenfield no-origin, scope extension; inherit). Adversarial is explicitly NOT triggered by structural complexity or for routine plans derived from a validated origin.
- All personas dispatched **in parallel** from one subagent template with slots: persona_file, schema, document_type (classified by content shape), document_path, origin_path (extracted once), document_content, decision_primer.
- Confidence anchors are discrete 0/25/50/75/100: 0/25 dropped silently, 50 → FYI, 75/100 actionable; cross-persona agreement promotes one step; `safe_auto` at anchor 100 applies silently.
- 9-step synthesis: validate → confidence gate → dedup (normalize(section)+normalize(title), union evidence) → same-persona premise collapse → cross-persona promotion → contradiction resolution → deterministic action tie-break (Skip > Defer > Apply) → premise-dependency chain linking (≤6 dependents/root) → manual→auto promotion → route → sort.
- Iteration: no auto re-dispatch; round 2+ uses a decision primer (~120-char evidence snippets) for R29 rejected-finding suppression and R30 fix-landed verification; soft stop after 2 passes; no hard cap; headless output is structured **text**, not JSON.

---

## B. CANDIDATE IMPROVEMENTS

Pipeline-stage vocabulary used below (proposed nadia-plan shape):
**S0 Intake** (args/intent/scope) → **S1 Research** → **S2 Scope-recheck** → **S3 Draft** (author the plan) → **S4 Review loop** (multi-persona doc review + plan-editor) → **S5 Gates** (final verification before handoff) → **S6 Finalize** (write/commit/return) → **SH Harness** (tests/eval).

Costs are for integrating into a nadia coordinator (prompt text, schema, loop structure, persona files, tests).

---

### B.1 Review-loop mechanics

#### `up-the-hill-editor-loop`
- **Source**: `trycycle.md` §1, §3 (`SKILL.md` steps 6–7, `prompt-planning-edit.md`); duplicate in `osmani-local.md` §1.9 (local `plan` skill, `prompts/plan-editor.md`); `trycycle-web.md` R6–R8.
- **What**: After the draft, dispatch a fresh stateless plan-editor agent that receives only the original request + current plan and returns `READY` (unchanged, execution-ready) or `REVISED` (real problems found and fixed). Repeat with a fresh editor each round, capped (trycycle/Osmani: 5; doubt-driven-development uses 3). If not READY at the cap, **halt and escalate — never silently fall through to handoff**. Osmani adds a third verdict `USER DECISION REQUIRED` for unresolvable conflicts. Fresh-context-per-round is free in nadia (every `agent()` call is a fresh context).
- **Gap addressed**: ce-plan has NO plan-editor loop — its deepening agents are constructive only, and lfg's gate is file-existence (`ce-plan.md` §5.2, §5.3).
- **Slot**: S4 (the loop's outer structure; doc-review rounds can nest inside or alternate).
- **Cost**: med (loop + verdict schema + persona file + halt path + tests).
- **Conflict risk**: none — purely additive over the ce-plan base; satisfies nadia's bounded-loop principle directly.

#### `symmetric-accountability-prompts`
- **Source**: `trycycle.md` §3, §5.2 (`prompt-planning-edit.md`, eval doc `2026-03-16-symmetric-accountability-experiment.md`); duplicate in `osmani-local.md` §1.9 ("An unnecessary rewrite is a failure. Missing a real problem is a failure.").
- **What**: Reviewer/editor prompts must state that the agent is judged on verdict correctness, not on whether it made changes; verdict labels neutral (`READY`/`REVISED`, not action-rewarding labels). Trycycle's eval showed this finds real issues without cosmetic churn.
- **Gap addressed**: Constructive reviewers drift toward over-editing; ce-doc-review has no equivalent anti-churn framing for a rewrite-capable reviewer.
- **Slot**: S4 prompt discipline (editor + fixer agents).
- **Cost**: low (prompt text only).
- **Conflict risk**: none.

#### `diagnosis-before-action-protocol`
- **Source**: `trycycle.md` §3, §5.3 ("Enumerate every way execution of this plan could fail... Do not stop at the first issue — find them all. Then act proportionately."); `osmani-local.md` §1.9 (plan-editor diagnostic scope list).
- **What**: The editor must enumerate all failure modes (wrong problem, missed intent, false repo assumptions, incorrect contracts, missing edge cases, unsafe sequencing, weak verification, oversized units) before choosing a verdict. Prevents first-issue-found → rewrite churn.
- **Gap addressed**: No structured diagnosis step in ce-plan's pre-write checklist or ce-doc-review personas (each persona is scoped to its lens; no one enumerates whole-plan failure modes).
- **Slot**: S4 (editor prompt section; can also feed the verdict schema with a `failureModes[]` field for logging).
- **Cost**: low.
- **Conflict risk**: none.

#### `structured-findings-and-mechanical-gates`
- **Source**: `trycycle.md` §3, §5.6 (`review_observations_json`, `blocking_issue_count == 0` mechanical exit); merged duplicate of `ce-doc-review.md` Gap 7 (headless output is text, not machine-parseable) and `trycycle-web.md` R14.
- **What**: Every reviewer/editor/verifier returns schema-validated JSON (nadia's `opts.schema` makes this native), and the coordinator drives loop continuation and gates from counted fields (`blockingCount`, `verdict`), never from prose parsing. ce-doc-review's findings-schema.json (severity, confidence anchor, autofix_class, evidence) is the natural finding shape to adopt.
- **Gap addressed**: ce-doc-review headless mode returns text the caller must parse; trycycle proved counting from JSON makes gates non-negotiable.
- **Slot**: S4 + S5 (all reviewer outputs and loop predicates).
- **Cost**: low — this is effectively mandatory under nadia conventions (all ce-work agents already use schemas).
- **Conflict risk**: none.

#### `ready-verdict-evidence-requirement`
- **Source**: `osmani-local.md` §4 (verification-before-completion: the 5-step gate, "Trusting agent success reports" as anti-pattern) + §1.9 (editor artifact trail: verdict, plan path, commit, changed files, files inspected); `osmani-web.md` §8.
- **What**: No agent may claim READY/complete/written without evidence in its structured return: plan path, unit count, requirement count, sections present, files inspected. The coordinator (or a cheap sonnet verifier) cross-checks counts against the parse gate rather than trusting the self-report.
- **Gap addressed**: ce-plan Phase 5.1's origin-coverage scan is self-assessed by the same agent that wrote the plan (`ce-plan.md` §5.10); nadia's principle 4 demands independent verification.
- **Slot**: S4/S5 (every verdict-bearing agent's schema; verification agents).
- **Cost**: low-med.
- **Conflict risk**: none — direct implementation of repo principle 4.

#### `finding-refutation-verifiers`
- **Source**: `ce-doc-review.md` Gap 5 (no adversarial verification of other personas' findings).
- **What**: For high-impact findings (P0/P1, or premise-level findings naturally capped at anchor 75), spawn independent `skeptical-refuter` agents prompted to REFUTE the finding; require majority confirmation before the finding gates the plan or drives a rewrite. The existing `agents/skeptical-refuter.md` persona ("defaults to refuted when uncertain") is directly reusable (`nadia-repo.md` §6).
- **Gap addressed**: ce-doc-review personas are leaf reviewers; synthesis merges but never corroborates; a single persona hallucination can block or corrupt a plan.
- **Slot**: S4 (between synthesis and fix application).
- **Cost**: med (verifier fan-out + majority logic; ce-work-deterministic already has this exact pattern in Quality).
- **Conflict risk**: none — mandated by repo principle 4.

#### `agent-performed-fix-application-with-verification`
- **Source**: `ce-doc-review.md` Gap 1 (no post-apply verification that fixes landed faithfully) + §2 Phase 4 ("the orchestrator edits the document inline... no batch-fixer subagent") + base-contract fact A.3 (coordinator does no I/O).
- **What**: In nadia, safe_auto/accepted fixes MUST be applied by a fixer agent (the coordinator cannot edit files), and a follow-up verifier confirms each fix matches its `suggested_fix` intent — catching fixes that landed wrong, not just fixes that didn't land (R30's blind spot). ce-work-deterministic's verified-fix pattern (fix → skeptical-refuter verify) is the template.
- **Gap addressed**: ce-doc-review Gap 1; also a forced adaptation — orchestrator-direct-edit is impossible in a nadia coordinator.
- **Slot**: S4 (after synthesis/routing each round).
- **Cost**: med.
- **Conflict risk**: none (it is the only legal mechanization of ce-doc-review's apply step in this runtime).

#### `staleness-recheck-after-fixes`
- **Source**: `ce-doc-review.md` Gap 2.
- **What**: After a fix-application pass, a lightweight (sonnet) agent re-reads the document and flags remaining findings whose section reference or evidence quote no longer matches the post-edit text, so stale findings are not acted on in the same round.
- **Gap addressed**: ce-doc-review applies safe_auto then routes remaining findings against a now-changed document with no re-synthesis.
- **Slot**: S4 (post-apply, pre-next-action).
- **Cost**: low.
- **Conflict risk**: none.

#### `decision-primer-cross-round` (+ `primer-evidence-window-300`)
- **Source**: `ce-doc-review.md` §1 Phase 2 + §4 (R29/R30 mechanics) + Gap 3 (120-char truncation is a blunt overlap instrument).
- **What**: Carry a decision primer across review rounds (Applied + Rejected with evidence snippets) so round-N reviewers do not re-raise rejected findings and fix-landed status is verified. Candidate improvement on the base mechanism: widen the evidence window (~300 chars) or fall back to full-text comparison when the overlap test is ambiguous — in a coordinator the primer is just data passed in prompts, so size pressure is lower.
- **Gap addressed**: Without a primer, multi-round loops re-litigate; with the 120-char window, suppression/verification misfires on evidence-dense plans.
- **Slot**: S4 (round-to-round state in coordinator variables).
- **Cost**: low-med.
- **Conflict risk**: none.

#### `global-findings-coherence-pass`
- **Source**: `ce-doc-review.md` Gap 4.
- **What**: After mechanical synthesis, one agent reads the *complete* finding set and surfaces cross-finding tensions the fingerprint dedup and chain-linking miss (e.g., a product-lens premise challenge mooting several scope-guardian findings; a coherence fix invalidating a feasibility reference).
- **Gap addressed**: ce-doc-review synthesis is purely mechanical beyond premise chains (3.5c) which only handle the narrow root→dependent case.
- **Slot**: S4 (synthesis tail).
- **Cost**: med.
- **Conflict risk**: low (adds latency per round; keep it one agent).

#### `codebase-context-injection`
- **Source**: `ce-doc-review.md` Gap 6 (no structured codebase-context slot; personas research independently); reinforced by `osmani-web.md` §4.7 (context-engineering: load only what's relevant) and nadia principle 3 (ground every agent).
- **What**: A pre-dispatch research agent (sonnet) assembles a `{codebase_context}` block (stack, conventions, relevant files/patterns, AGENTS.md constraints) injected into every reviewer persona prompt, instead of seven personas each doing exploratory reads. In nadia-plan the S1 research outputs can be reused verbatim for this.
- **Gap addressed**: Feasibility/security/scope findings quality depends on ad-hoc per-persona exploration; duplicated agent work.
- **Slot**: S1 output → S4 prompt slots.
- **Cost**: low (the research already exists in the pipeline; it's plumbing).
- **Conflict risk**: none — direct implementation of the grounding principle.

#### `doubt-extract-step`
- **Source**: `osmani-web.md` §4.5 (doubt-driven-development, remote-only, v0.6.0 PR #139): EXTRACT — state the artifact's contract explicitly before submitting for review.
- **What**: Before dispatching reviewers, the author agent (or coordinator from the author's structured return) states the plan's explicit contract: what it claims to deliver, its requirements, its declared boundaries. Reviewers evaluate against that stated contract, preventing reviewer noise from ambiguous success criteria.
- **Gap addressed**: ce-doc-review reviewers infer the document's intent themselves; the up-the-hill loop (local extension) lacks the EXTRACT discipline (`osmani-web.md` §3, §8).
- **Slot**: S3→S4 handoff (author's schema includes a `contract` field passed into reviewer prompts).
- **Cost**: low.
- **Conflict risk**: none.

#### `no-claim-passing-rule`
- **Source**: `osmani-web.md` §4.5 (doubt-driven: "Forbids passing the CLAIM to the fresh reviewer. Hard rule against confirmation-seeking"; "Am I showing the reviewer my conclusion?").
- **What**: Reviewer prompts carry the original request + plan file content/path + stated contract — never the author's reasoning, confidence, or summary of why the plan is good. Distinct from `doubt-extract-step`: EXTRACT passes the *contract*; this rule strips the *justification*.
- **Gap addressed**: Confirmation bias in review handoffs; not addressed anywhere in ce-plan/ce-doc-review.
- **Slot**: S4 prompt construction rule.
- **Cost**: low.
- **Conflict risk**: none.

#### `reconciliation-precedence`
- **Source**: `osmani-web.md` §4.5 (doubt-driven: "Not every finding warrants a fix; some warrant documentation. Explicit classification required.").
- **What**: Every surviving finding is explicitly classified fix-now vs document-as-known-cost (routed into `## Assumptions` or Open Questions/Scope Boundaries) — no passive deferral. The coordinator logs the classification counts (no-silent-caps).
- **Gap addressed**: ce-doc-review's headless mode just returns findings; ce-plan pipeline mode "addresses P0/P1" with no defined meaning (`ce-plan.md` §5.9).
- **Slot**: S4/S5 routing step.
- **Cost**: low.
- **Conflict risk**: none.

#### `plan-reconsideration-triggers`
- **Source**: `trycycle-web.md` §2.5 (plan reconsidered after the 4th review round, every 2 rounds thereafter, once before declaring nonconvergence).
- **What**: If the review loop is not converging (e.g., blocking findings persist after round N), re-run the strategy gate / re-frame rather than continuing to patch — the loop's failure may be the plan's framing, not its details.
- **Gap addressed**: Neither ce-plan nor ce-doc-review has a "the patient is not responding to treatment" escalation inside the loop.
- **Slot**: S4 loop (a conditional branch at round thresholds).
- **Cost**: med.
- **Conflict risk**: low (adds loop complexity; must stay bounded).

---

### B.2 Scoping and shaping (pre-draft)

#### `strategy-gate`
- **Source**: `trycycle.md` §2, §5 (`subskills/trycycle-planning/SKILL.md` lines 40–49); `trycycle-web.md` R5.
- **What**: Before any unit breakdown, a dedicated step challenges the framing: right problem? right architecture? unvalidated assumptions baked in? Low bar for full direction changes ("do not preserve earlier decisions just because they already exist"); high bar for stopping to ask the user.
- **Gap addressed**: ce-plan's approach-altitude check (Phase 0.1a) fires only on explicit request or high uncertainty+cost; there is no unconditional self-challenge between research and structuring (`ce-plan.md` §1 Phase 0.1a, §5.3).
- **Slot**: S2 (after research, before drafting — research output is exactly the evidence the gate needs).
- **Cost**: low-med (one agent + a branch: proceed / reframe-and-redraft once).
- **Conflict risk**: low — complements Phase 0; the reframe branch must be bounded (one reframe max) to honor bounded-loops.

#### `blocking-unknowns-preflight`
- **Source**: `trycycle.md` §5.8 (SKILL.md step 2: ask only about information that "could materially change the outcome and likely upset the user if guessed wrong"); decision-bias note in `trycycle-web.md` §2.6 ("errs on the side of make a decision and keep going").
- **What**: A single early classification of unknowns into truly-blocking (halt with a question list) vs decidable (decide, record as assumption, proceed). In autonomous mode, blocking unknowns become a structured halt output rather than an interactive question.
- **Gap addressed**: ce-plan Phase 0.5 does this for origin-doc questions but solo plans rely on the scoping synthesis; nadia-plan needs an explicit fail-vs-proceed contract since it cannot converse.
- **Slot**: S0/S2.
- **Cost**: low.
- **Conflict risk**: low (must define halt semantics for the workflow runtime).

#### `appetite-declaration`
- **Source**: `trycycle-web.md` §3.2, R1 (Shape Up Ch. 3: "Appetites start with a number and end with a design"; fixed time, variable scope).
- **What**: The plan opens with a declared appetite (e.g., as an `appetite:` frontmatter field or header line) set before decomposition; scope that exceeds appetite is cut, not stretched. In nadia-plan, appetite can arrive as an arg and drive the depth tier and unit-count budget.
- **Gap addressed**: Both ce-plan and trycycle lack a hard time/size constraint (`trycycle.md` §2: "Appetite as a hard time constraint is absent"); depth tiers approximate it but are derived, not declared.
- **Slot**: S0 (arg) → S3 (written into plan) → S5 (gate: unit count/size within appetite).
- **Cost**: med (new field; scope-cut behavior needs prompt support).
- **Conflict risk**: low — additive; the ce-work parser ignores unknown frontmatter/sections.

#### `no-gos-hardening`
- **Source**: merged from `trycycle-web.md` §3.3, R2 (Shape Up pitch No-Gos: "a plan without explicit no-gos is unshaped"), `osmani-web.md` §4.4 (idea-refine mandatory "Not Doing" list), `osmani-local.md` §3.1 ("Out of scope is non-negotiable... half of misalignment is silent disagreement about what is NOT being built").
- **What**: Make `Scope Boundaries` mandatory-and-non-empty, and have a gate verify the boundaries are real exclusions (specific functionality declared out of bounds), not boilerplate. Three independent methodologies converge on this exact rule.
- **Gap addressed**: ce-plan's Scope Boundaries is include-when-material (`ce-plan.md` §2); UNITS_SCHEMA allows it empty; nothing checks its substance.
- **Slot**: S3 (author requirement) + S5 (gate).
- **Cost**: low.
- **Conflict risk**: none — strengthens an existing contract field.

#### `rabbit-hole-gate`
- **Source**: `trycycle-web.md` §3.2, R3 (Shape Up Ch. 5: shapers must "patch" rabbit holes with deliberate trade-offs before betting; unresolved rabbit holes are a rejection reason).
- **What**: A gate that distinguishes legitimate implementation-time deferrals (ce-plan Phase 3.6's sanctioned `Deferred to Implementation`) from unresolved *design* unknowns (architecture choices, unvalidated technical assumptions, misunderstood dependencies). Design unknowns must be resolved (or spiked, or explicitly traded off) before the plan passes; only execution-detail unknowns may remain deferred.
- **Gap addressed**: ce-plan's `deferredQuestions` is a single undifferentiated bucket; nothing prevents a plan from deferring a load-bearing design decision into execution, where ce-work's split agents would inherit it blind.
- **Slot**: S5 (classification gate over deferredQuestions + Open Questions), optionally feeding S2 reframe.
- **Cost**: med.
- **Conflict risk**: low — refines, does not change, the deferred-questions contract.

#### `hill-position-per-unit`
- **Source**: `trycycle-web.md` §3.1, R4 (Shape Up Ch. 13 hill chart: uphill = unknowns, downhill = confident execution; "a scope is not downhill until the approach is validated"); synthesis rule in `trycycle-web.md` §4 ("no task enters execution while its position is still uphill").
- **What**: Each implementation unit gets an explicit confidence/position assessment (downhill: approach validated against the repo; uphill: open unknowns named). Units still uphill at gate time either get a spike, get resolved, or block the plan. Could be a review-time annotation rather than a plan-document field.
- **Gap addressed**: ce-plan units carry Approach but no honesty marker about whether the approach is validated vs hoped; ce-work executes all units identically.
- **Slot**: S4 (editor/feasibility assessment per unit) + S5 gate.
- **Cost**: med-high if a new unit field (document format addition, though parser-additive); low if review-internal only.
- **Conflict risk**: low-med — new per-unit metadata is outside the UNITS_SCHEMA contract (safe to add in markdown; ce-work ignores it), but conflicts with format minimalism if written into the doc.

#### `spike-units-for-unknowns`
- **Source**: `trycycle-web.md` R15 (convergence of trycycle Strategy Gate and Shape Up rabbit-hole patching); `trycycle.md` §2 (unknown-resolution before commitment).
- **What**: When the rabbit-hole gate finds a design unknown, dispatch a bounded read-only investigation agent (research spike) during planning to resolve it, rather than deferring or halting. Spikes are research, not code — compatible with planning's read-only rule.
- **Gap addressed**: ce-plan Phase 2 explicitly does NOT probe runtime and has no targeted-investigation mechanism for a specific blocking unknown outside the generic deepening pass.
- **Slot**: S5→S1 loopback (bounded: one spike round).
- **Cost**: med.
- **Conflict risk**: med — ce-plan's "does NOT run tests, build app, or probe runtime behavior" must be honored: spikes limited to reading code/docs; anything needing runtime evidence stays a halt or an explicit deferred trade-off.

#### `post-research-scope-recheck`
- **Source**: `ce-plan.md` §5.4 + §5.8 (solo-plan scoping synthesis fires BEFORE research; research-discovered scope surprises have no re-confirmation checkpoint).
- **What**: After S1 research, a step compares the research findings against the intake scope claim and emits a scope delta (feature already exists, approach conflicts with architecture, scope materially larger than stated). In autonomous mode, material deltas route to `## Assumptions` + log, or halt above a severity threshold.
- **Gap addressed**: Direct fix for ce-plan gaps 5.4/5.8.
- **Slot**: S2.
- **Cost**: low-med.
- **Conflict risk**: none.

#### `confirmed-intent-block`
- **Source**: `osmani-local.md` §3.1 (interview-me: six-field Confirmed Intent — Outcome, User, Why now, Success, Constraint, Out of scope — locked downstream); §2.1 (spec reads it as locked input).
- **What**: nadia-plan's intake normalizes its input (request text or origin brainstorm) into a Confirmed-Intent-shaped block that all downstream agents receive verbatim as the locked statement of intent — never re-derived mid-pipeline.
- **Gap addressed**: ce-plan carries the origin doc forward but solo plans have no canonical intent artifact; agents re-infer intent from raw request text at each stage.
- **Slot**: S0 (intake agent produces it; coordinator threads it into every later prompt).
- **Cost**: low-med.
- **Conflict risk**: low — interview-me itself is interactive-only (`osmani-local.md` §5.2); only the *output format* is being borrowed, with the intent derived from args/origin doc rather than live Q&A.

#### `hypothesis-attached-clarifying-questions`
- **Source**: `osmani-local.md` §3.1 (one question at a time, each with the agent's GUESS attached; 95%-confidence stop tested by predictability).
- **What**: In an interactive mode of nadia-plan (if one exists), clarifying questions are emitted one at a time with the hypothesis attached. In autonomous mode, the same discipline degrades gracefully: each would-be question is answered by the agent's own best hypothesis and recorded as a testable assumption.
- **Gap addressed**: ce-plan's question phase asks plainly; the hypothesis-attached form converges faster and self-documents assumptions in headless mode.
- **Slot**: S0/S2.
- **Cost**: low.
- **Conflict risk**: high for the interactive form (a nadia coordinator cannot block on conversation — agents run headless); low for the assumption-recording degradation.

#### `one-thing-per-plan-split-tests`
- **Source**: `osmani-local.md` §2.5 (to-spec/vralphy-spec: the "and" test, the independence test, the "what changed" test; "When in Doubt, Split"); duplicate in `trycycle.md` §2 (scope check: multiple independent subsystems → separate plans, each producing working testable software).
- **What**: An intake/gate check applying the three split tests to the overall request: if it is genuinely N independent things, the workflow either narrows to one (logging the exclusion) or emits N plan documents.
- **Gap addressed**: ce-plan plans whatever it is given; an over-bundled plan produces an over-bundled ce-work run (one branch, one PR, tangled waves).
- **Slot**: S0 (classification) + S6 (multi-output decision).
- **Cost**: med (multi-plan output complicates the output contract and downstream chaining).
- **Conflict risk**: med — ce-work-deterministic consumes exactly one plan per invocation; multi-plan output changes the caller's contract. The narrow-to-one-and-log variant is conflict-free.

---

### B.3 Draft-quality discipline (unit/task organization)

#### `own-the-first-plan-prompt`
- **Source**: `trycycle.md` §5 / `trycycle-web.md` §2.2 (`prompt-planning-initial.md` line 16: "Own the first plan. Do the architectural and semantic thinking now; do not rely on a later review round to find the real gaps"; cover "the parts most likely to be wrong or missing"). Also `trycycle-web.md` R12.
- **What**: The author agent's prompt explicitly forbids leaning on the review loop: it must proactively cover user-visible behavior, contracts and invariants, tricky boundaries, cutover/regression risk in the first draft.
- **Gap addressed**: With a strong review loop downstream, authors (human or agent) under-invest in drafts; neither ce-plan nor the review additions guard against this race-to-the-reviewer dynamic.
- **Slot**: S3 (author prompt).
- **Cost**: low.
- **Conflict risk**: none.

#### `vertical-slice-units`
- **Source**: `osmani-local.md` §1.2–1.3 (dependency graph mapped bottom-up first, then vertical slices; horizontal slicing — all DB then all API then all UI — is an explicit anti-pattern; "each vertical slice delivers working, testable functionality").
- **What**: Unit decomposition guidance: map the dependency graph first, then cut units as vertical slices each delivering a testable, observable outcome. Encoded in the author and editor prompts as a decomposition rule plus an editor check.
- **Gap addressed**: ce-plan's unit guidance ("one meaningful change, one atomic commit, ordered by dependency") permits horizontal layers; nothing names the anti-pattern.
- **Slot**: S3 + S4 (editor checks for horizontal slicing).
- **Cost**: low.
- **Conflict risk**: low — fully compatible with ce-plan unit semantics and ce-work's `dependsOn` waves.

#### `unit-size-caps-and-split-signals`
- **Source**: `osmani-local.md` §1.4–1.6 (XS–XL size table; XL = 8+ files always too large; split triggers: >1 focused session, >3 acceptance criteria, 2+ independent subsystems, "and" in the title; "agents perform best on S and M tasks").
- **What**: Each unit carries a size estimate; the editor/gate rejects XL units and applies the four split signals. Size can live in the markdown (Execution note or a Size line) without breaking the parser.
- **Gap addressed**: ce-plan caps plan-level unit *count* by depth tier but has no per-unit size discipline (`ce-plan.md` §1 Phase 4.1); oversized units are exactly what ce-work's task-splitter then struggles to split well.
- **Slot**: S3 (author) + S4/S5 (check).
- **Cost**: low.
- **Conflict risk**: low — note ce-work's task-splitter already splits units into context-window tasks, so the cap's purpose here is plan quality (reviewability, atomic commits), not context fitting; the editor prompt should say so to avoid double-splitting confusion.

#### `high-risk-first-ordering`
- **Source**: `osmani-local.md` §1.7 ("High-risk tasks are early (fail fast)"); duplicate in `trycycle-web.md` §3.1 (Shape Up: push "scariest work uphill first").
- **What**: Within dependency constraints, order/sequence units so the riskiest (most-likely-to-invalidate-the-plan) work lands in the earliest waves. The author records risk rationale; the editor checks ordering.
- **Gap addressed**: ce-plan orders by dependency only; a plan can backload its riskiest unit, wasting an entire ce-work run when it fails late.
- **Slot**: S3 + S4.
- **Cost**: low.
- **Conflict risk**: med — ce-work derives execution waves from `dependsOn` alone (Kahn), so ordering is only expressible through dependency structure; the rule must shape `dependsOn` choices and unit numbering, not add a new field ce-work would ignore.

#### `checkpoint-insertion`
- **Source**: `osmani-local.md` §1.7 (checkpoints every 2–3 tasks: all tests pass, build clean, core flow works, review before proceeding).
- **What**: Insert explicit checkpoint criteria into the plan every few units.
- **Gap addressed**: Plans have per-unit verification but no intermediate whole-system gates.
- **Slot**: S3.
- **Cost**: low to write, but…
- **Conflict risk**: **high** — ce-work-deterministic already owns mid-run gating (per-wave merge + test + simplify, triage halts, ship gate; `nadia-repo.md` §1.3, §3.7 S18/S24) and would not consume plan-level checkpoints; they would be dead weight or, worse, conflict with wave semantics. Include only as per-unit Verification strengthening, if at all.

#### `parallelization-annotations`
- **Source**: `osmani-local.md` §1.8 (safe-to-parallelize / must-be-sequential / needs-coordination, with "define the contract first, then parallelize").
- **What**: The author classifies unit parallelizability and, for shared-contract units, adds an explicit contract-defining unit first.
- **Gap addressed**: Implicit in `dependsOn` today; the "needs-coordination → define contract first" move is the genuinely new bit (it creates a unit, not an annotation).
- **Slot**: S3.
- **Cost**: low.
- **Conflict risk**: low — ce-work computes parallelism from `dependsOn`; annotations beyond that are unconsumed. Encode the rule as: migrations/shared-state units must appear in `dependsOn` chains; contract-first units precede their consumers.

#### `observable-success-criteria`
- **Source**: `osmani-local.md` §2.4 (spec: reframe vague requirements as observable, numeric conditions — "LCP < 2.5s on 4G", not "faster"); §4.5 (checkpoint criteria as executable commands, not prose).
- **What**: A gate/editor rule that every requirement and per-unit Verification is stated as an observable outcome a validator could check, with numbers where applicable. Directly improves ce-work's Validate phase, which traces `requirements` and per-unit `verification` strings.
- **Gap addressed**: ce-plan asks for "observable outcomes not shell scripts" but nothing enforces testability; vague verification text degrades ce-work's requirements trace.
- **Slot**: S4/S5.
- **Cost**: low.
- **Conflict risk**: none.

#### `file-map-before-units`
- **Source**: `trycycle.md` §4 ("Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in."); `trycycle-web.md` R9. Related: ce-plan Phase 3.4b `## Output Structure` (optional, greenfield-only).
- **What**: Make a plan-level file map mandatory for multi-unit plans, and have the editor cross-check per-unit `Files` lists against it (no orphan files, no file owned by two units without a dependency edge).
- **Gap addressed**: ce-plan's Output Structure is optional/greenfield-only; per-unit Files lists are never cross-validated, and overlapping Files across independent units is exactly what produces ce-work merge conflicts (S6 in the test suite).
- **Slot**: S3 + S4 (cross-check).
- **Cost**: low-med.
- **Conflict risk**: low.

#### `exact-commands-tdd-micro-steps`
- **Source**: `trycycle.md` §4 (tasks as 2–5-minute TDD red/green/refactor/commit steps, complete code in plan, exact commands with expected output); `trycycle-web.md` R10.
- **What**: Trycycle-grade plan granularity: every task carries exact commands, expected output, and full code.
- **Gap addressed**: (none in the ce ecosystem — included for completeness).
- **Slot**: S3.
- **Cost**: high.
- **Conflict risk**: **high — direct contradiction of the base.** ce-plan Phase 4.3 forbids implementation code, git commands, exact test command recipes, and RED/GREEN/REFACTOR micro-steps (`ce-plan.md` §1); ce-work-deterministic owns TDD execution and task splitting (`nadia-repo.md` §1). Adopting this would break the division of labor the output contract encodes. Recommend rejection; listed because the brief says do not pre-filter.

#### `skipped-test-as-failure-standard`
- **Source**: `trycycle.md` §3, §4 ("ANY skipped test is a critical blocking issue"; no test weakening to obtain green); `trycycle-web.md` R11.
- **What**: Encode the completion standard ("all checks green for legitimate reasons; no weakened/deleted/skipped tests") into the plan's Verification text so ce-work's validators inherit it.
- **Gap addressed**: Execution-side discipline; the plan can transmit it even though enforcement belongs to ce-work.
- **Slot**: S3 (boilerplate in Verification guidance).
- **Cost**: low.
- **Conflict risk**: low — advisory text only; ce-work's own validation governs.

#### `read-only-plan-authoring-enforcement`
- **Source**: `osmani-local.md` §1.1 ("Do NOT write code during planning. The output is a plan document, not implementation"); ce-plan Phase 4 "NEVER CODE"; `osmani-web.md` §6 ("Plan first in read-only mode, then execute and iterate continuously").
- **What**: Enforce, not just instruct: every nadia-plan agent except the plan-writer/fixer is prompted (and, where persona files allow, tool-restricted) to read-only; the plan-writer may touch only the plan file path. The final gate verifies (via a sonnet agent running `git status`) that nothing outside the plan file changed.
- **Gap addressed**: ce-plan states the rule but nothing verifies it; trycycle's workspace-hygiene gates (`trycycle.md` §5.7) are the enforcement model.
- **Slot**: S5/S6 (hygiene gate) + persona definitions.
- **Cost**: low-med.
- **Conflict risk**: none.

#### `workspace-hygiene-gates`
- **Source**: `trycycle.md` §5.7 (orchestrator verifies `git status` / changed-file list matches what the subagent reported, between every phase).
- **What**: After any agent that writes (author, fixer, committer), a cheap verification agent reports the actual changed-file set; the coordinator cross-checks it against the writer's self-report and halts/logs on mismatch. Substantially overlaps `read-only-plan-authoring-enforcement` (kept separate because it also covers the write-path agents) and `ready-verdict-evidence-requirement` (the VCS-diff variant of evidence).
- **Gap addressed**: Trusting agent self-reports — the explicit anti-pattern from `osmani-local.md` §4.3.
- **Slot**: S3/S4/S6 (after every mutating agent).
- **Cost**: low-med.
- **Conflict risk**: none.

---

### B.4 Final gates (before handoff)

#### `plan-parse-conformance-gate`
- **Source**: merged from `osmani-web.md` §6 (blog: conformance testing from specs — derived test suites treating the spec as a contract), `nadia-repo.md` §2 (UNITS_SCHEMA + verbatim parse-plan prompt), `ce-plan.md` §5.2 (lfg's gate checks file existence only).
- **What**: Before declaring done, run a sonnet agent with **the exact parse-plan prompt and UNITS_SCHEMA from ce-work-deterministic** against the written plan file. Gate on: non-zero units, all required root/unit fields present, `dependsOn` references resolve acyclically, R-ID references resolve, riskSurfaces well-formed. This converts "the consumer's parser" into nadia-plan's release test — the strongest possible compatibility guarantee, and trivially cheap.
- **Gap addressed**: The known no-plan-quality-gate gap; also the only mechanical guarantee that nadia-plan's output is actually consumable by ce-work-deterministic.
- **Slot**: S5 (mandatory; on failure, one bounded fix round then halt).
- **Cost**: low (schema and prompt already exist in the sibling coordinator — copy them).
- **Conflict risk**: none. Arguably the single most load-bearing candidate in this catalog.

#### `releasability-checklist-gate`
- **Source**: `osmani-local.md` §1.10 (pre-execution checklist: every task has acceptance criteria + verification, dependencies ordered, size caps, plan saved, READY returned, human approved); `ce-plan.md` §5.2 (quality-threshold absence).
- **What**: A content-quality gate distinct from parse conformance: every feature-bearing unit has test scenarios from applicable categories, every KTD has a rationale, Scope Boundaries non-empty, verification observable, no unit oversized, editor verdict READY on file. Checklist results returned as a structured pass/fail-per-item object and logged.
- **Gap addressed**: A schema-valid plan can still be thin; this is the "is it good" complement to "does it parse".
- **Slot**: S5.
- **Cost**: med.
- **Conflict risk**: none.

#### `llm-as-judge-scoring`
- **Source**: `osmani-web.md` §6 (blog: LLM-as-Judge for subjective criteria — style adherence, architectural patterns, not just pass/fail).
- **What**: A judge agent scores the plan against a rubric (clarity, implementability, requirement coverage, decision rationale quality) producing a numeric score per dimension; the coordinator gates or logs on thresholds. Overlaps `releasability-checklist-gate` but is graded rather than binary, useful for trend logging across runs.
- **Gap addressed**: Subjective plan quality has no measurement anywhere in the ce ecosystem.
- **Slot**: S5 (advisory or gating).
- **Cost**: low-med.
- **Conflict risk**: low (risk of score theater; anchor the rubric to observable evidence per nadia's verification ethos).

#### `adversarial-plan-refuter`
- **Source**: `ce-plan.md` §5.3 (no adversarial verifier of plan assumptions/KTDs — all deepening agents constructive); nadia principle 4 (`nadia-repo.md` §5.1); existing `agents/skeptical-refuter.md` (`nadia-repo.md` §6). Related but distinct from ce-doc-review's adversarial persona, which challenges premises but is narrowly triggered and never refutes specific claims to a verdict.
- **What**: Dedicated refuter agents attack the plan's Key Technical Decisions and assumptions one by one ("prove this KTD wrong against the actual codebase"), returning refuted/sustained verdicts with evidence; sustained-refutations become blocking findings. Unlike the doc-review adversarial persona, refuters are *always on* for KTDs and run with the fail-if-uncertain default.
- **Gap addressed**: ce-plan gap 5.3; ce-doc-review Gap 5; repo principle 4 compliance for the plan's load-bearing claims.
- **Slot**: S4/S5.
- **Cost**: med.
- **Conflict risk**: none — required by repo principles for findings that must be trusted.

#### `independent-origin-coverage-verifier`
- **Source**: `ce-plan.md` §5.10 (origin-coverage scan is self-assessed by the planning agent).
- **What**: When an origin/brainstorm doc exists, a separate verifier agent walks the origin section by section and confirms each requirement/decision/boundary is addressed or explicitly deferred in the plan, returning a coverage map with omissions as findings.
- **Gap addressed**: Self-graded completeness; a tired author passes its own scan.
- **Slot**: S5 (conditional on origin present).
- **Cost**: low-med.
- **Conflict risk**: none.

#### `uid-stability-check`
- **Source**: `ce-plan.md` §5.6 (U-ID stability has no automated enforcement; "deepening is the most likely accidental-renumber vector").
- **What**: Across every revision round (editor REVISED, fixer application, deepening), a mechanical (sonnet) check compares before/after U-ID and R-ID sets: IDs may be added or deleted, never renumbered/reassigned; a unit's identity (uid→name/goal pairing) must not silently swap. Violations fail the round.
- **Gap addressed**: ce-work consumes U-IDs by reference; renumbering mid-pipeline silently corrupts `dependsOn`, requirement traces, and resume behavior.
- **Slot**: S4 (after every mutation of the plan doc).
- **Cost**: low.
- **Conflict risk**: none — this enforces an existing base rule.

#### `cross-plan-conflict-scan`
- **Source**: `ce-plan.md` §5.7 (no plan-vs-plan consistency check across concurrent work).
- **What**: A research agent lists other `status: active` plans in `docs/plans/`, extracts their Files/riskSurfaces, and flags overlap with the new plan (same files, conflicting KTDs, duplicate scope). Overlaps become findings/Open Questions, not silent.
- **Gap addressed**: Plans are produced in isolation; conflicts surface only post-work at diff level.
- **Slot**: S1 (data gathering) + S5 (flagging).
- **Cost**: low-med.
- **Conflict risk**: none.

#### `deepening-agent-budget-caps`
- **Source**: `ce-plan.md` §5.5 (the ≤8-agent deepening cap is a recommendation, not enforced; no machinery-level ceiling).
- **What**: In nadia-plan, every fan-out (research, deepening, personas, refuters) gets an explicit numeric cap enforced by the coordinator, guarded on `budget.total` via the `belowBudgetFloor` pattern, with every capped/skipped dispatch logged (no-silent-caps).
- **Gap addressed**: ce-plan gap 5.5 — and it is simply how nadia workflows must be written anyway.
- **Slot**: all fan-out points.
- **Cost**: low.
- **Conflict risk**: none — mandated by principles 5/6.

---

### B.5 Test-strategy and artifact-shape candidates

#### `test-strategy-gate`
- **Source**: `trycycle.md` §5.4 (`prompt-test-strategy.md`: dedicated test-strategy subagent; explicit human approval required — "Silence... does not count as agreement").
- **What**: Before unit decomposition, a test-strategy agent determines sources of truth, harness inventory, and test priorities; its output shapes every unit's Test scenarios. The human-approval part maps poorly to an autonomous coordinator; the agent-produced strategy section maps well.
- **Gap addressed**: ce-plan derives test scenarios per unit with category guidance but no plan-level testing strategy; execution-posture detection (Phase 1.1b) is signal-passing, not strategy.
- **Slot**: S2/S3 (strategy agent before drafting; strategy injected into author prompt).
- **Cost**: med.
- **Conflict risk**: med — the human gate conflicts with autonomous operation (would need an arg-supplied strategy or assumption-routing); the agent-only variant conflicts with nothing.

#### `separate-test-plan-artifact`
- **Source**: `trycycle.md` §5.5 (test plan as a separate post-planning artifact reconciled against the locked plan's actual interfaces; committed separately; forbids tautological tests).
- **What**: After the plan locks, a second agent writes a standalone test-plan document enumerating user-facing actions to the leaf.
- **Gap addressed**: Test thinking quality — but…
- **Slot**: S6 (post-lock).
- **Cost**: high (second artifact, second format, second set of gates).
- **Conflict risk**: **high** — ce-work-deterministic consumes exactly one plan document with embedded `testScenarios`; a separate test plan has no downstream consumer in this pipeline. The valuable kernel (reconcile test scenarios against the *final* post-review plan interfaces; forbid tautological scenarios) can be folded into a final test-scenario-refresh pass on the single document instead. Recommend the folded variant.

#### `testable-assumptions-section`
- **Source**: `osmani-web.md` §4.4 (idea-refine: every direction must name testable assumptions — "the bets you haven't validated yet"); reinforced by ce-plan's headless `## Assumptions` routing (base A.1).
- **What**: Every entry the pipeline routes to `## Assumptions` (inferred scope bets, decided unknowns, hypothesis-answered questions) must be stated testably — what observation would invalidate it — so ce-work's triage/validate agents can actually check assumptions during execution.
- **Gap addressed**: ce-plan's Assumptions section is a dumping ground for Inferred bets with no testability requirement.
- **Slot**: S3/S4 (authoring rule + editor check).
- **Cost**: low.
- **Conflict risk**: none.

#### `section-scoped-context-trimming`
- **Source**: `osmani-web.md` §6 (blog: Extended ToC technique; subagent specialization by spec section with only relevant portions; "parallel agent limits: start with 2-3"); §4.7 (context-engineering: <2,000 lines focused context).
- **What**: For large plans, reviewers/deepening agents receive only their relevant sections plus a hierarchical summary of the rest, instead of the full document.
- **Gap addressed**: ce-doc-review passes full `document_content` to every persona; large plans dilute persona attention.
- **Slot**: S4 prompt construction.
- **Cost**: med (sectioning logic must itself be agent-performed — coordinator can't read the doc).
- **Conflict risk**: med — coherence review *requires* the whole document (its job is cross-section consistency); trimming must be persona-selective. ce-plan's deepening already does section-scoping (`ce-plan.md` §1 5.3.4), so the novelty is applying it to the review personas only.

#### `convergence-eval-scenarios`
- **Source**: `trycycle.md` §5.10 (eval suite: threshold cases — good plan must come back READY with no changes; convergence cases — weak plan must reach correct shape within N rounds).
- **What**: nadia-plan's test file includes both scenario families: (a) a dispatcher returning a strong plan asserts the editor loop exits round 1 with zero rewrites (anti-over-review), (b) a weak-plan fixture asserts convergence within the cap and proper halt+log beyond it. Mirrors ce-work's S11 determinism scenario style.
- **Gap addressed**: Without threshold tests, symmetric accountability is unverifiable; loops that churn forever or rubber-stamp pass silently.
- **Slot**: SH.
- **Cost**: low-med.
- **Conflict risk**: none.

#### `machine-readable-run-summary`
- **Source**: `ce-doc-review.md` Gap 7 (headless text envelope limits workflow integration) + `nadia-repo.md` §2.4 (everything ce-work needs from a plan) — synthesis: the same lesson applied to nadia-plan's own return value.
- **What**: nadia-plan's coordinator returns a structured result object: plan path, planVersion hint (so the caller can pass it to ce-work-deterministic's `planVersion` arg), unit/requirement counts, editor rounds used, residual findings by class, halt reason if any. Enables a future meta-workflow (plan→work chaining) without text parsing.
- **Gap addressed**: ce-plan returns only a path to lfg; everything else is lost.
- **Slot**: S6.
- **Cost**: low.
- **Conflict risk**: none.

#### `grill-against-domain-docs`
- **Source**: `osmani-local.md` §3.2 (grill-with-docs: challenge terms against `CONTEXT.md`, sharpen vague terms, stress-test with invented edge-case scenarios, cross-reference plan claims against actual code, explore-instead-of-ask).
- **What**: A reviewer persona (or extension of coherence/feasibility prompts) that checks the plan's vocabulary against the repo's `CONTEXT.md` glossary and cross-references factual claims about the codebase against the code, surfacing contradictions as findings. nadia repo already maintains `CONTEXT.md` as the domain glossary (`nadia-repo.md` §8), making this immediately actionable.
- **Gap addressed**: No ce-doc-review persona owns terminology-vs-glossary or claim-vs-code verification; coherence is document-internal only.
- **Slot**: S4 (one persona or prompt extension).
- **Cost**: low-med.
- **Conflict risk**: none.

---

### B.6 Sub-candidate notes (folded duplicates)

- **Fresh-context-per-review-round** (trycycle §5.1, doubt-driven "fresh context beats familiar context") — folded into `up-the-hill-editor-loop`; free in nadia since every `agent()` is context-less.
- **Bounded doubt loop, 3-cycle cap** (doubt-driven) — folded into `up-the-hill-editor-loop` cap discussion (3 vs 5 is an Open Question).
- **No-gos / Not-Doing / Out-of-scope** — merged as `no-gos-hardening` (three sources).
- **Structured review JSON + machine-parseable headless output** — merged as `structured-findings-and-mechanical-gates`.
- **Editor artifact trail** — folded into `ready-verdict-evidence-requirement`.
- **Lethal Trifecta** (`osmani-web.md` §6) — a framing principle (speed + non-determinism + cost addressed via verification gates), not a discrete mechanism; it is satisfied collectively by the gate candidates above. Not listed separately.
- **Four-phase gated workflow** (remote spec-driven-development, `osmani-web.md` §4.2) — Specify→Plan→Tasks→Implement with a human gate per phase. The phase structure is already represented by nadia-plan's stage shape; the human gates conflict with autonomous mode the same way `test-strategy-gate`'s does. Folded into the Open Questions on interactivity rather than carried as a separate candidate.

---

## C. OPEN QUESTIONS the designer must settle

1. **Interactive vs autonomous.** A nadia coordinator cannot block on conversation. ce-plan's confirmation checkpoints (scoping synthesis, blocking questions), trycycle's test-strategy human gate, and Osmani's interview/phase gates must each map to one of: (a) an arg supplied up front, (b) assumption-routing into `## Assumptions` with logging, or (c) a structured halt that ends the workflow with a question list. Which gates get which treatment, and what does the halt contract look like to the caller?
2. **The date problem.** The output filename convention (`docs/plans/YYYY-MM-DD-NNN-...`) and frontmatter `date:` require today's date, but `new Date()`/`Date.now()` are banned in the coordinator. Options: require `args.date` (mirroring ce-work's `args.startedAt`), or let the writing agent determine the date itself (it can run `date`). Same question for the NNN sequence number (agent must list `docs/plans/` — fine, agents may do I/O).
3. **Where the plan is saved and who commits it.** ce-work-deterministic requires the plan committed to the repo (`nadia-repo.md` §4.2). Does nadia-plan commit (a consent-style arg like `commit: true` mirroring ce-work's `ship`), or write-only and leave committing to the user? Also: nadia's own `plans/` dir is empty while the ecosystem convention is `docs/plans/` — which directory wins?
4. **Args surface.** Minimum: the request text (or origin doc path). Likely: `origin`, `depth` (or `appetite`), `date`, `commit`, `interactive`-style flags for each optional gate, `editorRounds`, `reviewRounds`, budget knobs. What is required vs defaulted, following ce-work's `args.X !== false` style?
5. **Loop budget split.** How many editor rounds (trycycle/Osmani: 5; doubt-driven: 3) vs persona-review rounds (ce-doc-review soft-stops at 2) vs fix-verify rounds — and do they alternate (review→fix→editor) or nest? All must be guarded on `budget.total` with logged floors.
6. **Persona sourcing.** Do the seven ce-doc-review personas run via plugin `agentType` strings (e.g. `'compound-engineering:ce-coherence-reviewer'`, as ce-work does for its eight code reviewers), or as new local `agents/*.md` files? Same question for plan-author/plan-editor (must be new local personas). Needs a runtime check that the plugin agentTypes resolve for document reviewers.
7. **Conditional-persona triggering.** ce-doc-review selects conditional personas from document signals. In a coordinator, who classifies? (A sonnet classifier agent over the draft, mirroring riskSurfaces extraction, is the obvious shape — but the trigger rules must be ported into its prompt.)
8. **Research replication depth.** Does S1 replicate ce-plan's full Phase 1 (repo-research + learnings + conditional external + spec-flow) with the ce agentTypes, or a reduced set? Which external-research agentTypes are actually resolvable in this runtime?
9. **Fix-application authority.** ce-doc-review applies safe_auto@100 silently. In autonomous nadia-plan, what may the fixer change without any gate — and does the no-gos/scope text enjoy extra protection (a fix must never widen scope)?
10. **Multi-plan output.** If the one-thing split tests fire, does nadia-plan narrow-and-log (one plan) or emit N plans (changing the return contract and the ce-work chaining story)?
11. **U-ID authority.** Which single agent owns ID assignment across rounds (author assigns; editor/fixers may add `U<next>` but never renumber), and is `uid-stability-check` advisory or round-failing?
12. **Halt semantics.** When the editor loop exhausts without READY, or the rabbit-hole gate blocks: does the workflow throw, or return a structured "not ready" result with the draft path and the unresolved concerns (trycycle halts-and-escalates; ce-work throws on early guards but degrades gracefully later)? The answer shapes every gate's fail path.
13. **What "respect the evolved base" means for the document.** Are new sections (Appetite, hill positions, test strategy) written into the plan document (additive markdown is parser-safe) or kept as workflow-internal review artifacts, keeping the document byte-compatible with ce-plan's section catalog?

---

## D. Cross-reference: candidate → gap coverage matrix

| Known gap | Covered by |
|---|---|
| lfg plan gate = file existence only (`ce-plan.md` §5.2) | plan-parse-conformance-gate, releasability-checklist-gate, llm-as-judge-scoring |
| No adversarial verifier of plan claims (§5.3) | adversarial-plan-refuter, finding-refutation-verifiers |
| Scoping synthesis fires before research, solo (§5.4/§5.8) | post-research-scope-recheck, strategy-gate |
| Constructive-only deepening (§5.3) | up-the-hill-editor-loop, symmetric-accountability-prompts, diagnosis-before-action-protocol |
| U-ID stability unenforced (§5.6) | uid-stability-check |
| No cross-plan conflict detection (§5.7) | cross-plan-conflict-scan |
| Deepening budget unenforced (§5.5) | deepening-agent-budget-caps |
| Origin coverage self-assessed (§5.10) | independent-origin-coverage-verifier, ready-verdict-evidence-requirement |
| No post-apply fix verification (doc-review Gap 1) | agent-performed-fix-application-with-verification |
| No re-synthesis after safe_auto (Gap 2) | staleness-recheck-after-fixes |
| Primer truncation (Gap 3) | decision-primer-cross-round / primer-evidence-window-300 |
| No global cross-finding coherence (Gap 4) | global-findings-coherence-pass |
| No refutation of personas' findings (Gap 5) | finding-refutation-verifiers |
| No codebase-context injection (Gap 6) | codebase-context-injection |
| Text-only headless output (Gap 7) | structured-findings-and-mechanical-gates, machine-readable-run-summary |
