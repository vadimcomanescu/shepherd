# shepherd-deliver: the delivery pipeline

`shepherd-deliver` is one of the two coordinator scripts that make up the Shepherd practice. It takes a committed `ce-plan` plan document (the kind [`shepherd-plan`](./plan.md) produces) and drives it to a pull request: split each plan unit into context-window-sized tasks, route each task to a Codex or Claude executor, build them test-first in isolated git worktrees, merge them in dependency order, then review, validate, browser-proof, document, ship, and watch CI. The whole thing runs unattended; anything it cannot resolve becomes a durable residual in the PR body rather than a silent drop or a blocking question.

It is implemented as a dynamic-workflow coordinator: a JavaScript script body that orchestrates context-less agents and does no real-world I/O itself. If that substrate is unfamiliar, read [the dynamic-workflow docs](../workflows/README.md) first. This page is the deep dive on the delivery script (`workflows/shepherd-deliver.js`) and the agents it dispatches. For the agent fleet catalog see [`./fleet.md`](./fleet.md); for the executor/model routing rubric see [`./routing.md`](./routing.md); for the verification doctrine see [`./verification.md`](./verification.md).

The plan-to-deliver handoff is **manual**, not programmatic. `shepherd-plan` finishes by emitting a run summary with the plan path and a `planVersion`; a human (or an outer tool) reads that and starts a separate `/shepherd-deliver` invocation with those values. Plan output never flows automatically into delivery.

`/shepherd-deliver` is the invocation name by convention (the script's `meta.name` is `shepherd-deliver`, and the `workflows/` directory is whole-directory symlinked into `.claude/workflows/`). The exact runtime command-discovery mechanism is not documented in-repo.

---

## Arguments

All coordinator input arrives through `args` (the script body reads nothing from disk). The runtime can deliver `args` as a JSON string or an object; the script parses both at the boundary and throws immediately if `args.plan` is missing.

| Arg | Default | Meaning |
|-----|---------|---------|
| `plan` | required | Path to the `ce-plan` document to execute. Absent, the script throws before doing anything. |
| `planVersion` | `unversioned` | A hash or mtime for the plan file. **Pass a NEW value whenever you edit the plan**, so a resumed run re-parses it instead of replaying a stale cached parse. |
| `base` | `recon.defaultBranch` | Base branch to fork the integration branch from. |
| `slug` | `planDoc.slug` | Branch slug. Defaults to a kebab-case slug derived from the plan title. |
| `codex` | `true` | Whether the Codex executor is permitted. `CODEX_ENABLED = args.codex !== false`. |
| `sandbox` | `yolo` | Codex sandbox mode: `yolo` (`--dangerously-bypass-approvals-and-sandbox`) or `full-auto` (`-s workspace-write`). |
| `effortFloor` | from config | Minimum Codex reasoning effort: `minimal` / `low` / `medium` / `high` / `xhigh`. If unset, read from `.compound-engineering/config.local.yaml` (`work_delegate_effort`). |
| `proof` | `true` | Whether the Proof phase browser-tests affected routes. |
| `ship` | `true` | Whether to commit, push, and open a PR. **`ship: true` IS the consent to push and open a PR.** |
| `compound` | `true` | Whether the Compound phase documents solved problems under `docs/solutions/`. |
| `ciRounds` | `3` | Max CI watch-fix-push iterations, hard-clamped to 1..10 so a bad arg cannot unbound the loop. |
| `repo` | session cwd | Target repository (not in the `whenToUse` contract). When set, every agent dispatch is prefixed with a `TARGET REPOSITORY` grounding block so agents resolve all paths against it. |

`effortFloor` resolution: `args.effortFloor` wins over the config value. When a floor is set, the router's `default` pick is substituted to `medium`, then `max(pick, floor)` wins on the scale `minimal < low < medium < high < xhigh`. One other input, `codexWaitRounds`, is used internally as the per-Codex-task poll-round cap. `startedAt` appears in the `meta.whenToUse` descriptor but is not currently read by the script body. Neither is part of the documented contract.

The codex availability the rest of the run depends on is a three-way AND: `codexUsable = CODEX_ENABLED && recon.codexAvailable && !recon.insideCodexSandbox`. Even with `codex: true`, Codex is off when it is not installed or when the run is itself already inside a Codex sandbox.

---

## The 12 phases

```
plan doc (ce-plan)
      |
      v
  +---------+   parse plan -> units(U-IDs)+requirements(R-IDs)+riskSurfaces;
  | RECON   |   probe repo + codex availability   [inline, parallel barrier]
  +---------+
      |
      v
  +---------+   create integration worktree .worktrees/<slug> on feat/<slug>
  | SETUP   |   [inline agent]
  +---------+
      |
      v
  +---------+   task-splitter: each UNIT -> context-window TASKS (dossiers)
  | SPLIT   |   one concern, <=~5 files, <=~300 lines, one test cmd; U3a/U3b deps
  +---------+
      |
      v
  +---------+   executor-router: ROUTE_SCHEMA {executor, effort, model, reason}
  | ROUTE   |   per task   [persona, sonnet]            (see ./routing.md)
  +---------+
      |
      v
  +---------+   dependency WAVES; each task in its OWN worktree;
  | EXECUTE |   codex-runner | unit-executor; fallback/finisher; circuit breaker
  +---------+
      |
      v
  +-----------+ merge task branches wave by wave + test;
  | INTEGRATE | simplify-as-you-go after a wave that merged 2+ tasks
  +-----------+
      |
      v
  +---------+   simplify -> persona + codex reviewers -> proximity dedup ->
  | QUALITY |   finding-verifier -> verdict-conditional fix -> fix audit -> sweep
  +---------+                                              (see ./verification.md)
      |
      v
  +----------+  trace every R-ID + unit; full suite + lint; (ship-gate recheck)
  | VALIDATE |  [inline]
  +----------+
      |
      v
  +---------+   browser-test affected routes, exactly one fix-and-retest round
  | PROOF   |   (gated by args.proof)   [inline, sonnet]
  +---------+
      |
      v
  +----------+  document non-trivial solved+verified problems under docs/solutions/
  | COMPOUND |  BEFORE Ship so the docs commit rides the one push
  +----------+
      |
      v
  +---------+   gate-recheck -> commit, push, open PR with evidence + residuals
  | SHIP    |   ship:true is the consent   [inline, sonnet]
  +---------+
      |
      v
  +---------+   ci-watcher bounded autofix loop (ciRounds): watch-fix-push,
  | CI      |   reproduce-before-fix, never weakens tests   [persona]
  +---------+
      |
      v
  PR + run summary
```

A note on the agents this pipeline dispatches: only the files under `agents/` are **personas** (dispatched with `agentType`, which resolves to `agents/<name>.md` by convention via the `.claude/agents` symlink and name-matching). The deliver-side personas are `task-splitter`, `executor-router`, `unit-executor`, `codex-runner`, `codex-reviewer`, `finding-verifier`, and `ci-watcher`. Everything else the script dispatches (`setup-integration`, `diffstat`, the integrator, the simplify passes, the wave triage, the fixers, `audit-fixes`, the validation agent, `gate-recheck`, the ship agent, the compound agent, `audit-compound`, the CI residual recorder) is an **inline-prompt agent**: dispatched with just a label and a schema (and usually a model), with no `agentType` and no persona file. The prompt carries everything.

Personas do not carry an intrinsic model tier from their file, with two exceptions: `codex-runner` and `codex-reviewer` pin `model: sonnet` in their own frontmatter (the protocol operator is mechanical; Codex does the real work). Every other tier comes from the dispatch site. The `unit-executor`'s tier in particular comes from the `executor-router`'s `ROUTE_SCHEMA.model`, never from the session model.

---

## Phase-by-phase

### Recon

Two agents run in parallel (the only strict barrier in this region of the script, justified because both Setup and Split need both results):

- **parse-plan** (inline, `sonnet`, `UNITS_SCHEMA`) reads the plan document at `args.plan` and extracts it: `planTitle`, `slug`, `riskSurfaces` (a subset of `auth`, `payments`, `migrations`, `crypto`, `public-api`, `deps`), plan-level `requirements` (each an `{id, text}` R-ID), `deferredQuestions`, `scopeBoundaries`, and every implementation unit. The prompt passes `args.planVersion` to bust a stale cache, and instructs the agent to quote field text rather than paraphrase. If the file is missing or carries `execution: knowledge-work` frontmatter, it returns zero units and explains in `planTitle`. Each unit carries `uid` (the U-ID, e.g. `U3`), `name`, `goal`, `dependsOn` (other U-IDs), `files`, `approach`, optional `executionNote`, `patterns`, `testScenarios`, and `verification`.
- **repo-recon** (inline, `sonnet`, `RECON_SCHEMA`) probes the repository: `repoRoot`, `defaultBranch`, `baselineClean` (is `git diff --quiet HEAD` clean on the main checkout), the real `testCommand` and `lintCommand`, a `conventionsDigest` (<=20 lines distilled from `AGENTS.md`/`CLAUDE.md`), `codexAvailable`/`codexPath`, `effortFloor` (from `.compound-engineering/config.local.yaml`), `insideCodexSandbox` (true when `$CODEX_SANDBOX` or `$CODEX_SESSION_ID` is set), `ceSkillsRoot` (the highest-installed compound-engineering plugin's `skills/` dir), `agentBrowserAvailable`, and `ghAvailable`.

Recon is inline (no persona file). After it, the script throws if either agent returned null, if no units were extracted, or if the main checkout has uncommitted tracked changes (commit or stash first). It then computes `codexUsable`, derives `SLUG` and `BASE`, the effort floor, `INTEGRATION_BRANCH = feat/<slug>`, and `INTEGRATION_WT = <repoRoot>/.worktrees/<slug>`.

### Setup

One inline agent (`setup-integration`, `sonnet`) creates the integration worktree: `git fetch origin <base>`, then `git worktree add <INTEGRATION_WT> -b feat/<slug> origin/<base>` (falling back to the local base ref when the remote ref is unavailable; reusing an existing worktree only if its tree is clean, otherwise failing). It copies `.env*` files into the worktree and ensures `.worktrees` is gitignored via `.git/info/exclude`. It returns `ok: <path>` or `fail: <reason>`. The coordinator scans the response lines for the sentinel (real agents wrap it in narrative), and any `fail:` wins. From here on, **the main checkout is never touched again**: all work happens in worktrees.

### Split

The `task-splitter` persona (`agents/task-splitter.md`, no model key so it inherits the session model, `TASKS_SCHEMA`) splits each plan unit into context-window-sized tasks, running over units with `pipeline()` (no barrier is needed until wave computation later). A task fits one fresh context window when all of these hold: ONE concern (its commit message needs no "and"); <=~5 implementation files plus their tests; estimated diff <=~300 lines (a signal, not a hard predicate); the dossier is fully self-contained; and it is verifiable by one targeted test command run.

The **dossier** is the load-bearing output: a fully self-contained work brief (goal, exact file paths, approach, patterns to mirror, test scenarios, verification outcome) that requires no access to the plan to act on. The splitter weaves the relevant repo conventions, deferred questions, and scope boundaries into each dossier, because the executor sees nothing but the dossier.

When a unit is split, task IDs become the U-ID plus a letter (`U3a`, `U3b`, ...) in dependency order; an unsplit unit keeps its bare U-ID. Tasks from the same unit that touch the same file MUST be chained via `dependsOn` (intra-unit, task-IDs only) so they do not run in separate parallel worktrees and collide at merge. Each task also carries `risk` (`trivial`/`low`/`medium`/`high`), `ambiguity` (`none`/`some`/`high`), and `estDiffLines`.

If the splitter drops a unit (returns null), the drop propagates transitively: any unit that depends, directly or through a chain, on a dropped unit is also skipped, and the script logs the dropped units and the pre-skipped tasks. This is a surfaced cap, not a silent one.

### Route

Immediately after a unit is split, each of its tasks is routed in parallel by the `executor-router` persona (`agents/executor-router.md`, forced to `model: sonnet` at the dispatch site, `ROUTE_SCHEMA`). The router is mechanical: its output is an enum, not a design judgment. It emits `ROUTE_SCHEMA` = `{ executor: codex|claude, effort: default|medium|high|xhigh, model: haiku|sonnet|opus, reason }`. If the router returns null, the task defaults to `{ executor: 'claude', effort: 'default', model: 'sonnet', reason: 'router failed — defaulted to claude/sonnet' }`.

The router always picks a Claude model tier even for Codex tasks, because that tier is reused for the Claude fallback/finisher if the Codex run fails or stalls. The deep rubric (when to pick Codex vs Claude, the effort tiers, the haiku/sonnet/opus selection with its measured rationale) lives in [`./routing.md`](./routing.md). Two facts matter here. First, the live effort tiers are `default`, `medium`, and `xhigh`; `high` is in the schema enum but the router never emits it and the dogfood measured that high effort never beat medium, so it is schema-permitted-but-unused. Second, the model field is never inherited from the session: the Claude executor runs at exactly the routed tier.

After routing, the coordinator builds the full task graph in pure JS: it expands each unit's dependencies to task-level (`allDeps`), and if `codexUsable` is false it rewrites every Codex-routed task to Claude with `reason` appended `[codex unavailable — overridden]`. It then runs Kahn's algorithm (guard limit 100 levels; a cycle throws) to assign every task a dependency level and groups levels into ordered **waves**.

### Execute

Waves execute sequentially; within a wave, all tasks run in parallel (the barrier is justified because the merge loop that follows must see all results and run in fixed order). Each task runs in its **own isolated git worktree** at `<repoRoot>/.worktrees/<taskId>` on branch `wf/<slug>/<taskId>`, created from the integration branch (retry up to 3 times on ref-lock errors, since sibling agents race). Executors never touch the main checkout and never push.

Dispatch per task:

- **Codex-routed** (and circuit breaker not tripped) -> `codex-runner` (`agents/codex-runner.md`, `sonnet`, `EXEC_SCHEMA`). The runner is a protocol operator: it writes a schema and a structured `prompt.md` for Codex (with a `<testing>` section that forces test-first work and a `<verify>` section that forbids reporting `completed` unless tests pass), launches `codex exec` in the background, polls for the result file, classifies it, and commits the worktree. It never reports `completed` unless Codex reported completed AND a commit now exists on the branch.
- **Claude-routed** -> `unit-executor` (`agents/unit-executor.md`, `model: t.route.model || 'sonnet'`, `EXEC_SCHEMA`), at the routed tier. The unit-executor implements one dossier test-first (RED: write one minimal failing test for the slice and confirm it fails for the expected reason; GREEN: minimum code to pass; REFACTOR: only with tests green), skipping test-first only for trivial renames, pure configuration, and pure styling (and saying so). It reports `completed` / `partial` / `failed` honestly, verified against a fresh test run in the same session.

`EXEC_SCHEMA` = `{ status: completed|partial|failed, branch, worktreePath, filesModified, verificationSummary, issues }`.

Post-execution triage handles imperfect results:

- **Codex failure** -> a `unit-executor` claude fallback is dispatched in a FRESH worktree, after stale-cleanup commands (kill any lingering process, force-remove the worktree, delete the branch).
- **Any partial** (Codex or Claude) -> a `unit-executor` finisher is dispatched in the SAME worktree, told not to recreate it, to review the existing diff, complete the known gaps, and report `completed` only if verification passes.
- **Circuit breaker**: a Codex result that is `failed` or `partial` increments a streak; `completed` resets it. After 3 consecutive non-completed Codex results, `codexBroken` is set and all remaining Codex-routed tasks route to Claude for the rest of the run.

A budget stop-loss ends the run cleanly with a partial result instead of mid-wave throws: when remaining tokens drop to `BUDGET_FLOOR` (30000), the unrun tasks in remaining waves are marked skipped (`token budget exhausted before dispatch`) and execution stops.

### Integrate

After a wave's tasks finish, they are merged into the integration branch by a sequential merge loop in fixed task order (deterministic for resume). Only tasks with `status: completed` AND a branch are merged; a surviving partial (the finisher could not close the gaps) is treated as failed so its dependents skip.

The integrator (inline, `sonnet`, `MERGE_SCHEMA`) runs `git merge --no-ff <branch>`, then the test suite. On a clean merge with failing tests it may diagnose and fix, or `git reset --hard` and return `tests-failed`. On a conflict it aborts and returns `conflict` rather than hand-resolving; the coordinator then re-executes the task with a fresh `unit-executor` against the current integration-branch tip and retries the merge. A failed integration adds the task to the failed set, skipping its dependents. `MERGE_SCHEMA` = `{ status: merged|conflict|tests-failed, detail }`.

Two between-wave behaviors:

- **Wave-boundary triage** (inline, `TRIAGE_SCHEMA`) fires when executor discoveries exist AND tasks remain. It is a stop-loss, not re-planning: it halts ONLY when a discovery falsifies a premise the remaining tasks are built on (a module they extend turns out not to exist, an API contract they assume is wrong, the capability they add already exists). Routine friction continues; the plan was human-reviewed, so executing it is the default and halting hands the decision back to the human (who edits the plan and re-runs with a new `planVersion`).
- **Simplify-as-you-go**: after a wave that merged 2 or more tasks (and is not the final wave), an inline simplify agent (`SIMPLIFY_SCHEMA`) consolidates duplication on the integration branch via the `ce-simplify-code` skill (or its inline fallback when the plugin is absent) BEFORE the next wave's worktrees fork from it. Behavior preservation is non-negotiable, and dead-code deletion requires a grep for remaining references; candidates it keeps are recorded in `kept` and surfaced as PR residuals. The final wave is covered by the Quality simplify instead.

If no task merged at all, the script throws (nothing to review). If the run halted (plan invalidated or budget exhausted), Quality and Validate are skipped and the branch holds the merged partial work for the human.

### Quality

The review gate, all on the integration worktree. A `diffstat` agent (inline, `sonnet`) measures the total changed-line count, which gates the rest. If >=30 lines changed, an inline simplify pass runs first.

The **reviewer roster** is assembled, then fanned out:

| Reviewer | Type | Condition |
|----------|------|-----------|
| correctness, maintainability, testing, standards | compound-engineering persona reviewers (`agentType`) | always |
| security | `ce-security-reviewer` | `riskSurfaces` includes auth/payments/crypto/public-api |
| migrations | `ce-data-migration-reviewer` | `riskSurfaces` includes migrations |
| api-contract | `ce-api-contract-reviewer` | `riskSurfaces` includes public-api |
| adversarial | `ce-adversarial-reviewer` | changed lines >=50 OR auth/payments |
| codex | `codex-reviewer` persona (`sonnet`, second model family) | `codexUsable && !codexBroken` |
| removed-behavior, cross-file | inline single-angle prompts (no persona) | always |

The persona reviewers are external compound-engineering reviewer agents reached via `agentType`. The `codex-reviewer` runs the Codex CLI read-only over the diff as a different model family (it catches what same-family review rationalizes away); its findings face the same Claude verifier as everyone else's. Each reviewer produces `FINDINGS_SCHEMA` findings, each with a `failure_scenario` (concrete inputs/state that produce the wrong outcome, or the concrete cost for cleanup-style findings).

Findings stream through **proximity dedup** as each reviewer completes (the dedup runs inside the reviewer pipeline, so a duplicate never consumes a verifier slot). Two findings are the same defect when they share a file AND either both have line numbers within 5 of each other, or (when at least one is line-less) their normalized titles share a real 30-char prefix, falling back to exact title equality for short titles. A duplicate is absorbed into the kept entry, merging severities and write-ups; a blocking duplicate can escalate a suggested entry (refunding its slot) and even revive a previously refuted or budget-dropped entry for re-verification with the merged evidence.

Each surviving (non-nit, non-duplicate) finding draws a **`finding-verifier`** (`agents/finding-verifier.md`, `sonnet`, `VERDICT_SCHEMA`) under a **verify budget**. The verifier reads the actual code and grades on a recall-biased ladder: `CONFIRMED` only when it can name the concrete triggering inputs/state AND quote the offending line; `REFUTED` only when the refutation is constructible from the code (quote the disproving line, invariant, or guard); otherwise `PLAUSIBLE`, the explicit default for realistic-but-unproven findings. Anything not `REFUTED` survives. A genuine `REFUTED` is recorded with its evidence in `reviewDrops.refuted`; a crashed verifier is a separate bucket (`verifierFailed`) that still drops the finding (fail if uncertain) but is never reported as a refutation.

The budget: suggested-severity findings draw from a fixed pool (`MAX_VERIFY = 25`); blocking findings draw from a separate, generous pool (`MAX_BLOCKING_VERIFY = 50`) so an inflated roster cannot spawn unbounded verifiers toward the agent cap. `MAX_BLOCKING_VERIFY` is a **dispatch-time** cap (the no-silent-caps principle); a NEW blocking finding that arrives after the pool is exhausted is dropped unverified rather than guaranteed a slot. An already-deduped entry that a blocking duplicate later escalates is re-queued and verified immediately, bypassing the ceiling (so it is not a hard guarantee that every first-pass blocking finding is verified, but escalated entries always get one). Findings dropped at either cap are logged with identity, counted as `budgetDropped`, and are NOT confirmed, NOT fixed, and NOT residuals (they appear in logs and stats only). Nit-severity findings are excluded from verification as a deliberate cost cap, logged to `nitsDeferred` and returned in the result, never silently dropped.

Confirmed findings (kept entries with a verdict) are fixed by inline per-file fixer agents (`sonnet`, `FIX_SCHEMA`), applied sequentially because they share the one integration worktree. Fixers follow the **verdict-conditional policy**: `CONFIRMED` findings must be fixed unless the fixer can prove from the code that the finding is wrong; `PLAUSIBLE` findings may receive only local, behavior-preserving fixes, otherwise they are skipped with the verifier's evidence cited. A fixer reports a finding fixed ONLY when its fix commit now exists on the branch, audited against this session's `git log`.

Because a "fixed" claim is a self-report, an inline **fix audit** (`audit-fixes`, `sonnet`) then reads the actual commits and demotes any claim with no backing commit to a residual. A dead or budget-skipped audit leaves a durable UNAUDITED residual rather than trusting the claims silently.

Finally, a **gap-hunting sweep** (inline, `FINDINGS_SCHEMA`, capped at 8 candidates) hunts what the first pass missed. It runs only when >=50 lines changed (skipped under 50, logged), and is excluded from re-deriving every already-examined finding (verified, refuted, and cap-dropped alike). Its survivors go through the same dedup and verification path.

Coverage losses are loud, never silent. A dead reviewer is NOT a clean reviewer: its entire perspective is gone, recorded in `reviewDrops.reviewerDied` and surfaced as a **COVERAGE GAP** residual. A dead verifier is an **UNVERIFIED** drop. This recall-biased gate is the deliver half of the [verification doctrine](./verification.md); the plan half is precision-biased (opposite default on uncertainty), and the doctrine page contrasts the two.

### Validate

A reusable `runValidation` agent (inline, `VALIDATION_SCHEMA`) traces the integrated branch against the plan:

1. Run the full test suite (`recon.testCommand`).
2. Run lint (`recon.lintCommand`).
3. Requirements trace: every plan-level R-ID judged `satisfied` / `partial` / `unmet` with one line of evidence against the merged diff.
4. Per-unit verification: each unit's verification criterion judged `verified` / `partial` / `unmet`.
5. Deferred-question check: for each question the plan deferred, judge from the diff whether it was actually resolved.
6. Post-deploy checks: 2-5 concrete things to monitor after deploy (these go into the PR body verbatim).

The agent fixes nothing and reports honestly; crucially, `testsPass` and `lintPasses` come strictly from the exit codes of the commands run in THIS session, never from memory or a prior agent's report. `runValidation` is a function precisely so the Proof phase can re-run the WHOLE trace after a fix commit lands (re-grounding only tests+lint would leave the requirements/deferred/post-deploy evidence asserting the pre-fix snapshot).

The independent **ship-gate recheck** described under Ship is a second, fresh-context re-run of tests+lint that fails closed; it is the last line before the irreversible push.

### Proof

Gated on `args.proof`, green validation, `agent-browser` availability, and budget (in that order; each failed gate sets a `skipped` proof object with the reason). When it runs, an inline proof agent (`sonnet`, `PROOF_SCHEMA`) browser-tests the affected routes following the `ce-test-browser` skill, or its baked-in inline fallback when the plugin is absent (`mode:pipeline`: port detection, dev-server auto-start, mapping changed files to routes, per-route checks with the `agent-browser` CLI). It returns `not-applicable` when no changed file maps to a route (it does not invent routes) and `tool-missing` when `agent-browser` is unusable.

On route failures it runs **exactly one** fix round: a proof-fix agent diagnoses the root cause and commits (reporting `committed` only if a commit now exists), then a proof-retest re-checks the previously failing routes. Because that fix committed code after the final validation, the full validation is re-run (`proof-revalidate`), failing closed if the re-validation agent dies. If no fix lands, the honest failure is kept (retesting identical code invites a flaky pass masquerading as a fix), and the failures become PR residuals.

### Compound

Gated on `args.compound`, passing tests, and budget. It runs BEFORE Ship deliberately, so the docs commit rides the one push (a post-ship push would restart CI from zero). An inline compound agent (`sonnet`, `COMPOUND_SCHEMA`) documents non-trivial solved-and-verified problems from the run under `docs/solutions/` following the `ce-compound` skill (or its inline fallback when the plugin is absent), committing `docs(solutions): compound learnings from <slug>` but NOT pushing. Candidate material the coordinator hands it (tasks recovered via fallback/finisher, fixed review findings, a successful proof fix) is flagged as a self-report requiring confirmation against the actual commits. A routine run with no surprises documents nothing. An inline `audit-compound` agent then verifies each claimed path exists, is committed, and has parseable frontmatter, demoting any that fail.

### Ship

`ship: true` is the consent to push and open a PR. The phase is gated on `args.ship`, a validation result, both tests and lint green, and budget. The push is the one irreversible step, so it is fronted by the independent **`gate-recheck`** agent (inline, `sonnet`): a fresh context runs exactly the test and lint commands and reports their exit codes. If it dies or contradicts validation, the branch is left unpushed (fail closed).

Past the gate, an inline ship agent (`sonnet`, `SHIP_SCHEMA`) ships via the `ce-commit-push-pr` skill (or its inline fallback when the plugin is absent): flip the plan's frontmatter `status: active` to `status: completed` inside the worktree (skipping if the plan file is not found under the worktree, and never editing files outside it), commit any uncommitted changes by name, push, and create or update the PR. The PR body must contain, verbatim, a `## Requirements` section (per-R-ID verdict and evidence), an `## Evidence` section (tests, lint, browser proof), a conditional `## Residuals` section (every residual category below), and a `## Post-Deploy Monitoring & Validation` section. After it self-reports, an inline `ship-verify` agent independently observes the actual remote state (`git fetch` + HEAD vs `@{u}`, and `gh pr view`); on contradiction, the observed state overrides the self-report, since `pushed`/`prUrl` gate the CI phase.

### CI

Entered only when `ship.pushed` AND `ship.prUrl` are both truthy. A bounded loop (`ciRounds`, default 3, clamped 1..10) dispatches the **`ci-watcher`** persona (`agents/ci-watcher.md`, `CI_SCHEMA`) once per iteration. Each watcher does one watch-fix-push iteration: watch the PR's checks; if green, return `green` (never without fresh `gh` output); if red, enumerate failures, pull logs, and find the root cause. It enforces a **reproduce-before-fix** gate (reproduce the failure locally, fix the root cause, and watch the same failure go red-to-green as evidence the fix is real), **never weakens, skips, mocks, or deletes a failing test** to get green, and classifies honestly (`green` / `red` / `no-ci`). When it pushes a fix it returns `red` with `fixedAndPushed: true`, and the orchestrator re-watches on the next iteration.

The coordinator threads a per-round history into each watcher so a later round does not repeat a failed approach. The loop exits on green/no-ci, on a red result with no fix pushed (re-watching would loop on the same failure), or on the round cap. Any terminal non-green state (red with the loop exhausted, an unknown watcher death, or a budget-skipped CI) triggers a durable `## CI Status Unresolved` annotation appended to the PR body by an inline `ci-residual` agent, with one bounded retry if the recorder dies. `CI_SCHEMA` = `{ checks: green|red|no-ci, fixedAndPushed, detail }`.

---

## Residuals

The autopilot contract: anything Shepherd could not resolve becomes a durable line in the PR body's `## Residuals` section, never a silent drop. The taxonomy, all assembled into `residualLines` at Ship:

| Residual | Source |
|----------|--------|
| **Confirmed-but-unfixed finding** | A verified finding a fixer skipped, did not account for, or could not fix (fixer died). |
| **UNAUDITED fix claim** | Fixer "fixed" self-reports the fix audit never checked (audit died or was budget-skipped). |
| **UNVERIFIED drop** | A finding whose `finding-verifier` produced no verdict (verifier died); dropped fail-closed without verification. |
| **COVERAGE GAP** | A reviewer that produced no result; its entire review perspective is missing from the PR's quality gate. |
| **Failed / skipped task** | A task that failed, or was skipped because a dependency or prerequisite unit failed, or was dropped by the splitter, or skipped at the budget floor. |
| **Unmet requirement** | A requirement traced `partial` or `unmet`, or a deferred question the implementation left unresolved. |
| **Browser-proof failure** | A route that failed proof (or a dead proof agent: routes were never browser-tested). |
| **Unresolved CI** | Recorded separately as the `## CI Status Unresolved` PR section, with the round history. |
| **Kept dead-code candidate** (info) | A simplify pass kept a candidate rather than deleting it without proof. |

The full run summary returned by the coordinator carries the same information structurally (`residualReviewFindings`, `reviewDrops`, `reviewStats`, `fixAudit`, `nitsDeferred`, `simplifyKept`, `droppedUnits`, per-task results, `validation`, `shipGate`, `proof`, `ship`, `ci`, `compound`, `planInvalidation`, `budgetHalted`), so a stranger can reconstruct exactly what ran, what was dropped, and why. Note that Shepherd's effectiveness metrics (escaped-defect rate, unattended completion rate, rework rate, cost per executed task) are aspirational targets in [`STRATEGY.md`](../../STRATEGY.md), measured manually from run reports and git history; nothing is instrumented yet.

---

## External skills this pipeline depends on

Several phases delegate to the **`ce-*`** skill family, which is an **externally installed** dependency (the compound-engineering plugin), not files in this repo. The deliver pipeline depends on:

- **`ce-simplify-code`**: the simplify-as-you-go (Integrate) and Quality simplify passes.
- **`ce-test-browser`**: the Proof phase browser run (`mode:pipeline`).
- **`ce-compound`**: the Compound phase solution docs (`mode:headless`).
- **`ce-commit-push-pr`**: the Ship phase commit/push/PR mechanics.
- The compound-engineering **reviewer family** (`ce-correctness-reviewer`, `ce-maintainability-reviewer`, `ce-testing-reviewer`, `ce-project-standards-reviewer`, `ce-security-reviewer`, `ce-data-migration-reviewer`, `ce-api-contract-reviewer`, `ce-adversarial-reviewer`): the Quality persona reviewers, reached via `agentType`.

The four `skillGuide()` skill call sites (`ce-simplify-code`, `ce-test-browser`, `ce-compound`, `ce-commit-push-pr`) each supply an inline fallback, so those phases still run in degraded form when the plugin is not installed; recon's `ceSkillsRoot` and `agentBrowserAvailable` flags decide which path is taken, and skill paths resolve from the highest installed plugin version under the session's plugin cache. The Quality **reviewer family** (reached via `agentType`) is the exception: it has no inline fallback and no `ceSkillsRoot` guard today, so without the plugin the Quality phase loses its structured persona-review roster. That hard coupling, and the plan to make the product plugin-independent, is tracked in [#26](https://github.com/vadimcomanescu/shepherd/issues/26).
