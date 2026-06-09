# CONTEXT.md — Domain Glossary

The vocabulary this repo uses when talking about dynamic workflows. Definitions here name the concept; the rules and full semantics live in [`docs/workflows/`](docs/workflows/README.md) — point there, don't restate.

## Core terms

- **Dynamic workflow** — a JavaScript script that orchestrates many subagents at scale, executed by a runtime in the background while the main session stays responsive. The plan moves into code, not the model's context.
- **Coordinator** — the workflow script body. Holds all control flow (loops, branching, accumulation) and does **no I/O**: no filesystem, shell, git, or network. Plain JavaScript, never TypeScript.
- **Agent** — a subagent spawned by `agent()`. Does all real-world work. Starts with a fresh, empty context window; it sees only what its prompt contains.
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

## ce-work-deterministic terms

The repo's own workflow ([`workflows/ce-work-deterministic.js`](workflows/ce-work-deterministic.js)) and its persona agents ([`agents/`](agents/)) add:

- **Dossier** — a fully self-contained task brief produced by the `task-splitter` agent: everything a `unit-executor` needs to implement one task in a single context window.
- **Unit executor** — the agent that implements one dossier inside an isolated git worktree, with test discipline and honest status reporting.
- **Executor routing** — the `executor-router` agent's judgment call: send a task to the Codex CLI (via `codex-runner`) or to a Claude executor, and pick the Codex reasoning-effort level.
- **Skeptical refuter** — the verifier persona: tries to refute a single finding against the actual code, defaulting to refuted when uncertain.
