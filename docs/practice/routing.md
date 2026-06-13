# Routing: who builds each task, and on what model

Routing is how `shepherd-deliver` decides, for each split task, **who implements it** (the Codex CLI or a Claude executor) and **at what intensity** (a Codex reasoning-effort level or a Claude model tier). It is one persona's judgment, refined by a few coordinator-level overrides, calibrated by a measurement program. This page is the routing reference; for how tasks are produced and executed around routing see [`./deliver.md`](./deliver.md), and for the agents named here see [`./fleet.md`](./fleet.md).

Orientation in one line: the **executor-router** persona ([`agents/executor-router.md`](../../agents/executor-router.md)) reads each task's dossier plus its risk/ambiguity/size metadata and returns a four-field `ROUTE_SCHEMA` verdict; the coordinator then clamps, overrides, and executes that verdict.

---

## Two axes

Every task is routed along two independent axes, both decided per task by the executor-router (a pure-judgment persona: its tools are `Read, Grep, Glob`, it modifies nothing).

- **Axis 1, executor.** Codex CLI (`codex exec`, sandboxed) vs a Claude executor (the `unit-executor` persona). This is `ROUTE_SCHEMA.executor`, an enum of `codex | claude`.
- **Axis 2, sub-tier within the chosen executor.** For Codex, a reasoning-effort level (`ROUTE_SCHEMA.effort`). For Claude, a model tier (`ROUTE_SCHEMA.model`). The two sub-tiers are carried as separate fields; `effort` is ignored when the executor is `claude`.

The router always fills in **all four** schema fields including `model`, even for a Codex task. That is deliberate: the Claude tier doubles as the fallback/finisher tier when a Codex run fails or stalls (see [Recovery](#recovery-fallbacks-keep-the-routed-tier)).

```
task dossier + {risk, ambiguity, estDiffLines, files}
        |
        v
  executor-router  ->  ROUTE_SCHEMA { executor, effort, model, reason }
        |
        v
  coordinator overrides  (effort floor, codex-unavailable, circuit breaker)
        |
        v
  Execute  ->  codex-runner (codex)  |  unit-executor (claude, at ROUTE_SCHEMA.model)
```

---

## When Codex, when Claude

The router routes to **Codex** only when a task is a well-specified, mechanical implementation **and** its verification works without network access. Codex's sandbox has no network: no `npm install`, no Next.js builds that fetch Google Fonts. `tsc` / lint / unit-test verification is fine; anything that fetches or builds-from-network is not. The full Codex predicate from the persona:

- concrete file list, decided approach;
- ambiguity `none`, risk `trivial` / `low` / `medium`;
- self-contained verification that runs with no network.

It routes to **Claude** when **any** of these hold:

- ambiguity is `some` or `high` (implementation-time decisions remain);
- risk is `high`;
- the task needs repo archaeology beyond its dossier (mirroring conventions not quoted in it);
- it is UI work needing visual verification;
- verification needs network or a build;
- it must spawn nested subagents or harness tools.

Tie-breakers in the persona: when in doubt between executors, pick Claude. The router applies this rubric honestly even when told Codex is unavailable, because the coordinator (not the router) handles that override.

A note on the dogfood evidence: Codex never beat the cheapest correct Claude tier on *small* tasks (slower, never cheaper, two observed out-of-scope drive-bys in 2 of 4 Codex runs). Its one demonstrated niche is **mechanical pattern-clones with sandbox-safe verification, run in parallel waves** that absorb its ~4-5x wall time. See [How we know](#how-we-know-the-dogfood).

---

## Codex effort

`ROUTE_SCHEMA.effort` selects the Codex reasoning level. The coordinator passes it to `codex exec` via `-c 'model_reasoning_effort="..."'`, and only when the effective effort is not `default`. The live tiers the router actually emits:

| Effort | When | What it means |
|--------|------|---------------|
| `default` | Trivial work with no behavioral change (config tweak, rename, typo, docs). | No `-c model_reasoning_effort` flag is set. |
| `medium` | Small or mid-size, well-scoped behavioral changes. | The workhorse Codex effort. |
| `xhigh` | Genuinely cross-cutting multi-file work (refactors spanning a subsystem). | Expect ~4-5x Claude wall time; worth it only when waves run wide and wall-clock is not the constraint. |

**`high` is in the schema enum but inert.** `ROUTE_SCHEMA.effort` permits `default | medium | high | xhigh`, but the executor-router never emits `high`, and the dogfood measured that **high effort never beat medium** (f3 vs f1/f2; see the ledger). Treat the live effort tiers as `default` / `medium` / `xhigh`; `high` is schema-permitted-but-unused.

---

## Claude tier

`ROUTE_SCHEMA.model` selects the Claude size class. The driving signal is **ambiguity x size**, not the risk label (risk is handled separately, below).

| Tier | When | Note |
|------|------|------|
| `haiku` | Well-specified, small diff (<= ~3 files, <= ~150 lines), ambiguity `none`, risk at most `medium`. | Measured cheapest and fastest on this class. |
| `sonnet` | **The default everywhere else**: larger or multi-file dossiers, test-suite work, and **any** risk surface (auth/session, payments, migrations, data integrity, external API contracts). | |
| `opus` | Ambiguity `some` / `high`, open design / UX / API-shape decisions, unfamiliar-pattern work. | |

Two rules constrain this axis:

- **`fable` is forbidden for execution.** It is a planning-tier model only; it is not even in the `ROUTE_SCHEMA.model` enum. If a dossier truly seems to need fable, the persona's instruction is that the task is under-planned, and the router must say so in `reason` instead of escalating.
- **The router always picks a Claude tier, even for a Codex task.** `ROUTE_SCHEMA.model` is required on every verdict. For a Claude-executed task it is the executor's tier directly; for a Codex-executed task it is the tier the Claude executor inherits as the fallback (Codex failed) or finisher (Codex partial). It is the tier any recovery dispatch runs at.

---

## Risk escalates verification, not the model

A high-risk task does **not** automatically jump to a bigger model. The persona's instruction is explicit: when risk is high, state it in `reason` so the orchestrator pairs the executor with a **review pass**. The reason is measured: functional checks alone waved real security defects through. On the dogfood's auth task (f5), haiku and sonnet tied 7/7 on scripted functional checks, but a blind security review separated them 6.5 vs 4.0 (haiku shipped a length-leaking "constant-time" comparator; sonnet reached for `timingSafeEqual`). The mitigation is a deeper verification pass, not a more expensive executor. In practice this is why `shepherd-deliver` widens its Quality phase with a security reviewer when the plan's risk surfaces include auth/payments/crypto/public-api (see [`./verification.md`](./verification.md)).

So the two axes carry different jobs: **ambiguity x size set the tier; risk sets the verification depth.**

---

## ROUTE_SCHEMA

The router's machine-readable contract, defined in [`workflows/shepherd-deliver.js`](../../workflows/shepherd-deliver.js) as `ROUTE_SCHEMA`:

| Field | Type | Meaning |
|-------|------|---------|
| `executor` | enum `codex \| claude` | Axis 1: who implements the task. |
| `effort` | enum `default \| medium \| high \| xhigh` | Axis 2 (Codex): reasoning effort. Ignored when `executor` is `claude`. (`high` is permitted but never emitted.) |
| `model` | enum `haiku \| sonnet \| opus` | Axis 2 (Claude): model tier. Used by the Claude executor, and by fallback/finisher dispatches when Codex fails. |
| `reason` | string | The router's rationale (and where it flags high risk for the verification pass). |

All four fields are required. **If the router returns null** (the dispatch produced no verdict), the coordinator defaults that task to `{ executor: 'claude', effort: 'default', model: 'sonnet', reason: 'router failed — defaulted to claude/sonnet' }`. The safe default is the most general executor at the workhorse tier.

The routing dispatch itself runs on `model: 'sonnet'`: routing is mechanical (the output is a `ROUTE_SCHEMA` enum, not a design judgment), so the heavy thinking is in the rubric, not the dispatch.

---

## Coordinator overrides

The router's verdict is advisory in three places. The coordinator can clamp the effort up, force the executor to Claude, or trip Codex off entirely. These run after the router and before execution.

**Effort floor (clamp up).** An operator can set a minimum Codex effort via `args.effortFloor` or, failing that, `work_delegate_effort` in `.compound-engineering/config.local.yaml` at the repo root. The scale is `minimal < low < medium < high < xhigh`. The coordinator's `effectiveEffort(picked)` clamps the router's chosen effort up to that floor: it first normalizes `default` to `medium` (so a floor always lifts trivial work off `default`), then takes `max(pick, floor)`. With no floor configured, `effectiveEffort` returns the router's pick unchanged. The clamped value is what reaches the `-c model_reasoning_effort` flag.

**Codex unavailable (force to Claude).** Codex usability is computed once at recon time: `codexUsable = CODEX_ENABLED && codexAvailable && !insideCodexSandbox` (Codex must be enabled by args, installed on `PATH`, and the run must not itself be inside a Codex sandbox). When Codex is not usable, the coordinator rewrites **every** `executor: 'codex'` task to `executor: 'claude'` and appends `[codex unavailable — overridden]` to its `reason`. The router's Claude-tier pick is what those tasks then run at. The router is told up front that Codex is unavailable, but it still applies the rubric honestly and lets the coordinator do the rewrite.

**Circuit breaker (trip Codex off mid-run).** During execution the coordinator tracks a Codex failure streak. A Codex result that is `completed` resets the streak; any non-completed result (`partial` or `failed`) increments it. On the **3rd consecutive non-completed Codex result** the coordinator flips `codexBroken = true`, logs `Circuit breaker: 3 consecutive non-completed codex results — all remaining codex tasks route to claude`, and from then on the `useCodex` gate forces every remaining Codex-routed task to its Claude executor. This caps wasted effort when Codex is failing systematically (a broken sandbox, an unverifiable task class) rather than retrying it task after task.

### Recovery: fallbacks keep the routed tier

Routing also governs recovery, which is why `ROUTE_SCHEMA.model` is mandatory even on Codex tasks:

- **Codex `failed`** re-dispatches the task to a Claude `unit-executor` in a **fresh worktree** (after cleaning up whatever the dead runner left behind), at `t.route.model || 'sonnet'`.
- **Codex `partial`** or **Claude `partial`** dispatches a Claude `unit-executor` **finisher** in the *same* worktree to complete the remaining work, also at `t.route.model || 'sonnet'`.

Every recovery path runs at the unit's **routed** Claude tier, exactly as the persona states.

---

## The repo-wide model policy

Routing decides the executor tier per task. A second, broader rule governs the model on **every other** agent dispatch in both coordinators. It is stated identically in [`CLAUDE.md`](../../CLAUDE.md) (item 8) and the substrate docs ([`../workflows/README.md`](../workflows/README.md), item 8):

- **Omit `model`** to inherit the session tier (the default).
- Use **`model: 'sonnet'`** for grunt work: search, fetch, extraction, mechanical authoring, routine verification.
- Reserve **`model: 'opus'`** only for steps that genuinely need top-tier reasoning.

The observable pattern in the code matches the policy precisely:

- **Every explicit `model:` literal in both coordinators is `'sonnet'`.** (22 occurrences in `shepherd-deliver.js`, 28 in `shepherd-plan.js`; zero hardcoded `opus`, `haiku`, or `fable`.) These are the mechanical dispatches: the router itself, `codex-runner`, `codex-reviewer`, browser-proofing, ship, gate-recheck, `finding-verifier`, audit checks, the research roster, fix application, adversarial refutation.
- **The genuine-reasoning steps inherit by omitting `model`**: plan authoring (`plan-author`), task splitting (`task-splitter`), the persona doc/code reviewers, plan editing (`plan-editor`), and CI diagnosis (`ci-watcher`). They run at whatever tier the session is set to.
- **`haiku` and `opus` reach an agent only one way: through the router's `ROUTE_SCHEMA.model`.** There is no hardcoded `haiku`/`opus` dispatch anywhere. The `unit-executor` (and its recovery dispatches) is the sole place either tier is used, and it always comes from the route, never from inheritance.

A subtlety on persona tiers: personas do **not** carry an intrinsic model tier, except `codex-runner` and `codex-reviewer`, which pin `model: sonnet` in their own frontmatter (they are mechanical protocol operators whose heavy reasoning is offloaded to the external Codex model). Every other tier comes from the dispatch site, and `unit-executor`'s tier comes from the router, never inherited.

---

## How we know (the dogfood)

The routing rubric is not a guess. It is the distilled output of a measurement program recorded in [`dogfood/LEDGER.md`](../../dogfood/LEDGER.md) and summarized in [`docs/solutions/architecture-patterns/model-tier-routing-by-ambiguity-and-size.md`](../../docs/solutions/architecture-patterns/model-tier-routing-by-ambiguity-and-size.md).

What the program was:

- **26 measured dispatches** over one day (~$14 API-equivalent, PR #22): **15 A/B experiments across six feature classes** (f1-f6: a todos page+API, optimistic-UI CRUD, JSON-file persistence with concurrent writes, an ambiguous search/filter feature, risk-high auth middleware, a cross-cutting data-layer refactor), then f7 planning comparisons and 8 live-routed units for a multi-user migration.
- The drafted rubric was then validated two more ways: a **6/6 retrospective back-test** (a simulator routed six known tasks; all 6 routes were sensible: T3 was a deliberate safe-side escalation one tier above the haiku empirical optimum; the rest matched the measured optimum), and **8/8 first-try-correct live-routed units** that built an entire multi-user feature for **~$2.19 with zero rework**, each unit landing on the cheapest tier that produced correct code.

The distilled rule (what the rubric above encodes):

1. **Ambiguity x size picks the tier**, not the risk label. Haiku matched bigger models on every well-specified small task; opus won decisively (blind 7.5 vs 4.5) only where design decisions were left open.
2. **Risk escalates the verification pass**, not just the model (the f5 auth result: functional tie 7/7, security split 6.5 vs 4.0).
3. **`fable` is planning-only** (blind plan grade 8.0 vs opus 6.0 at 1.7x cost on a hard migration plan; never routed to execution).
4. **Codex's niche is mechanical pattern-clones in parallel waves** with sandbox-safe verification; **effort `high` never beat `medium`**; reserve `xhigh` for cross-cutting work.

Read this as a calibration program, not continuous instrumentation. [`STRATEGY.md`](../../STRATEGY.md)'s ongoing metrics (escaped-defect rate, unattended completion rate, rework rate, cost per executed task) are aspirational: it states plainly that "Nothing instrumented yet; measured manually from run reports and git history." The dogfood is a one-time, hand-run measurement that set the rubric; it is not an automated feedback loop reshaping routing in production.

---

## See also

- [`./deliver.md`](./deliver.md): the deliver pipeline that splits, routes, executes, and verifies.
- [`./fleet.md`](./fleet.md): the full agent catalog (executor-router, codex-runner, unit-executor, and the rest).
- [`./verification.md`](./verification.md): the review passes that risk escalation triggers.
- [`../workflows/README.md`](../workflows/README.md): the dynamic-workflow substrate and its model policy.
- [`dogfood/LEDGER.md`](../../dogfood/LEDGER.md): the raw measurement program behind the rubric.
