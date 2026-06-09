# Dynamic Workflows — Reference

A focused reference for building **dynamic workflows** in Claude Code: JavaScript coordinator scripts that orchestrate many subagents at scale, in the background, while the main session stays responsive.

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

Agent-facing rules live in [`AGENTS.md`](AGENTS.md).

## Sources

- [Official docs — Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Blog — A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
