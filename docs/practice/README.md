# The Shepherd practice

Shepherd is an engineering practice with two steps, **plan** then **deliver**, each encoded as one deterministic coordinator script:

- [`workflows/shepherd-plan.js`](../../workflows/shepherd-plan.js) (`/shepherd-plan`) turns a request or a brainstorm doc into a committed, machine-checked plan document.
- [`workflows/shepherd-deliver.js`](../../workflows/shepherd-deliver.js) (`/shepherd-deliver`) drives that committed plan to a pull request: split into tasks, route each to an executor, build test-first in isolated worktrees, merge in dependency order, review and validate with verified fixes, and watch CI.

The thesis: **the plan moves into code, not the model's context.** An approved plan run through a coordinator is repeatable and resumable; a plan handed to a model to "just do" drifts, is not reproducible, and is not honestly verified. [`STRATEGY.md`](../../STRATEGY.md) states the target problem as two failures at once: agents that author workflows from memory violate load-bearing rules (coordinator I/O, missing barriers, unbounded loops) and silently corrupt results or run away on agent usage, and model-driven execution of a plan drifts because it is neither repeatable, resumable, nor honestly verified. Shepherd answers both by making each half a coordinator authored against the workflow docs (not from memory) and by making every real action the job of a narrow agent under adversarial verification.

The primary user is an engineer who wants an approved plan implemented end-to-end (split, routed, executed in worktrees, adversarially verified) without babysitting the model.

> Dynamic workflows are the **substrate** this practice runs on, not the headline. If you have not read the substrate rules yet, the authoring contract lives in [`../workflows/README.md`](../workflows/README.md) and is summarized under [Design pillars](#design-pillars) below.

## The end-to-end loop

`/shepherd-plan` produces a plan document and a machine-readable run summary. The summary carries the plan's `planPath` and `planVersion` plus a human-readable `nextStep` string. **A person (or an outer tool) reads that summary and starts a separate `/shepherd-deliver` invocation, passing `plan` and `planVersion` as args.** The seam between the two halves is operator-mediated, not programmatic: plan output does **not** flow automatically into deliver.

```
  /shepherd-plan  (workflows/shepherd-plan.js, 7 phases)
  ┌──────────────────────────────────────────────────────────┐
  │ Intake → Research → Gate → Draft → Review → Gates → Finalize │
  └──────────────────────────────────────────────────────────┘
        │
        │  run summary { planPath, planVersion, nextStep, residualFindings, ... }
        │  nextStep e.g. "Run shepherd-deliver with
        │  { plan: '<planPath>', planVersion: '<hash>' }"
        ▼
  ╔══════════════════════════════════════════════════════════╗
  ║  MANUAL HANDOFF (operator-mediated, not automatic)         ║
  ║  a human / outer tool passes planPath + planVersion into   ║
  ║  a SEPARATE /shepherd-deliver invocation (args.plan,       ║
  ║  args.planVersion)                                         ║
  ╚══════════════════════════════════════════════════════════╝
        │
        ▼
  /shepherd-deliver  (workflows/shepherd-deliver.js, 12 phases)
  ┌──────────────────────────────────────────────────────────┐
  │ Recon → Setup → Split → Route → Execute → Integrate →      │
  │ Quality → Validate → Proof → Compound → Ship → CI          │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
     Pull request (evidence + residuals in the PR body), CI watched
```

Why operator-mediated and not one script: the plan is committed to git first (the `nextStep` string spells out the `git add` / `git commit` when commit was not done in-run), and `planVersion` is the plan file's content hash. Passing a fresh `planVersion` into deliver is what stops a resumed run from replaying a stale cached parse of an edited plan. The operator is the point where the plan becomes a reviewable, versioned artifact before any code is written.

The plan run can also halt **before** producing a plan: a trivial request stops at intake with a ready-to-use `directPrompt` (execute it directly, no plan needed), and a blocking unknown or a non-code request becomes a structured halt whose `nextStep` tells the operator what to resolve. Those are honest exits, not silent failures.

## Design pillars

The five pillars are the *why* behind the *how*. Each links to its deep dive.

### 1. Deterministic coordinators on the dynamic-workflow substrate

Both halves are coordinator scripts in the sense [`../workflows/README.md`](../workflows/README.md) defines: plain JavaScript whose body holds all control flow (loops, branching, accumulation) and does **no I/O**. The coordinator never reads or writes a file, runs a shell command, touches git, or makes a network call. Every real action is delegated to an agent. The coordinators also obey the determinism rules that make resume work: no `Date.now()`, `Math.random()`, or no-arg `new Date()` (each throws), so replaying a run (`scriptPath` + a run id) returns cached results for unchanged `agent()` calls and re-runs only edited or new ones. That is what makes a Shepherd run repeatable rather than a one-shot model session.

### 2. A fleet of narrow, single-purpose personas

Real work is done by a fleet of agents, each with one job and a fresh, empty context window. An agent sees only what its prompt contains, never the coordinator's variables or another agent's output, so every dispatch is **grounded**: the coordinator passes each agent exactly the data, file paths, and authoritative facts it needs. The repo defines **35 persona files** under [`agents/`](../../agents/) (researchers, the plan author and editor, seven review lenses, twelve plan-side role agents, the Codex executor mechanism, the splitter, router, executors, reviewers, verifiers, and the CI watcher). Every dispatcher in `shepherd-plan.js` now carries an `agentType` backed by a file in `agents/`; the deliver coordinator still dispatches some steps as **inline-prompt agents** (prompt and schema at the dispatch site, no persona file). The full catalog and which coordinator dispatches what are in [`./fleet.md`](./fleet.md).

### 3. Typed JSON schemas as the contracts between stages

Every agent returns JSON validated against an `opts.schema`, and every gate and loop predicate reads counted fields, never prose. The schemas are the data contracts that make the practice precise: shepherd-plan defines ~21 of them (e.g. `INTAKE_SCHEMA`, `AUTHOR_SCHEMA`, `EDITOR_SCHEMA`, `RELEASE_SCHEMA`, `ORIGIN_COVERAGE_SCHEMA`) and shepherd-deliver defines ~17 (e.g. `RECON_SCHEMA`, `TASKS_SCHEMA`, `ROUTE_SCHEMA`, `EXEC_SCHEMA`, `VALIDATION_SCHEMA`). They validate every hand-off between stages. Note that same-named schemas can **diverge** between the two files: each coordinator declares its own `VERDICT_SCHEMA` and `FIX_SCHEMA` with different shapes (plan's `VERDICT_SCHEMA` is `{ refuted, reason }`; deliver's is `{ verdict: CONFIRMED|PLAUSIBLE|REFUTED, evidence }`). Only `UNITS_SCHEMA` is genuinely byte-copied between the two files, and that copy is the deliberate plan-format compatibility guarantee.

### 4. Routing: the right executor and model tier per task

In deliver, each task is routed twice: the `executor-router` persona ([`agents/executor-router.md`](../../agents/executor-router.md)) decides Codex CLI vs a Claude executor and picks the tier, emitting a `ROUTE_SCHEMA` verdict the coordinator obeys. Model policy across both coordinators is the same rule: omit `model` to inherit the session model on genuine-reasoning steps, pin `model: "sonnet"` for mechanical/extraction/verification grunt work, and let `opus`/`haiku` reach an executor only through the router's choice. The rubric is grounded in a measurement program, not a guess. Full doctrine in [`./routing.md`](./routing.md).

### 5. Adversarial verification and honest residuals

Nothing an agent self-reports is trusted as ground truth. Any finding, claim, or completion that downstream logic depends on must survive an independent, fresh-context verifier prompted to **refute** it, and anything unresolved or unverified is surfaced as a durable PR residual rather than dropped. The doctrine has two deliberately opposite default-on-uncertainty rules (plan-side precision-biased, deliver-side recall-biased), plus self-report audits that check "fixed" / "pushed" / "documented" claims against observable git state. Full doctrine in [`./verification.md`](./verification.md).

## Skills

Shepherd draws on two kinds of skill files. **Doctrine skills** live in this repo under [`skills/`](../../skills/) and carry the planning and execution discipline as reusable doctrine that agents read before acting. **`ce-*` skills** are externally-installed (compound-engineering) dependencies the coordinators invoke at specific phases. Skill paths in agent prompts resolve from the **session's starting directory**, not from a target repo (a plan or delivery can target a sibling checkout; the doctrine skills are always read from where the session began).

### Doctrine skills (in `skills/`)

| Skill | Doctrine it carries | Who reads it |
|-------|---------------------|--------------|
| [`skills/decomposition`](../../skills/decomposition/SKILL.md) | Decomposing a goal, PRD, issue, or finding into implementation units agents can build and commit independently | `plan-author` and `plan-editor`; `coherence-lens` is rebound to it (DDD naming pass alongside interface-design) |
| [`skills/interface-design`](../../skills/interface-design/SKILL.md) | Designing and reviewing module boundaries, public interfaces, and seam placement | `plan-author` and `plan-editor`; `coherence-lens` is rebound to it |
| [`skills/scoping`](../../skills/scoping/SKILL.md) | Bounding a plan's scope, deciding in vs out, resisting mid-work scope creep (appetite doctrine, sourced from Shape Up) | `plan-author` and `plan-editor`; `scope-lens` is rebound to it |
| [`skills/test-strategy`](../../skills/test-strategy/SKILL.md) | Deciding what to test, choosing mock/stand-in strategy per dependency, matching verification effort to risk | `plan-author` and `plan-editor`; `feasibility-lens` is rebound to it |
| [`skills/zero-context-planning`](../../skills/zero-context-planning/SKILL.md) | Writing a plan, unit, or task brief a fresh-context stranger can execute with no access to the author's context (sourced from trycycle) | `plan-author` and `plan-editor` |
| [`skills/validating-agent-improvements`](../../skills/validating-agent-improvements/SKILL.md) | Validating a proposed change to a coordinator or persona before shipping it (playground A/B, deterministic harness, or evidence transfer) | Read when changing this repo's own coordinators or personas; not read during a normal plan or delivery run |

`plan-author` and `plan-editor` each read the **five** authoring/review skills (all of the above except `validating-agent-improvements`) before acting. Three review lenses are **"rebound to doctrine skills"** in their own frontmatter, meaning each delegates part of its review logic to a named skill rather than carrying it inline: `scope-lens` → `scoping`, `feasibility-lens` → `test-strategy`, `coherence-lens` → `interface-design` + `decomposition`. The other four lenses (`product-lens`, `design-lens`, `security-lens`, `adversarial-lens`) carry their logic inline and reference no skill.

### `ce-*` installed skills (external)

These are externally-installed compound-engineering skills, **not** files in this repo. They are an external integration surface. Three kinds behave differently when absent:

- **Read at runtime via `skillGuide()`** (degrade when the plugin is not installed, because the coordinator falls back to a baked-in inline prompt instead of reading the SKILL.md file): `ce-simplify-code`, `ce-test-browser`, `ce-compound`, `ce-commit-push-pr`. The Recon phase probes for the plugin via `RECON_SCHEMA.ceSkillsRoot`; these four resolve their SKILL.md from that root at dispatch time.
- **Format references / inline rule copies** (behavior is the same whether or not the plugin is installed, because the coordinator embeds the rules or format names directly in inline prompts): `ce-plan`, `ce-work`, `ce-doc-review`, `ce-code-review`.
- **Dispatched via `agentType`, with no inline fallback or `ceSkillsRoot` guard today** (when the plugin is absent these do not resolve, so the Quality phase loses its structured persona-review roster): the `ce-*-reviewer` family (last row below). This hard coupling, and the plan to make the product plugin-independent, is tracked in [#26](https://github.com/vadimcomanescu/shepherd/issues/26).

| Skill | What it contributes | Phase / coordinator that uses it |
|-------|---------------------|----------------------------------|
| `ce-plan` | The plan-document format both halves agree on (plan authors to it; deliver parses it); referenced by name in inline prompts, not read from the plugin | shepherd-plan Draft; shepherd-deliver Recon |
| `ce-work` | The execution/parse protocol: parse conformance is the plan's release test; the per-task build follows its phases; referenced by name in inline prompts | shepherd-plan Gates (parse conformance); shepherd-deliver Split/Execute |
| `ce-doc-review` | The trigger rules shepherd-plan uses to select which review lenses to dispatch; the rules are copied inline into the classify-personas prompt | shepherd-plan Draft (persona selection) |
| `ce-simplify-code` | Quality-only consolidation of the integration branch (simplify-as-you-go and the Quality simplify pass); read via `skillGuide()` | shepherd-deliver Integrate and Quality |
| `ce-code-review` | The always-on reviewer set the persona reviewers mirror; referenced in a comment, not read from the plugin | shepherd-deliver Quality |
| `ce-test-browser` | Browser-proofing affected routes in pipeline mode, with one fix-and-retest round; read via `skillGuide()` | shepherd-deliver Proof |
| `ce-compound` | Documenting non-trivial solved-and-verified problems from the run under `docs/solutions/`; read via `skillGuide()` | shepherd-deliver Compound |
| `ce-commit-push-pr` | The commit / push / open-PR protocol at the ship boundary; read via `skillGuide()` | shepherd-deliver Ship |
| `ce-*-reviewer` family | Per-discipline review personas dispatched in Quality. Always-on quartet: `ce-correctness-reviewer`, `ce-maintainability-reviewer`, `ce-testing-reviewer`, `ce-project-standards-reviewer`. Conditional on risk surface or diff size: `ce-adversarial-reviewer` (fires when changedLines >= 50 OR plan has auth/payments risk surfaces), `ce-security-reviewer` (auth/payments/crypto/public-api), `ce-api-contract-reviewer` (public-api), `ce-data-migration-reviewer` (migrations). | shepherd-deliver Quality |

## Read next

1. [`./plan.md`](./plan.md): shepherd-plan deep dive: the 7 phases (Intake, Research, Gate, Draft, Review, Gates, Finalize), the bounded editor loop, and the releasability gates.
2. [`./deliver.md`](./deliver.md): shepherd-deliver deep dive: the 12 phases (Recon through CI), worktree execution, integration waves, and the ship gate.
3. [`./fleet.md`](./fleet.md): the agent fleet: all 35 personas, what each does, and which coordinator dispatches it.
4. [`./routing.md`](./routing.md): executor + model routing: the `executor-router`, `ROUTE_SCHEMA`, the Codex effort tiers, the measured rubric behind them, and the plan-side Codex lens routing.
5. [`./verification.md`](./verification.md): the verification and honesty doctrine: the two opposite default rules, self-report audits, durable residuals, and the Codex lens precision/recall inversion caveat.
6. [`./parity-ce-plan.md`](./parity-ce-plan.md): ce-plan parity matrix: coverage mapping from ce-plan agents, phases, and doctrine elements to shepherd equivalents, shepherd additions, and open gaps.
7. [`../workflows/README.md`](../workflows/README.md): the dynamic-workflow substrate: the authoring rules every coordinator obeys (`coordinator.md`, `primitives.md`, `constraints.md`, `patterns.md`).

For vocabulary, [`../../CONTEXT.md`](../../CONTEXT.md) is the domain glossary; for product direction, [`../../STRATEGY.md`](../../STRATEGY.md).
