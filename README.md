# Shepherd

> **Plan, then deliver, as one repeatable engineering practice.** One dynamic-workflow coordinator turns a request into a committed, reviewed plan; a second drives that plan to a pull request. The plan moves into code, not the model's context.

Shepherd is built as two deterministic JavaScript coordinators. Each holds the loop, the branching, and the intermediate results; every real action (reading code, editing files, running tests, opening a PR) is performed by a fresh-context agent the script dispatches. `shepherd-plan` produces the plan. `shepherd-deliver` executes it. Dynamic workflows are the substrate Shepherd is built on, not the headline.

```
  request / brainstorm  ──[ shepherd-plan · 7 phases ]──▶  committed plan document
                                                                    │
                                  manual handoff: an operator passes the plan forward
                                  (planPath + planVersion) into a separate invocation
                                                                    │
                                                                    ▼
  committed plan document  ──[ shepherd-deliver · 12 phases ]──▶  pull request
```

The handoff is deliberate, not automatic. `shepherd-plan` does not call `shepherd-deliver`. It returns a structured run summary, and a person (or an outer tool) hands that summary forward.

## Install

Shepherd is distributed as a Claude Code **plugin**. One install brings four things into any repo: the `/shepherd-pd` skill (the entry point), the agent fleet the coordinators dispatch, the doctrine skills the plan author reads, and the two coordinator scripts themselves. Dynamic workflows cannot be declared in a plugin manifest, so the coordinators travel *inside* the skill — the skill is how the practice ships.

**Persistent install** — registers the marketplace, then installs the plugin for future sessions:

```bash
claude plugin marketplace add vadimcomanescu/shepherd
claude plugin install shepherd@shepherd
```

**Session-scoped** — no marketplace; loads a local clone for the current session only:

```bash
claude --plugin-dir /path/to/shepherd      # a local checkout of this repo
```

The entry point is the **`/shepherd:shepherd-pd`** skill (just `/shepherd-pd` when run from a checkout of this repo). It has three modes:

| Mode | Argument | Result |
|------|----------|--------|
| `plan` | a request, or a path to a brainstorm/requirements doc | a committed plan document |
| `deliver` | a path to a committed plan | a pull request |
| `plan-deliver` | a request | both, with the handoff automated — it stops if the plan halts rather than delivering nothing |

The skill is a thin, deliberate front door: it routes to the coordinators below and, for `plan-deliver`, performs the same `planPath + planVersion` handoff a human would. Anything it does, you can also do by invoking the coordinators directly.

## Using it

The `/shepherd-pd` skill above is the front door. To drive the coordinators directly, invoke each by name (its `meta.name`) with an `args` object; see each script's `meta.whenToUse` for the full contract.

```
1. Plan.   Invoke shepherd-plan with a request, or an origin brainstorm/requirements doc:

      args: { request: "add a dark-mode toggle to settings", commit: true }

   It runs the 7-phase pipeline and writes a plan to docs/plans/, then returns a run
   summary { planPath, planVersion, nextStep } (or a directPrompt to run directly if it
   halts early on a trivial request).  (commit: true is the consent to commit the file.)

2. Deliver.  Hand that plan to shepherd-deliver:

      args: { plan: "docs/plans/2026-06-13-001-feat-dark-mode-toggle-plan.md", planVersion: "<hash>", ship: true }

   It runs the 12-phase pipeline (split, route, execute, review, validate, ship) and opens
   the pull request.  planVersion is the plan's current content hash: re-derive it after any
   edit to the plan so a resumed run never replays a stale parse; ship: true is the consent to push.
```

Nothing self-reported is trusted along the way: findings are verified by independent agents prompted to refute them, and anything unresolved is written into the PR as a durable residual rather than dropped. See [`docs/practice/verification.md`](docs/practice/verification.md).

## Why

Agents that author dynamic workflows from memory violate the load-bearing rules (coordinator I/O, barriers, unbounded loops) and silently corrupt results or trigger runaway agent usage. Model-driven execution of a plan drifts: it is not repeatable, not resumable, and not honestly verified. Shepherd moves the plan into a deterministic coordinator (split, route, execute in worktrees, adversarially verify), authored against the canonical workflow docs rather than from memory. The script is the source of truth for control flow; the session's context holds only the final answer. (See [`STRATEGY.md`](STRATEGY.md).)

## The two pipelines at a glance

Each clause below is one phase from the coordinator's `meta.phases`. The deep dives carry the mechanism.

**`shepherd-plan` (7 phases)** turns a request or origin doc into a committed plan document. Deep dive: [`docs/practice/plan.md`](docs/practice/plan.md).

| Phase | What it does |
|-------|--------------|
| Intake | Lock Confirmed Intent, classify unknowns, set the depth tier |
| Research | Repo plus learnings plus conditional external research, cross-plan scan |
| Gate | Strategy and scope challenge before drafting |
| Draft | Author the plan document, classify review personas, extract key technical decisions |
| Review | Bounded editor loop: personas, refuters, verified fixes, spikes |
| Gates | Parse conformance, releasability, origin coverage, cross-plan overlap |
| Finalize | Hygiene check, optional commit, machine-readable run summary |

**`shepherd-deliver` (12 phases)** drives a plan document to a pull request. Deep dive: [`docs/practice/deliver.md`](docs/practice/deliver.md).

| Phase | What it does |
|-------|--------------|
| Recon | Parse the plan, probe the repo and Codex availability |
| Setup | Create the integration worktree and branch |
| Split | Split plan units into one-context-window tasks |
| Route | Assign Codex or Claude, and a model tier, per task |
| Execute | Run tasks test-first in isolated worktrees, wave by wave |
| Integrate | Merge task branches in dependency order, test, simplify as you go |
| Quality | Persona plus second-model review, verified fixes, fix audit |
| Validate | Requirements trace, full suite, lint, ship-gate recheck |
| Proof | Browser-test affected routes, one fix round |
| Compound | Document solved problems from the run |
| Ship | Commit, push, open the PR with evidence and residuals |
| CI | Watch checks, bounded auto-fix loop |

## What's in this repo

| Path | What it is |
|------|------------|
| [`workflows/`](workflows/) | The two coordinator scripts ([`shepherd-plan.js`](workflows/shepherd-plan.js), [`shepherd-deliver.js`](workflows/shepherd-deliver.js)) and their tests. This is the practice, expressed as dynamic workflows. |
| [`agents/`](agents/) | The 41-persona fleet (`agents/<name>.md` files dispatched by `agentType`): 27 plan-side personas (5 research, 2 authoring, 7 review lenses, 12 role-extracted gate/loop agents, 1 Codex executor) and 14 deliver/shared (3 delivery, 2 verifiers, 1 CI, and the 8-persona code-review fleet `agents/*-reviewer.md`). Catalog: [`docs/practice/fleet.md`](docs/practice/fleet.md). Symlinked into `.claude/agents`. |
| [`skills/`](skills/) | The [`shepherd-pd`](skills/shepherd-pd/) entry-point skill (routes to the two coordinators; carries them as bundled files for packaging) plus the 6 doctrine skills the plan author and editor read before acting: `decomposition`, `interface-design`, `scoping`, `test-strategy`, `validating-agent-improvements`, `zero-context-planning`. Symlinked into `.claude/skills`. |
| [`docs/practice/`](docs/practice/) | The practice docs: the [hub](docs/practice/README.md) plus deep dives on both pipelines, the [fleet](docs/practice/fleet.md), [routing](docs/practice/routing.md), and the [verification doctrine](docs/practice/verification.md). |
| [`docs/workflows/`](docs/workflows/) | The dynamic-workflow substrate: the authoring rules every coordinator here is written against, never from memory. |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary: the vocabulary for the practice and the substrate. |
| [`STRATEGY.md`](STRATEGY.md) | Product direction: target problem, approach, metrics, tracks. |
| [`.claude-plugin/`](.claude-plugin/) | The plugin manifest (`plugin.json`) and the single-plugin marketplace (`marketplace.json`) that make the repo installable. See [Install](#install). |

Two boundaries worth stating up front:

- **Inline-prompt agents are not personas.** On the plan side every dispatch now carries an `agentType` backed by a file in [`agents/`](agents/) — there are no inline-prompt agents left there. The deliver coordinator deliberately keeps some (repo-recon, integration merges, the diffstat and sweep, per-file fixes, ship-verify): a label and a schema only, no `agentType` and no file. The files in [`agents/`](agents/) are the personas; an inline-prompt agent is any dispatch with no `agents/<name>.md` behind it.
- **Shepherd is self-contained — no other plugin required.** The deliver Quality phase reviews with Shepherd's own code-review fleet (`agents/*-reviewer.md`), and the tail phases (simplify-as-you-go, browser-proof, compound, commit/push/PR) carry their doctrine inline in the coordinator. Shepherd installs and runs standalone with zero dependency on any external plugin.

## Start here

1. **The practice.** Read [`docs/practice/README.md`](docs/practice/README.md) first. It covers the plan-then-deliver model, why it exists, the design pillars, and the doctrine skills, then routes you to the deep dives ([`plan.md`](docs/practice/plan.md), [`deliver.md`](docs/practice/deliver.md), [`fleet.md`](docs/practice/fleet.md), [`routing.md`](docs/practice/routing.md), [`verification.md`](docs/practice/verification.md)).
2. **The substrate.** Then read [`docs/workflows/README.md`](docs/workflows/README.md). It covers the coordinator contract, the primitives, the hard constraints, and the canonical patterns, the rules both coordinators are built against.

Invocation: the [`/shepherd-pd`](skills/shepherd-pd/) skill is the front door and dispatches both coordinators (it is namespaced `/shepherd:shepherd-pd` on a fresh plugin install). The coordinators' own names `/shepherd-plan` and `/shepherd-deliver` come from each script's `meta.name`, and the scripts in [`workflows/`](workflows/) are whole-directory symlinked into `.claude/workflows/` — and into the skill, so they ride inside the plugin.

A note on honesty: the metrics in [`STRATEGY.md`](STRATEGY.md) (escaped-defect rate, unattended completion rate, rework rate, cost per executed task) are aspirational. Nothing is instrumented yet; they are measured manually from run reports and git history.

## Sources

- [Official docs: Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Blog: A harness for every task, dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Managed Agents SDK](https://platform.claude.com/docs/en/managed-agents/overview)
