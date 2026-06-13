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

## Using it

Both coordinators are invoked by name (their `meta.name`) with an `args` object. See each script's `meta.whenToUse` for the full contract.

```
1. Plan.   Invoke shepherd-plan with a request, or an origin brainstorm/requirements doc:

      args: { request: "add a dark-mode toggle to settings", commit: true }

   It runs the 7-phase pipeline and writes a plan to docs/plans/, then returns a run
   summary { planPath, planVersion, nextStep } (or a directPrompt to run directly if it
   halts early on a trivial request).  (commit: true is the consent to commit the file.)

2. Deliver.  Hand that plan to shepherd-deliver:

      args: { plan: "docs/plans/2026-06-13-001-feat-dark-mode-toggle-plan.md", planVersion: "<hash>", ship: true }

   It runs the 12-phase pipeline (split, route, execute, review, validate, ship) and opens
   the pull request.  Pass planVersion (from the plan summary) so a resumed run never replays
   a stale parse of an edited plan; ship: true is the consent to push and open the PR.
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
| [`agents/`](agents/) | The 22-persona fleet (`agents/<name>.md` files dispatched by `agentType`): 14 plan-side personas (5 researchers including `flow-analyzer`, 2 authors, 7 review lenses) and 8 deliver-and-shared personas. Catalog: [`docs/practice/fleet.md`](docs/practice/fleet.md). Symlinked into `.claude/agents`. |
| [`skills/`](skills/) | The 6 doctrine skills (the plan author and editor read five of them before acting): `decomposition`, `interface-design`, `scoping`, `test-strategy`, `validating-agent-improvements`, `zero-context-planning`. Symlinked into `.claude/skills`. |
| [`docs/practice/`](docs/practice/) | The practice docs: the [hub](docs/practice/README.md) plus deep dives on both pipelines, the [fleet](docs/practice/fleet.md), [routing](docs/practice/routing.md), and the [verification doctrine](docs/practice/verification.md). |
| [`docs/workflows/`](docs/workflows/) | The dynamic-workflow substrate: the authoring rules every coordinator here is written against, never from memory. |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary: the vocabulary for the practice and the substrate. |
| [`STRATEGY.md`](STRATEGY.md) | Product direction: target problem, approach, metrics, tracks. |

Two boundaries worth stating up front:

- **Inline-prompt agents are not personas.** Many steps (intake, strategy-gate, releasability, origin-coverage, and hygiene in plan; simplify, integration merges, and the audit and gate-recheck agents in deliver) are dispatched with a label and a schema only, no persona file. Only the 22 files in [`agents/`](agents/) are personas.
- **The `ce-*` skills are an external dependency, not files here.** Phases like Compound, Proof, and Ship lean on externally-installed compound-engineering skills (`ce-simplify-code`, `ce-test-browser`, `ce-compound`, `ce-commit-push-pr`, and a reviewer family). The 6 skills under [`skills/`](skills/) are this repo's own.

## Start here

1. **The practice.** Read [`docs/practice/README.md`](docs/practice/README.md) first. It covers the plan-then-deliver model, why it exists, the design pillars, and the doctrine skills, then routes you to the deep dives ([`plan.md`](docs/practice/plan.md), [`deliver.md`](docs/practice/deliver.md), [`fleet.md`](docs/practice/fleet.md), [`routing.md`](docs/practice/routing.md), [`verification.md`](docs/practice/verification.md)).
2. **The substrate.** Then read [`docs/workflows/README.md`](docs/workflows/README.md). It covers the coordinator contract, the primitives, the hard constraints, and the canonical patterns, the rules both coordinators are built against.

Invocation is by convention: `/shepherd-plan` and `/shepherd-deliver` come from each script's `meta.name`, and the scripts in [`workflows/`](workflows/) are whole-directory symlinked into `.claude/workflows/`.

A note on honesty: the metrics in [`STRATEGY.md`](STRATEGY.md) (escaped-defect rate, unattended completion rate, rework rate, cost per executed task) are aspirational. Nothing is instrumented yet; they are measured manually from run reports and git history.

## Sources

- [Official docs: Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Blog: A harness for every task, dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Managed Agents SDK](https://platform.claude.com/docs/en/managed-agents/overview)
