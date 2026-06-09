# Nadia — Dynamic Workflows: Reference & Harness

A reference for building **dynamic workflows** in Claude Code — JavaScript coordinator scripts that orchestrate many subagents at scale, in the background, while the main session stays responsive — and a working harness built on those rules: a deterministic pipeline that takes an approved plan and executes it end-to-end, through to a PR.

The defining principle: **the plan moves into code, not the model's context.** The script holds the loop, the branching, and the intermediate results; the session's context holds only the final answer.

## Start here

Read [`docs/workflows/README.md`](docs/workflows/README.md) first — it covers the philosophy, the eight core principles, and how the rest of the docs fit together.

| Doc | What it covers |
|-----|----------------|
| [`docs/workflows/README.md`](docs/workflows/README.md) | Overview, philosophy, the eight core principles, and the index |
| [`docs/workflows/coordinator.md`](docs/workflows/coordinator.md) | The coordinator contract: what the script body may and may not do, the `meta` export, forbidden APIs, and the three banned JS forms (`Date.now()`, `Math.random()`, `new Date()`) |
| [`docs/workflows/primitives.md`](docs/workflows/primitives.md) | API reference: `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, `budget`, `args` |
| [`docs/workflows/constraints.md`](docs/workflows/constraints.md) | Hard limits: concurrency cap, 1000-agent lifetime ceiling, 4096-item pipeline/parallel cap, one-level nesting, and the execution model |
| [`docs/workflows/patterns.md`](docs/workflows/patterns.md) | Canonical shapes: classify-and-act, fan-out-and-synthesize, adversarial verification, tournament, loop-until-done, multi-modal sweep, completeness critic |

## What's in this repo

| Path | What it is |
|------|------------|
| [`docs/workflows/`](docs/workflows/) | The canonical authoring rules above — every workflow here is written against these docs, never from memory |
| [`workflows/`](workflows/) | Coordinator scripts and their tests. [`ce-work-deterministic.js`](workflows/ce-work-deterministic.js) is the repo's own workflow: parse a plan document, split it into context-window-sized tasks, route each task to Codex or Claude, execute TDD in isolated worktrees, merge in dependency waves, review with adversarially verified fixes, validate, ship a PR, and watch CI with a bounded fix loop |
| [`agents/`](agents/) | Subagent persona definitions the workflows dispatch (`task-splitter`, `executor-router`, `unit-executor`, `codex-runner`, `codex-reviewer`, `skeptical-refuter`, `ci-watcher`), symlinked into `.claude/agents` |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary: the vocabulary for dynamic workflows and the ce-work-deterministic pipeline |
| [`STRATEGY.md`](STRATEGY.md) | Product direction: target problem, approach, metrics, and tracks |
| [`AGENTS.md`](AGENTS.md) | Agent-facing rules for working in this repo |
| [`docs/agents/`](docs/agents/) | Conventions for agents: issue tracker, triage labels, and domain docs |

## Sources

- [Official docs — Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Blog — A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog — Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Managed Agents SDK](https://platform.claude.com/docs/en/managed-agents/overview)
