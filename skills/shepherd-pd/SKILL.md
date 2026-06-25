---
name: shepherd-pd
description: Run the Shepherd plan -> deliver practice from one entry point. Invoke for "/shepherd-pd plan <request>", "/shepherd-pd deliver <plan-path>", or "/shepherd-pd plan-deliver <request>" to produce a Shepherd plan document, drive a committed plan to a pull request, or do both in sequence with the handoff automated.
argument-hint: "[plan|deliver|plan-deliver] <request | plan-path> [flags…]"
disable-model-invocation: true
allowed-tools: Workflow, Read, Bash
---

# Shepherd

Shepherd is a repeatable **plan -> deliver** engineering practice built on two
dynamic-workflow coordinators. This skill is the single entry point: it routes
your request to the right coordinator and, for the combined mode, performs the
deliberate plan -> deliver handoff for you.

Calling the `Workflow` tool from this skill is the explicit opt-in to multi-agent
orchestration — that is the whole point of invoking `/shepherd-pd`. Run the
coordinator named for the mode; do not reimplement its logic inline.

## Bundled coordinator scripts + namespace resolution

The coordinators, the agent fleet they dispatch, and the doctrine skills the plan
author reads all ship inside this plugin. Resolve their install root and Shepherd's
agent namespace **once, here**, and feed both into every `Workflow` call below.
When Shepherd runs as an installed plugin (marketplace or `--plugin-dir`),
`CLAUDE_PLUGIN_ROOT` points at the install root and the agents resolve under the
`shepherd:` namespace; in a plain checkout of this repo it is unset and the agents
are bare-named. The coordinators default to bare/relative, so the values below are
what makes a plugin install actually dispatch its own fleet.

Run this once and reuse its output (it prints `shepherdRoot`, `agentNamespace`, and
the two coordinator paths; if either path is missing, stop and report it). It resolves
the root in three ordered ways so it works in every harness: (1) `CLAUDE_PLUGIN_ROOT`
when the harness exports it into the skill shell; (2) the current checkout when you are
developing the Shepherd source repo itself (working tree wins over any installed copy);
(3) the latest installed plugin cache — so it still resolves even when the harness does
not export `CLAUDE_PLUGIN_ROOT`. This whole line needs `Bash` in `allowed-tools` (above)
— a narrower allowlist blocks it and the skill silently fails to locate the plugin:
!`ROOT=""; NS=""; if [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -f "$CLAUDE_PLUGIN_ROOT/workflows/shepherd-plan.js" ]; then ROOT="$CLAUDE_PLUGIN_ROOT"; NS="shepherd"; fi; if [ -z "$ROOT" ]; then D="${CLAUDE_PROJECT_DIR:-$PWD}"; if [ -f "$D/workflows/shepherd-plan.js" ] && [ -f "$D/.claude-plugin/plugin.json" ]; then ROOT="$D"; NS=""; fi; fi; if [ -z "$ROOT" ]; then c=$(ls -d "$HOME"/.claude/plugins/cache/shepherd/shepherd/*/ 2>/dev/null | sort -V | tail -1); c="${c%/}"; if [ -n "$c" ] && [ -f "$c/workflows/shepherd-plan.js" ]; then ROOT="$c"; NS="shepherd"; fi; fi; if [ -n "$NS" ] && [ -f "$ROOT/.claude-plugin/plugin.json" ]; then N=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/.claude-plugin/plugin.json" | head -1); [ -n "$N" ] && NS="$N"; fi; printf 'shepherdRoot=%s\nagentNamespace=%s\n' "$ROOT" "$NS"; ls -1 "$ROOT/workflows/shepherd-plan.js" "$ROOT/workflows/shepherd-deliver.js" 2>&1`

From that output:

- Pass the printed `shepherd-plan.js` / `shepherd-deliver.js` path as the `Workflow`
  tool's `scriptPath`. Do **not** pass `name:` — name-resolution breaks once installed.
- Pass `shepherdRoot` and `agentNamespace` (verbatim; `agentNamespace` may be empty)
  in the `Workflow` `args` for **both** coordinators. They tell the coordinator how to
  reach Shepherd's own agent fleet (`shepherd:`-namespaced when installed) and doctrine
  files (under `shepherdRoot`) from inside any repo. Omitting them breaks every agent
  dispatch when Shepherd runs as an installed plugin.

## Step 1 — Pick the mode

Read the first token of `$ARGUMENTS`:

- `plan` — produce a plan document, then stop.
- `deliver` — drive an existing committed plan to a pull request.
- `plan-deliver` (aliases `both`, `plan+deliver`, `pd`) — plan, then automatically deliver.

If no mode keyword is present, infer:

- The payload is a path to an existing `.md` file under `docs/plans/` -> `deliver`.
- Otherwise (a natural-language request, or a path to a brainstorm/requirements doc) -> `plan`.

Never infer `plan-deliver`: the deliver leg opens a pull request, so the combined
run is opt-in only. The user must type the keyword.

Everything after the mode keyword is the **payload** (a request, an origin-doc
path, or a plan path). Trailing words like `ship`/`no-ship`, `commit`, `deep`,
`no-codex`, `no-proof` are flags — extract them, then map per the mode below.

## Step 2 — Run the mode

### plan

`request` vs `origin`: if the payload is a path to an existing doc (a brainstorm
or requirements file), pass it as `origin`; otherwise pass it as `request`. When
you pass `origin`, also pass `originVersion` = `git hash-object <origin-path>` (a
Bash call). The coordinator keys its resume cache on `originVersion`, so without
it a re-run after the origin doc is edited replays stale cached research.

```
Workflow({
  scriptPath: "<shepherd-plan.js path printed above>",
  args: {
    shepherdRoot: "<shepherdRoot printed above>",
    agentNamespace: "<agentNamespace printed above — may be empty>",
    request: "<payload, when it is a request>",
    // OR origin: "<payload, when it is a doc path>",
    //    with origin, also: originVersion: "<git hash-object of the origin doc>"
    commit: <true only if the user said "commit"; else omit>,
    depth: "<lightweight|standard|deep, only if the user pinned one>",
    // pass through only flags the user actually named:
    // spikes, externalResearch, tokenBudget, editorRounds, reviewRounds
  }
})
```

Report the returned summary verbatim in plain terms: `status`, `planPath`,
`planVersion`, `unitCount`, and the `nextStep`. If `directPrompt` is non-empty,
the request was below the planning floor — surface the `directPrompt` and say it
can be executed directly without a plan. If `haltStage` is non-null, the run
halted — surface `haltReason` and `nextStep`; do not pretend a plan exists.

### deliver

The payload is the plan path. Deliver requires the plan **committed** — verify it
before dispatching. Do not rely on the coordinator to catch this: its only
cleanliness check is `git diff --quiet HEAD`, which ignores untracked files, and
`git hash-object` produces a hash for any working-tree file whether committed or
not. Run both checks (Bash calls):

1. `git cat-file -e HEAD:<plan-path>` — the plan must exist in `HEAD`. If it
   fails, **stop**: the plan is uncommitted. Tell the user to
   `git add <plan-path> && git commit` it, then re-run.
2. `git hash-object <plan-path>` must equal `git rev-parse HEAD:<plan-path>` — the
   committed blob must match the working copy. If they differ, **stop**: the plan
   has uncommitted edits; tell the user to commit them first.

Use that `git hash-object` value as `planVersion` unless the user supplied one.

```
Workflow({
  scriptPath: "<shepherd-deliver.js path printed above>",
  args: {
    shepherdRoot: "<shepherdRoot printed above>",
    agentNamespace: "<agentNamespace printed above — may be empty>",
    plan: "<plan path>",
    planVersion: "<git hash-object of the plan file>",
    ship: <false if the user said "no-ship"/"local"; otherwise true>,
    // pass through only flags the user actually named:
    // codex, proof, compound, base, slug, sandbox, ciRounds, effortFloor
  }
})
```

`ship: true` opens a pull request — that is deliver's purpose and invoking it is
the consent. Before dispatching, state in one line that this will push a branch
and open a PR (unless `no-ship`). Report the returned result: PR URL, CI status,
and any residuals.

### plan-deliver

Run the **plan** coordinator first, with `commit: true` (the committed plan is
what deliver consumes). Use the same `request`/`origin` rule as `plan` mode.

Then branch on the plan summary — do not blindly deliver:

- `directPrompt` non-empty -> **stop**. The request was below the planning floor;
  surface the `directPrompt` and say it can be executed directly. No deliver.
- `haltStage` non-null -> **stop**. Surface `haltReason` + `nextStep`. No deliver.
- `status === 'ready'` and `committed === true` and `planPath` set -> **proceed**.
  - If `planVersion` is null (hygiene gate failed), re-derive it with
    `git hash-object <planPath>` before delivering.
- `status === 'ready'` but `committed !== true` -> **stop**. The plan file exists
  but is uncommitted; surface the manual commit-then-deliver `nextStep`. Do not
  auto-deliver an uncommitted plan.

When proceeding, run the **deliver** coordinator with
`{ plan: planPath, planVersion, ship, …deliver flags }` exactly as in `deliver`
mode. Honor `no-ship`/`local` to set `ship: false`. Report both legs: the plan
summary, then the deliver result.

## Reference

- Practice overview: `docs/practice/README.md`
- Plan deep dive: `docs/practice/plan.md` — full `shepherd-plan` args contract
- Deliver deep dive: `docs/practice/deliver.md` — full `shepherd-deliver` args contract
- Dynamic-workflow substrate: `docs/workflows/README.md`
