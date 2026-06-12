---
name: decomposition
description: Decompose plans, features, bugs, or workflow changes into implementation units that agents can execute and commit independently. Use when turning a goal, PRD, issue, roadmap item, or review finding into buildable work.
---

Read this skill before decomposing, the same way CLAUDE.md requires agents to
read `docs/workflows/README.md` before workflow work. Treat decomposition as
design work: make the units small enough to prove, name, review, and commit
without losing the shape of the product change.

## Start with dependencies

- Build the dependency graph before defining units. List the real contracts,
  data paths, migrations, prompt surfaces, UI states, and verification gates
  that constrain order.
- Separate dependency from convenience. If two changes can ship in either
  order, do not invent an edge just because they live near each other.
- Place a contract-defining unit before the units that share that contract:
  schema before callers, interface before implementations, prompt contract
  before agents that rely on it.
- Source: addyosmani's decomposition guidance favors dependency-aware slices
  that preserve flow; the DDD thread reinforces ordering around shared domain
  contracts.

## Cut vertical slices

- Prefer a vertical slice that changes one user-visible or operator-visible
  behavior from entry point through proof.
- Reject horizontal layers as units. Do not make one unit "database", another
  "API", another "UI", unless each layer is independently meaningful and
  verifiable on its own.
- Keep one unit approximately one meaningful change and one atomic commit. If
  the commit message needs "and", split it.
- Let the test or evidence shape travel with the slice. A unit that changes
  behavior without its proof is not finished.
- Source: addyosmani explicitly argues for thin vertical work over broad
  layer-by-layer delivery.

## Keep units small enough to trust

- Treat more than ~8 files as a warning sign, not a hard law. Stop and ask
  which behavior is actually being changed.
- Split a unit that spans 2+ subsystems unless one real contract or workflow
  cannot be proven without both.
- Split mixed test concerns: parser tests, integration tests, UI screenshots,
  migration checks, and prompt simulations usually point to different units.
- Do not split so far that a unit becomes bookkeeping. Each unit should leave
  the repo better, runnable, and reviewable.
- Source: addyosmani's guidance frames size as cognitive load; keep the unit
  reviewable by one agent and one reviewer.

## Order for risk

- Put risk-early work first when it can invalidate the plan: unknown APIs,
  data migrations, security boundaries, prompt behavior, and browser-visible
  interactions.
- Keep risk ordering honest. Move a risky unit earlier because it teaches you
  something, not because you want every later unit to depend on it.
- Follow the dependency graph when risk and dependency conflict. A high-risk
  caller still waits for the contract it calls.
- Carry the proof forward. The early unit should produce evidence, constraints,
  or a narrowed follow-up plan that later units can use.
- Source: addyosmani's planning heuristics push uncertainty forward while
  preserving deliverable slices.

## Name units in the domain

- Use domain-named units, not implementation bucket names. Prefer "settle
  invoice retry policy" over "update worker code".
- Pull names from the DDD thread and the repo glossary before inventing new
  vocabulary. The unit name should tell a reviewer which business concept is
  moving.
- Let domain names expose bad splits. If a unit needs two unrelated domain
  nouns joined by "and", make two units unless the dependency graph proves one
  contract binds them.
- Keep the final list readable as a product story: each unit advances a named
  capability, closes a named risk, or establishes a named contract.
- Source: the DDD thread treats language as architecture; addyosmani's slicing
  guidance keeps that language tied to executable increments.
