# Dogfood: optimize agent routing by cost/model/task-type

Loop: cron `9029a52f`, every 30 min. Each iteration runs one experiment, records
measurements in `LEDGER.md`, and refines the routing policy below. The artifact
under test is `agents/executor-router.md` (and the broader model-pick policy for
agents this session dispatches).

## Goal

Find the cheapest model/executor mix that still produces correct code, per task type.
Constraint from the user: **Fable 5 only for extremely important planning and extremely
challenging intellectual tasks.** Otherwise mix Opus 4.8 / Sonnet 4.6 / Codex GPT-5.5
(at its effort levels). Measure tokens, cost, and correctness for every dispatch.

## Test bed

Scratch Next.js app at `/Users/vadimcomanescu/Code/nadia-scratch` (create-next-app,
TS + Tailwind + App Router). Each iteration implements the next feature from the
backlog below, A/B-ing executors on identical task dossiers where informative.

### Feature backlog (in order)
1. `/todos` page + in-memory `/api/todos` (GET/POST, validation) — well-specified, mechanical
2. Todo toggle/delete (PATCH/DELETE) + optimistic UI — small behavioral change
3. Persist todos to a JSON file with safe concurrent writes — touches error handling/risk surface
4. Search/filter with URL state (searchParams) — needs framework judgment
5. Auth-lite: session cookie middleware protecting /todos — risk surface (auth)
6. Refactor: extract data layer, add unit tests — cross-cutting

Features deliberately climb the rubric ladder (trivial → risk surface → cross-cutting)
so each executor tier gets exercised where the router would send it.

## Routing policy under test (v0 hypothesis)

| Task type | Executor/model | Rationale |
|---|---|---|
| Extremely important planning / hardest intellectual work | Fable 5 | user constraint: only here |
| Ambiguous or high-risk implementation; architecture decisions | Opus 4.8 | judgment needed |
| Well-scoped implementation, code review, verification | Sonnet 4.6 | cheap, capable |
| Well-specified mechanical implementation (rubric in executor-router.md) | Codex GPT-5.5, effort by risk | offload entirely |
| Grunt search/extraction/classification | Haiku 4.5 or Sonnet 4.6 | cheapest that works |

## Measurement method

- **Codex:** token counts from `codex exec` final usage line.
- **Claude agents:** token usage from the Agent tool result / agent transcript jsonl.
- **Cost rates ($/MTok in, out):** Fable 5 10/50 · Opus 4.8 5/25 · Sonnet 4.6 3/15 ·
  Haiku 4.5 1/5 · Codex GPT-5.5 assumed 1.25/10 (API-equivalent; actual marginal cost
  is $0 — ChatGPT subscription).
- **Correctness:** per-feature rubric (build passes, endpoints behave, UI renders),
  scored 0–1 per criterion by a verifier; failures recorded with cause.

## Iteration protocol

1. Read LEDGER.md; pick next experiment (next feature, or re-run with different routing).
2. Write one task dossier; dispatch to chosen executor(s) on separate git branches
   of the scratch app (sequential when sharing the working tree).
3. Verify (build + functional check), score correctness.
4. Record row(s) in LEDGER.md; update routing-policy table if evidence warrants.
5. When evidence is strong, produce the END DELIVERABLE (propose diff to Vadim
   before committing).

## End deliverable (the point of all this)

Modify the routing layer of **shepherd-deliver** so model choice is routed
per task instead of inherited:

1. `agents/executor-router.md` — when routing to CLAUDE, also pick the model tier
   (`sonnet` vs `opus`; Fable 5 never for execution — planning only), with rubric
   thresholds grounded in LEDGER.md evidence.
2. `workflows/shepherd-deliver.js` — add `model` to `ROUTE_SCHEMA`; pass
   `model: t.route.model` in the Execute dispatch (~line 579, currently
   "claude executor inherits" — i.e. a Fable 5 session runs every unit-executor
   on Fable 5), and in the codex-fallback and finisher dispatches.
