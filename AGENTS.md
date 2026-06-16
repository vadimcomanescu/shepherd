# Agent Instructions

Shepherd is a repeatable **plan -> deliver** engineering practice, implemented as two dynamic-workflow coordinators: [`workflows/shepherd-plan.js`](workflows/shepherd-plan.js) produces a plan document, and [`workflows/shepherd-deliver.js`](workflows/shepherd-deliver.js) drives that plan to a pull request. The dynamic-workflow rules below are the **load-bearing** substrate that practice is built on; every agent working here must follow them without exception.

---

## Dynamic Workflows (READ FIRST)

Before authoring, editing, running, or reviewing **ANY** dynamic workflow in this repo, you **MUST** read [`docs/workflows/README.md`](docs/workflows/README.md) and follow its principles without exception.

### NON-NEGOTIABLE PRINCIPLES

1. **The coordinator does NO I/O.** The workflow script body (coordinator) may not read or write files, run shell commands, invoke git, or make network calls. Every real-world action (reading code, editing files, running tests, git operations, web requests) is performed by agents. If you want the script to read a file, that work belongs to an agent.

2. **`pipeline()` by default; `parallel()` only when a stage genuinely needs ALL prior results.** `pipeline()` is the correct default for multi-stage work (wall-clock equals the slowest single-item chain, not the sum). Reach for a `parallel()` barrier only when a stage needs the full prior-stage result set together (e.g. dedup across the full set, early-exit when count is zero, or cross-referencing other results). "I need to flatten or map first" is not a barrier reason.

3. **Move intermediate state out of context.** Aggregation lives in script variables, not in an agent's context. Do not ask an agent to accumulate results across turns. The coordinator's variables are the accumulator.

4. **Ground every context-less agent.** Each agent gets a fresh context window and cannot see the coordinator's variables or other agents' work. Pass every agent exactly the data, file paths, and authoritative facts it needs in its prompt.

5. **Verify adversarially; default to "fail if uncertain".** For findings that must be trusted, spawn independent verifier agents prompted to REFUTE. Require a majority. If uncertain, fail, do not silently pass. One carved-out exception: code-review findings are graded by the recall-biased finding-verifier persona (uncertain lands on PLAUSIBLE, never REFUTED) because dropping a real defect costs more than keeping an uncertain one; the mitigation is verdict-conditional fixing. PLAUSIBLE findings may only receive local, behavior-preserving fixes.

6. **No silent caps.** If the workflow bounds coverage (top-N, sampling, no-retry), call `log()` to surface what was dropped. Silent truncation is a bug.

7. **Bounded loops only.** Any loop-until-done or loop-until-dry must have a real stop condition. Guard budget loops on `budget.total`; otherwise `remaining()` is `Infinity` and the loop runs to the agent cap.

8. **Model policy.** Default to omitting `model` (inherit the session model). For grunt work (search, fetch, extraction, mechanical authoring, routine verification) use `model: "sonnet"`. Reserve `model: "opus"` for steps that genuinely require top-tier reasoning. Documented exception (executor-agnostic plan-side fleet refactor): `workflows/shepherd-plan.js` deliberately pins `model: 'opus'` for its five highest-stakes judgment roles (`plan-author`, `plan-editor`, `intake-classifier`, `strategy-gate`, `skeptical-refuter`) because it is an autonomous pipeline that ships a plan with no human review between agents (inherit-the-session-model is correct for self-paced interactive work, not here), and pins `model: 'sonnet'` for all mechanical roles (the five researchers `repo-researcher`/`learnings-researcher`/`web-researcher`/`external-grounding-researcher`/`flow-analyzer`, `persona-classifier`, `cross-plan-scanner`, `plan-fixer`, `plan-checker`, `plan-parser`, `spike-investigator`, `releasability-checker`, `origin-coverage-auditor`, `committer`, `hygiene-checker`, and the `codex-executor` operator dispatch).

### Workflow Docs in This Repo

| Doc | Description |
|-----|-------------|
| [`docs/workflows/README.md`](docs/workflows/README.md) | Entry point: overview, philosophy, and how to navigate the other docs |
| [`docs/workflows/coordinator.md`](docs/workflows/coordinator.md) | The coordinator contract: what the script body may and may not do, the `meta` export, forbidden APIs, and the three banned JS forms (`Date.now()`, `Math.random()`, `new Date()`) |
| [`docs/workflows/primitives.md`](docs/workflows/primitives.md) | API reference: `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, `budget`, `args` |
| [`docs/workflows/constraints.md`](docs/workflows/constraints.md) | Hard limits: concurrency cap, 1000-agent lifetime ceiling, 4096-item pipeline/parallel cap, one-level nesting |
| [`docs/workflows/patterns.md`](docs/workflows/patterns.md) | Canonical shapes: classify-and-act, fan-out-and-synthesize, adversarial verification, generate-and-filter, tournament, loop-until-done, multi-modal sweep, completeness critic |

### Cloud Guides

- **Official docs:** https://code.claude.com/docs/en/workflows
- **Primary blog:** https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code ("A harness for every task: dynamic workflows in Claude Code")
- **Intro blog:** https://claude.com/blog/introducing-dynamic-workflows-in-claude-code (introductory announcement)
- **Managed Agents SDK** (headless/standalone context): https://platform.claude.com/docs/en/managed-agents/overview

---

## Agent skills

### Issue tracker

GitHub Issues on `vadimcomanescu/shepherd`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` (when ADRs exist) at the repo root. See `docs/agents/domain.md`.

---

## Repo Context

This repository contains the dynamic-workflow rules under [`docs/workflows/`](docs/workflows/), subagent persona definitions under [`agents/`](agents/) (symlinked into `.claude/agents`), coordinator scripts and their tests under [`workflows/`](workflows/), agent skills under [`skills/`](skills/) (symlinked into `.claude/skills`), and the domain glossary in [`CONTEXT.md`](CONTEXT.md). The plan -> deliver practice itself is documented under [`docs/practice/`](docs/practice/): [`docs/practice/README.md`](docs/practice/README.md) is the hub, with deep dives for plan ([`plan.md`](docs/practice/plan.md)), deliver ([`deliver.md`](docs/practice/deliver.md)), the agent fleet ([`fleet.md`](docs/practice/fleet.md)), executor and model routing ([`routing.md`](docs/practice/routing.md)), and the verification doctrine ([`verification.md`](docs/practice/verification.md)). This repo's deliberate convention is top-level component directories with whole-directory symlinks into `.claude/` (a documented exception to the global `.agents/skills/` per-skill-symlink rule). Product direction lives in [`STRATEGY.md`](STRATEGY.md). Documented solutions to past problems live under [`docs/solutions/`](docs/solutions/) (bugs, patterns, best practices), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`), relevant when implementing or debugging in documented areas. The principles above are not advisory; they are structural requirements for any workflow you author. Violating coordinator I/O rules, using unbounded loops, or skipping adversarial verification can silently corrupt results or cause runaway agent usage. Read the docs before writing any workflow.
