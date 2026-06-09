---
name: nadia
last_updated: 2026-06-09
---

# nadia Strategy

## Target problem

Agents authoring dynamic workflows from memory violate the load-bearing rules (coordinator I/O, barriers, unbounded loops), silently corrupting results or causing runaway agent usage — and model-driven execution of a plan drifts: it isn't repeatable, resumable, or honestly verified.

## Our approach

Nadia is the implementation of plan execution in practice: an approved plan moves into a deterministic coordinator script (split → route → execute in worktrees → adversarially verify), authored against the canonical workflow docs rather than from memory.

## Who it's for

**Primary:** Vadim (and any engineer with this setup) — hiring nadia to take an approved plan and get it implemented end-to-end — split, routed, executed in worktrees, adversarially verified — without babysitting the model.

## Key metrics

Nothing instrumented yet; measured manually from run reports and git history.

- **Escaped-defect rate** — bugs found after a run reported "completed"; measures whether adversarial verification is honest.
- **Unattended completion rate** — % of plan tasks finished "completed" with passing tests and no mid-run human intervention.
- **Rework rate** — % of dossiers a human has to redo or significantly fix.
- **Cost per executed task** — tokens/wall-clock per completed dossier; whether executor routing (Codex vs Claude, sonnet vs opus) earns its keep.

## Tracks

### Execution harness

ce-work-deterministic: plan splitting into dossiers, executor routing (Codex vs Claude), isolated worktree execution.

_Why it serves the approach:_ this is the plan-in-code harness itself.

### Verification & honesty

Adversarial refutation, test discipline, honest status reporting.

_Why it serves the approach:_ unattended execution is only safe if completion claims can be trusted.

### Reference docs

Keep docs/workflows/ canonical and in sync with actual runtime behavior.

_Why it serves the approach:_ workflows are authored against the docs, never from memory — stale docs reintroduce the original problem.
