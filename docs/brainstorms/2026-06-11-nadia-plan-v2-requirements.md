# nadia-plan v2 — Fleet Sovereignty and the Doctrine Skills Layer

nadia-plan currently rents 12 of its 15 minds from the compound-engineering plugin, and its engineering know-how exists nowhere as a first-class artifact. v2 does two things: (1) imports the agent fleet and owns it — every persona slimmed while preserving its entire doctrine, merged where two agents are one job; (2) authors the engineering schools as **owned skills** under `skills/` — the repo's knowledge layer — and rewrites the personas as thin role-bindings that name and read their skills. One coherent composition: skills carry the doctrine, agents carry the roles, the workflow carries the control flow.

## Problem Frame

Three defects, one root cause (the pipeline owns neither its agents nor its knowledge):

1. **Doctrine has no home.** The engineering schools we studied — Ousterhout interface design, DDD, addyosmani decomposition, Shape Up appetite, trycycle zero-context, testing-at-the-interface — exist only in external repos and chat history. The ecosystem-standard artifact for procedural knowledge is a skill: versioned, shareable, usable by workflow agents, interactive sessions, and (later) nadia-deliver's executors alike. nadia has a `skills/` directory with one skill in it.
2. **Twelve agents are rented.** `compound-engineering:*` invocations whose text we cannot slim, extend, or merge. The personas predate current prompting guidance (Fable: brief steering beats rule enumeration) and their verbosity is frozen behind the ownership boundary.
3. **Composition is unexaminable.** Possible merges (two researchers that are one grounding job) can't be evaluated across that boundary either.

Upstream sources are readable at `~/Code/compound-engineering-plugin/plugins/compound-engineering/agents/` (13 personas used by this pipeline, 1,471 lines). The trade we accept: forking diverges from upstream updates — we own maintenance. The plugin stays installed for interactive use; the pipeline becomes self-contained.

## The Skills Layer (new, the knowledge)

Five doctrine skills authored under `skills/`, each slim (~40–80 lines), Fable-written, principles-grouped, source-attributed. They are the single source of engineering doctrine — slash-invokable interactively, read by workflow agents, reusable by future campaigns (nadia-deliver executors).

| Skill | Carries (source) |
|---|---|
| `skills/interface-design` | Deep modules (small interface, much behavior); design-it-twice (two opposed sketches before committing); interface = everything a caller must know (invariants, errors, ordering — not signatures); define errors out of existence; information hiding; the deletion test; one adapter = hypothetical seam, two = real; slightly general-purpose. (Ousterhout / mattpocock) |
| `skills/decomposition` | Dependency graph before units; vertical slices, never horizontal layers; one unit ≈ one meaningful change ≈ one atomic commit; "and" in a goal = two units; oversized signals (>~8 files, 2+ subsystems, mixed test concerns); risk-early ordering without fake dependencies; contract-defining unit precedes its sharers. (addyosmani) |
| `skills/scoping` | Declared appetite bounds the plan; cut scope, not quality; explicit no-gos naming specific excluded functionality; tangential discoveries route to deferred, never absorbed; deferred items keep their R-IDs. (Shape Up) |
| `skills/zero-context-planning` | Plan for a skilled stranger with zero repo context and questionable test taste; exact repo-relative paths; patterns cited by path; decisions-not-code; execution-time unknowns deferred explicitly, design-level unknowns never buried. (trycycle) |
| `skills/test-strategy` | The interface is the test surface — never test past it; dependency category picks the strategy (in-process → through the interface; local-substitutable → stand-in; remote-owned → port + in-memory adapter; third-party → injected mock); scenarios derive from requirements with input→action→outcome; observable, numeric-where-applicable verification; right-sized to risk. (mattpocock DEEPENING + ce-plan + trycycle) |

DDD (ubiquitous language from CONTEXT.md, domain-named units, seams at domain boundaries, ADRs are settled) threads through `interface-design` (seam placement) and `decomposition` (unit naming) rather than standing alone — two skills citing it beats a third skill restating it. If audit shows it deserves its own file, split then.

**Consumption mechanism — determinism preserved.** Workflow agents do not invoke skills through the harness mid-pipeline; their personas instruct them to **read** the named skill files (agents have `Read`; same pattern as CLAUDE.md requiring `docs/workflows/README.md` before workflow authoring). Interactive users get the same files as normal slash skills. One artifact, every consumer.

**Cross-repo resolution rule.** Doctrine skills live in the nadia checkout (the session root, where the agent definitions themselves live) — never in the target repo. When `args.repo` points the run at a sibling repo, the REPO grounding chokepoint's brief gains one exception line: `skills/` reads resolve from the session's starting directory, NOT ${REPO}. Personas name skills as session-root paths. Without this, the chokepoint's "resolve every relative path against ${REPO}" silently redirects doctrine reads into a repo that has no skills — doctrine loss exactly on cross-repo runs.

## The Fleet (current → v2)

| # | Agent (current dispatch) | Lines | Role | v2 action |
|---|---|---|---|---|
| 1 | ce-repo-research-analyst | 259 | repo/stack/conventions research | import → `repo-researcher`, slim |
| 2 | ce-learnings-researcher | 256 | docs/solutions/ institutional memory | import → `learnings-researcher`, slim |
| 3 | ce-best-practices-researcher | 117 | external best practices | import, **merge-candidate** with #4 |
| 4 | ce-framework-docs-researcher | 96 | version-specific framework docs | import, **merge-candidate** with #3 → `external-grounding-researcher` (intent-routed) |
| 5 | ce-web-researcher | 128 | landscape / prior art | import → `web-researcher`, slim |
| 6 | ce-spec-flow-analyzer | 87 | flows and edge cases | import → `flow-analyzer`, slim |
| 7 | ce-coherence-reviewer | 73 | contradictions, terminology drift | import → `coherence-lens`, slim; + DDD naming check via `interface-design`/`decomposition` references |
| 8 | ce-feasibility-reviewer | 65 | survives contact with the repo? | import → `feasibility-lens`, slim; reads `test-strategy` |
| 9 | ce-product-lens-reviewer | 92 | premise and strategic weight | import → `product-lens`, slim |
| 10 | ce-design-lens-reviewer | 56 | UX/interaction gaps | import → `design-lens`, slim |
| 11 | ce-security-lens-reviewer | 48 | plan-level security gaps | import → `security-lens`, slim |
| 12 | ce-scope-guardian-reviewer | 79 | scope alignment | import → `scope-lens`, slim; reads `scoping` (gains the appetite doctrine) |
| 13 | ce-adversarial-document-reviewer | 115 | high-stakes premise stress-test | import → `adversarial-lens`, slim |
| 14 | plan-author (local) | 66 | writes the plan | rewrite as role-binding: reads `decomposition`, `scoping`, `interface-design`, `test-strategy`, `zero-context-planning` |
| 15 | plan-editor (local) | 46 | READY/REVISED verdict | rewrite as role-binding: enforces the same five skills; verdict framing byte-identical |
| 16 | skeptical-refuter (local) | — | refutes findings/KTDs | untouched (locked machinery) |

**The persona shape after v2** (the contract for every rewritten persona): *identity and role in 2–3 sentences → the skills it reads, by path, with one line on when each applies → its role-specific rules (the few things only this agent must know) → its output expectations.* Doctrine lives in skills; personas never restate more than one line of it.

## Requirements

R1. Every `agentType: 'compound-engineering:*'` dispatch in `workflows/nadia-plan.js` is replaced by a repo-owned persona under `agents/`; after v2, `grep "compound-engineering:" workflows/nadia-plan.js` returns nothing.

R2. The five doctrine skills exist under `skills/` with valid skill frontmatter (name, description with trigger guidance), each ≤ ~80 lines, each source-attributed, collectively covering every principle listed in the Skills Layer table. They are discoverable interactively (the repo's `skills/` symlink into `.claude/skills` already handles this).

R3. Each imported persona preserves its entire upstream doctrine — every distinct check, mandate, and output expectation survives, restated Fable-brief or replaced by a reference to a doctrine skill that carries it. Frontmatter tool grants survive verbatim (the researchers carry `WebFetch, WebSearch, mcp__context7__*` — dropping grants on import lobotomizes them). A per-persona doctrine checklist is derived from the upstream file at import time; an import that drops a mandate is a defect.

R4. Personas follow the role-binding shape: role, named skills (by path, with when-to-apply), role-specific rules, output expectations. No persona restates doctrine a skill carries beyond a one-line pointer.

R5. plan-author's rewrite preserves all existing load-bearing rules (U-ID/R-ID permanence, vertical slices, contract-first, risk-early, observable verification, scope-boundaries discipline, assumptions-carry-invalidating-observations, evidence honesty) — each either kept as a role-specific rule or carried by a named skill.

R6. plan-editor's rewrite keeps the verdict-correctness framing byte-identical (eval-backed) and gains three skill-grounded diagnostics: shallow-unit/deletion-test, tests-aimed-past-the-interface, undefined-new-domain-term.

R7. Merge decisions are made by audit, not default: best-practices + framework-docs merge into `external-grounding-researcher` only if the union loses no doctrine and removes a dispatch; otherwise both stay and the doc says why. Intake's research gating becomes intent-based — a required `intent` enum (implementation-guidance | landscape | mixed | none) **replacing** the `bestPractices`/`web` booleans — and routes the grounding researcher(s); the stale "not in the verified agent registry" log (v1 line 469) is removed.

R8. All 15 coordinator prompt factories and the inline stage prompts (intake, author, research briefs) are slimmed to brief steering + schema contract + grounding blocks. Preserved verbatim: referent-explicit KTD verdict wording, GATE_AUTHORITY, protected-surface rules, the confidence-anchor rubric's anchors, caps language.

R9. Locked invariants untouched: the S0–S6 flow (no new phases; imports replace rentals one-for-one), KTD refutation/arbitration machinery, all pure-JS guards (uid stability, file overlap, cycle check, dedup, primer, caps), the autonomy contract (decidable unknowns → hypothesis + Assumption; blocking → structured halt; never a mid-run question), the ce-plan document format, UNITS_SCHEMA as nadia-deliver byte-copy, run-summary shape, args contract. The REPO grounding chokepoint's mechanism is locked; its brief text gains exactly the skills-root exception line from the cross-repo resolution rule, nothing else. The rationale for every locked mechanism lives at `docs/plans/provenance/nadia-plan-v1/decisions.md` — the slimming pass reads it before touching prose near locked machinery.

R10. `workflows/nadia-plan.test.mjs` extends to pin: zero compound-engineering dispatch strings; each owned persona exists and is dispatched by its station; each persona names only doctrine skills that exist on disk (no dangling references); intent routing (each intent value produces exactly its researcher set; mixed orders web first); exact-string pins on all R8 verbatim surfaces; existing prose pins converted to mechanism pins. Full suite green via `node --test workflows/nadia-plan.test.mjs`; `node --check` passes; no banned forms; no coordinator I/O.

R11. Slimming is proven, not claimed: total line count of the 13 imported personas ends below upstream's 1,471 while every R3 checklist passes. The five doctrine skills are new artifacts budgeted separately (≤ ~80 lines each).

R12. Intake's Confirmed Intent carries `constraints: string[]` (replacing the single `constraint` string) so multi-constraint requests are not mushed into one sentence; the Confirmed Intent block renders them as a list, and the author surfaces each constraint in a KTD rationale, an Assumptions entry, or a Scope Boundary.

R13. The origin-coverage gate treats list items inside a principles/lessons-style origin section as individual coverage units — a section judged "addressed" with member items dropped is an omission.

## Scope Boundaries

- nadia-deliver's fleet is NOT imported in v2 — same move, separate campaign once this proves out. Its executors become consumers of the doctrine skills then.
- No simplification of KTD machinery, primer, dedup, caps (verdict-referent A/B pending).
- No new pipeline phases, no perspective panel, no mid-pipeline harness Skill invocation, no canon document.
- No changes to the plan document format or anything nadia-deliver parses.
- Upstream plugin stays installed and untouched; interactive ce-* use unaffected.

### Deferred to Follow-Up Work
- Playground A/B validating behavior-quality claims (slimmer owned fleet + doctrine skills plan better) — hypotheses until it runs.
- nadia-deliver fleet sovereignty and executor adoption of the doctrine skills.
- KTD verdict-referent A/B (separate track).
- Possible DDD skill split-out if audit shows it deserves its own file.

## Success Criteria

- `grep -c "compound-engineering:" workflows/nadia-plan.js` → 0 (R1).
- Five doctrine skills on disk, valid frontmatter, ≤ ~80 lines each, principle coverage complete (R2).
- Per-persona doctrine checklists pass; imported fleet total < 1,471 lines (R3, R11).
- Every persona matches the role-binding shape; no dangling skill references (R4, R10).
- Full suite green with all new pins; a nadia-plan run on this branch completes end-to-end dispatching only owned agents reading only owned skills.
