# CONTEXT.md — Domain Glossary

The vocabulary this repo uses when talking about dynamic workflows. Definitions here name the concept; the rules and full semantics live in [`docs/workflows/`](docs/workflows/README.md) — point there, don't restate.

## Core terms

- **Dynamic workflow** — a JavaScript script that orchestrates many subagents at scale, executed by a runtime in the background while the main session stays responsive. The plan moves into code, not the model's context.
- **Coordinator** — the workflow script body. Holds all control flow (loops, branching, accumulation) and does **no I/O**: no filesystem, shell, git, or network. Plain JavaScript, never TypeScript.
- **Agent** — a subagent spawned by `agent()`. Does all real-world work. Starts with a fresh, empty context window; it sees only what its prompt contains. Distinct from the **AFK agent** of the triage vocabulary — an autonomous agent that owns a `ready-for-agent` issue end-to-end (see [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)). When both could be meant, qualify: "workflow agent" vs "AFK agent."
- **Grounding** — passing an agent every fact, path, and datum it needs inline in its prompt, because it cannot see coordinator variables or other agents' work.
- **`pipeline()`** — the default multi-stage primitive: each item flows through all stages independently, no barrier between stages.
- **Barrier** — the synchronization point a `parallel()` call creates: all tasks finish before the script continues. Justified only when a stage needs ALL prior-stage results together.
- **Phase** — a named progress group (`phase()` / the `phases` array in `meta`) shown in the workflow's progress display.
- **`meta` export** — the pure-literal object that must be the first statement of every coordinator script: `name`, `description`, optional `phases`.
- **Budget** — the turn's shared token target (`budget.total` / `spent()` / `remaining()`). `remaining()` is `Infinity` when no target is set, so budget loops must guard on `budget.total`.
- **Adversarial verification** — trusting a finding only after independent verifier agents prompted to REFUTE it fail to, by majority. Default to "fail if uncertain."
- **Silent cap** — bounding coverage (top-N, sampling, no-retry) without `log()`-ing what was dropped. Always a bug here.
- **Bounded loop** — any loop-until-done/loop-until-dry construct with a real stop condition (iteration cap, dry-round counter, budget guard).
- **Banned forms** — `Date.now()`, `Math.random()`, no-arg `new Date()`: they throw in coordinators because they would break deterministic resume.
- **Resume** — replaying a workflow run (`scriptPath` + `resumeFromRunId`); unchanged `agent()` calls return cached results, edited or new calls run live.
- **Grunt work** — search, fetch, extraction, mechanical authoring, routine verification. Runs on `model: "sonnet"`; the session model is the default; `opus` is reserved for genuine top-tier reasoning.

## shepherd-deliver terms

The repo's own workflow ([`workflows/shepherd-deliver.js`](workflows/shepherd-deliver.js)) and its persona agents ([`agents/`](agents/)) add:

- **Dossier** — a fully self-contained task brief produced by the `task-splitter` agent: everything a `unit-executor` needs to implement one task in a single context window.
- **Unit executor** — the agent that implements one dossier inside an isolated git worktree, TDD by default (red-green-refactor, watch the test fail first), with honest status reporting.
- **Executor routing** — the `executor-router` agent's judgment call: send a task to the Codex CLI (via `codex-runner`) or to a Claude executor, and pick the Codex reasoning-effort level.
- **Skeptical refuter** — the claim/premise verifier persona: tries to refute a single claim against the actual code or spec, defaulting to refuted when uncertain; review findings go to the finding verifier instead.
- **Finding verifier** — the recall-biased verifier persona for review findings: grades one finding on the verdict ladder, preferring to keep a real problem over dropping it. A deliberate variant of the skeptical refuter scoped to review findings only — terminally-trusted findings still default to fail when uncertain.
- **Verdict ladder** — the finding verifier's 3-state scale: CONFIRMED (concrete trigger named AND offending line quoted), PLAUSIBLE (the default for realistic-but-unproven findings; survives like CONFIRMED), REFUTED (refutation constructible from the code; the finding is dropped).
- **Proximity dedup** — the streaming pre-verification merge of review findings: as each reviewer completes, a finding naming the same defect as a kept one (same file, lines within 5, or matching normalized titles when line-less) is absorbed into the kept entry — severity escalates, personas merge, distinct wording is preserved — so a duplicate never consumes a verifier spawn.
- **Verify budget** — the cap on verifier spawns in the Quality phase: suggested-severity findings draw from a fixed slot pool; blocking findings bypass it under their own generous ceiling. Every cap drop is logged with the finding's identity, and a dropped entry later escalated to blocking by a duplicate gets its verifier late.
- **Sweep** — the Quality phase's gap-hunting pass after first-pass review: one agent, given the already-verified findings, hunts only what the first pass missed across the integration diff; skipped under 50 changed lines, capped at 8 candidates, and its candidates face the same dedup, budget, and verification path as reviewer findings.
- **Second-model review** — the `codex-reviewer` agent running the Codex CLI read-only over the integration diff; its findings face the same finding verifier as the Claude personas (cross-model both ways).
- **Simplify-as-you-go** — the mid-run simplification hook: after a wave that merged 2+ tasks, consolidate the integration branch (via the installed `ce-simplify-code` skill) before the next wave forks from it.
- **Ship gate** — the hard condition for the Ship phase: validation tests AND lint green, PLUS an independent fresh-context recheck of both commands at the ship boundary (the gate recheck); a contradiction or a dead recheck fails closed and the branch stays local. Invoking the workflow with ship enabled is the consent to push and open a PR.
- **Self-report audit** — the tail-phase enforcement pattern: an agent's claim about completed work (fixer "fixed" lists, ship "pushed"/PR state, compound "documented" paths) is checked by a separate fresh-context agent against observable state (commits, git/gh output, files on the branch). Unsupported claims demote to residuals or are corrected to the observed state; a dead auditor leaves a durable UNVERIFIED/UNAUDITED marker, never silent trust.
- **Residual** — a confirmed-but-unfixed finding, failed task, unmet requirement, or unresolved CI failure; made durable in the PR body (the autopilot contract: never silently dropped, never prompts).
- **Proof** — the browser-testing phase: an agent follows the installed `ce-test-browser` skill in pipeline mode against the merged worktree, with exactly one fix-and-retest round.
- **CI watcher** — the `ci-watcher` persona: one watch-fix-push iteration per dispatch of the bounded (default 3) CI autofix loop; never weakens or deletes tests to get green.
- **Compound step** — the pre-ship agent following the installed `ce-compound` skill headlessly: documents non-trivial solved-and-verified problems from the run under `docs/solutions/`. Runs before Ship so its docs commit rides the one push (a post-ship push would restart CI).

## shepherd-plan terms

The plan-production workflow ([`workflows/shepherd-plan.js`](workflows/shepherd-plan.js)) adds:

- **Intake** — the first-stage classifier agent in shepherd-plan: reads the raw request or origin document and outputs a structured JSON object (conforming to `INTAKE_SCHEMA`) that names the plan type, research intent, blocking unknowns, and non-code-deliverable flag. All downstream routing decisions derive from intake output.
- **Intake schema** — the JSON schema object (`INTAKE_SCHEMA` in `workflows/shepherd-plan.js`) that the intake classifier must conform to. It is also the canonical list of valid values for the `research.intent` enum; adding a new intent option to agent guidance without updating this schema leaves the option unreachable.
- **Origin coverage** — the gate-phase check that walks every section of the origin document (brainstorm, requirements doc, or ADR) and verifies that each normative item is addressed or explicitly deferred in the generated plan. A named phase in the shepherd-plan `meta.phases` array; skipped when no origin doc is provided.
