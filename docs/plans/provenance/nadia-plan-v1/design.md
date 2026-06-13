# nadia-plan — Complete Design Spec

Target file: `/home/vadim/Code/nadia/workflows/nadia-plan.js` (+ `/home/vadim/Code/nadia/workflows/nadia-plan.test.mjs`, `/home/vadim/Code/nadia/agents/plan-author.md`, `/home/vadim/Code/nadia/agents/plan-editor.md`).

Authority chain (do not deviate): `/tmp/nadia-plan-build/decisions.md` (binding decision matrix, mechanisms M1–M20, M-X1/M-X2, Q1–Q13) over `/tmp/nadia-plan-build/catalog.md` §A (base contract) over this spec's wording. Conventions mirror the sibling `/home/vadim/Code/nadia/workflows/ce-work-deterministic.js`: `meta` first statement as pure literal, args destructured into UPPER_CASE consts immediately after, schemas as top-level consts, prompt factories as top-level const arrow functions, label-prefix discipline, hard-throw only in the preflight zone, graceful structured degradation afterwards.

The coordinator does NO I/O, ever. No `Date.now()`, `Math.random()`, `new Date()`. Plain JavaScript, no imports, top-level await.

---

## 1. `meta` block (verbatim — first statement of the file)

```js
export const meta = {
  name: 'nadia-plan',
  description: 'Plan-production pipeline: lock a request or brainstorm into Confirmed Intent, research the repo, challenge the framing, author a ce-plan-format plan document, then run a bounded editor loop (persona doc-review, skeptical refutation, verified fix application, read-only spikes for design unknowns) and final gates (ce-work parse conformance, releasability checklist, origin coverage, cross-plan overlap), hygiene-check the workspace, optionally commit, and return a machine-readable run summary consumable by ce-work-deterministic.',
  whenToUse: 'Producing a plan document for ce-work-deterministic from a request or an origin brainstorm/requirements doc, autonomously (no interactive questions; blocking unknowns become a structured halt). Passing commit: true IS the consent to commit the plan file. args: { request?: "<what to plan>", origin?: "<path to brainstorm/requirements doc>", originVersion?: "<hash-or-mtime — pass a NEW value after editing the origin doc so resume does not replay stale cached research>", depth?: "lightweight"|"standard"|"deep", date?: "YYYY-MM-DD", commit?: true|false, editorRounds?: <1..5, default 3>, reviewRounds?: <1..3, default 2>, spikes?: true|false, externalResearch?: true|false }',
  phases: [
    { title: 'Intake', detail: 'Lock Confirmed Intent, classify unknowns, set depth tier' },
    { title: 'Research', detail: 'Repo + learnings + conditional external research, cross-plan scan' },
    { title: 'Gate', detail: 'Strategy and scope challenge before drafting' },
    { title: 'Draft', detail: 'Author the plan document, classify review personas, extract KTDs' },
    { title: 'Review', detail: 'Bounded editor loop: personas, refuters, verified fixes, spikes' },
    { title: 'Gates', detail: 'Parse conformance, releasability, origin coverage, cross-plan overlap' },
    { title: 'Finalize', detail: 'Hygiene check, optional commit, machine-readable run summary' },
  ],
}
```

`phase()` calls in the body use exactly these seven titles. Inside `parallel()`/`pipeline()` fan-outs, pass `phase:` per agent call (sibling convention).

---

## 2. Args contract

### 2.1 Preflight zone (the ONLY throw zone in the whole coordinator)

Immediately after `meta`, in this order:

```js
if (!args || ((!args.request || !String(args.request).trim()) && !args.origin)) {
  throw new Error('nadia-plan requires args.request (text) or args.origin (path to a brainstorm/requirements doc)')
}
if (args.depth !== undefined && !['lightweight', 'standard', 'deep'].includes(args.depth)) {
  throw new Error('args.depth must be one of lightweight|standard|deep')
}
if (args.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
  throw new Error('args.date must be YYYY-MM-DD')
}
```

Nothing else throws *from coordinator code*. Every later failure resolves to the M17 structured halt return (§3). This mirrors the sibling's early-hard-guard vs late-graceful split (decisions Q12), shifted one notch earlier: the sibling throws on recon facts; nadia-plan does not, because a correctly detected blocker is a successful classification.

One documented exception outside the coordinator's control (constraints.md §12): when `budget.total` is set, the RUNTIME throws from any `agent()` call made after `spent()` reaches the ceiling. Inside `parallel()`/`pipeline()` that degrades to `null`, but a mid-stage ceiling hit on a bare-awaited dispatch (intake, strategy-gate, author, classifier, fixer, checker, editor, gates, hygiene) surfaces as a runtime throw, not an M17 halt. The `belowBudgetFloor()` guards at the S4 round head and the S5/S6 stage heads make this rare — but a worst-case round costs more than the 30000 floor, so it is reachable in budget-capped runs. This is sibling-identical behavior, accepted, not promised away.

### 2.2 Derived consts (full list)

| Const | Expression | Notes |
|---|---|---|
| `REQUEST` | `args.request ? String(args.request).trim() : ''` | may be `''` when origin-only |
| `ORIGIN` | `args.origin \|\| ''` | path; `''` = none |
| `ORIGIN_VERSION` | `args.originVersion \|\| 'unversioned'` | cache-busting for resume, mirrors sibling `planVersion`; interpolated into every prompt that instructs reading the origin doc (intake, S1 researchers, author, origin-coverage) so an edited origin invalidates the journal cache |
| `PINNED_DEPTH` | `args.depth \|\| ''` | `''` = intake derives |
| `PLAN_DATE` | `args.date \|\| ''` | `''` = author derives via `date +%F` (agents may do I/O; the coordinator never does — decisions Q2) |
| `COMMIT` | `args.commit === true` | DEFAULT FALSE — consent style, per the global git-read-only rule (decisions Q3). Note: deliberately NOT the sibling's `!== false` form |
| `EDITOR_ROUNDS` | `Math.max(1, Math.min(5, args.editorRounds \|\| 3))` | the single outer loop counter (decisions Q5) |
| `PERSONA_ROUNDS` | `Math.max(1, Math.min(3, args.reviewRounds \|\| 2))` | persona stage active rounds 1..PERSONA_ROUNDS; NOT a second counter |
| `SPIKES_ENABLED` | `args.spikes !== false` | |
| `EXTERNAL_RESEARCH` | `args.externalResearch !== false` | |
| `BUDGET_FLOOR` | `30000` | sibling line-548 constant, unchanged |
| `belowBudgetFloor` | `() => !!budget.total && budget.remaining() <= BUDGET_FLOOR` | guarded on `budget.total` truthiness |

Caps as named consts (all logged when they drop anything — M18):

```js
const FINDING_REFUTER_CAP = 16   // per round, severity-ordered (M7 class A)
const HALT_CLASS_CAP = 3         // majority-of-3 procedures per run (M7)
const KTD_CAP = 8                // KTD refuters, prioritized (M7 class B)
const KTD_PASSES_CAP = 2         // initial pass + at most one primer-triggered re-refutation pass
const KTD_HALT_CAP = 3           // majority-of-3 procedures for refuted-KTD findings (dedicated allowance, separate from HALT_CLASS_CAP)
const SPIKE_CAP = 3              // read-only spikes, once per run (M10)
const PERSONA_CAP = 8            // personas per round (roster is 7; cap asserted anyway)
const RESEARCH_CAP = 6           // S1 fan-out ceiling
```

No `startedAt` arg: nothing in this coordinator needs a timestamp (dates come from `args.date` or the author agent's own `date` run).

---

## 3. Return contract (M17 — the halt-contract carrier)

One shape for both terminal statuses. ALL fields always present (nulls explicit, arrays empty not missing) so the caller never branches on field existence:

```js
{
  status: 'ready' | 'halted',
  planPath: string | null,        // repo-relative path of the (draft or final) plan file; null only when halted before S3 wrote it
  planVersion: string | null,     // git hash-object of the final plan file, from the S6 hygiene agent; null when halted or hygiene failed
  depthTier: 'lightweight' | 'standard' | 'deep' | null,   // null only on S0 halts before tier resolution
  unitCount: number,              // from final parse gate when reached, else latest checker, else author return, else 0
  requirementCount: number,       // same precedence
  roundsUsed: number,             // S4 editor rounds actually run (0 when halted before S4)
  personaRoundsUsed: number,      // rounds in which the persona stage dispatched
  residualFindings: [             // every finding not fixed: documented-as-known-cost, FYI, cap drops, conflicts, fixer failures
    { title: string, section: string, class: 'documented' | 'fyi' | 'dropped-cap' | 'unapplied-conflict' | 'fixer-failed' | 'scope-widening-routed', reason: string }
  ],
  narrowedScope: [string],        // one-thing split-test exclusions (M1) — caller can re-invoke per item
  openQuestions: [string],        // blocking unknowns / unverifiable KTDs / refuted KTDs (majority-sustained, or beyond the KTD_HALT_CAP majority allowance) / runtime-blocked spikes / cross-plan overlaps / scope-widening proposals routed to the doc's Open Questions, mirrored here
  committed: boolean,             // true only when args.commit === true AND the commit agent reported success
  hygieneClean: boolean | null,   // null when the hygiene agent never ran or died
  haltStage: string | null,       // null on 'ready'. One of: 'S0-intake', 'S0-blocking-unknowns', 'S2-strategy-gate', 'S3-draft', 'S4-budget-floor', 'S4-post-mutation-check', 'S4-uid-stability', 'S4-halt-class-finding', 'S4-editor-cap', 'S5-budget-floor', 'S5-parse-gate', 'S5-releasability', 'S5-origin-coverage'
  haltReason: string | null,
  nextStep: string,               // always actionable, see below
}
```

`nextStep` strings:

- ready + committed: `` `Run ce-work-deterministic with { plan: '${planPath}', planVersion: '${planVersion}' }` ``
- ready + not committed: `` `Commit the plan file (git add ${planPath} && git commit -m "docs(plans): add ${slug} plan"), then run ce-work-deterministic with { plan: '${planPath}', planVersion: '${planVersion}' } — ce-work requires the plan committed` `` (when planVersion is null because hygiene died: `'…re-derive planVersion with git hash-object after committing'`)
- halted: stage-specific one-liner naming what the human must resolve, always ending with `'then re-invoke nadia-plan'` (and `'(draft preserved at <planPath>)'` whenever a draft exists).

The coordinator implements this via one pure-JS builder used by every halt site:

```js
const summary = (status, extra) => ({ status, planPath, planVersion, depthTier, unitCount, requirementCount,
  roundsUsed, personaRoundsUsed, residualFindings, narrowedScope, openQuestions, committed, hygieneClean,
  haltStage: null, haltReason: null, nextStep: '', ...extra })
// halts: return summary('halted', { haltStage: 'S4-editor-cap', haltReason: ..., nextStep: ... })
```

The builder folds `pendingFyi` before composing ANY terminal summary (the one and only merge point for anchor-50 advisories — they are otherwise never fixed, never refuted, and must not be silently dropped): `residualFindings.push(...pendingFyi.map(f => ({ title: f.title, section: f.section, class: 'fyi', reason: 'anchor-50 advisory' })))`, executed as the first line of `summary()` (called exactly once per run).

Preflight failure shape: a thrown `Error` with one of the three §2.1 messages. Nothing is returned; no agent has been dispatched.

---

## 4. Pipeline spec, stage by stage

Cross-cutting (M-X1): every agent returns `opts.schema`-validated JSON; every gate/loop predicate reads counted fields only, never prose. Cross-cutting (M18): every fan-out is clamped by a named cap; every drop is `log()`ged with what and why.

Shared prompt blocks (top-level consts built in pure JS after the stage that produces their data — they are coordinator variables, threaded verbatim per principle 3):

- `CONFIRMED_INTENT` — built once from the intake return (§4.1), `<confirmed-intent>…</confirmed-intent>` XML-ish wrapper, threaded VERBATIM into every S2–S5 prompt.
- `CODEBASE_CONTEXT` — built once from S1 returns (§4.2), `<codebase-context>…</codebase-context>`, threaded into every persona/author/editor/fixer/spike/gate prompt (M2).
- `primerBlock()` — renders the decision-primer state (§4.5.h) as `<decision-primer>…</decision-primer>`; literal `<decision-primer>none — first round</decision-primer>` on round 1 (M20).
- `NO_CLAIM RULE (construction, not text)`: reviewer/editor/refuter prompt factories take only `(round)`-style positional data plus the locked blocks above. They MUST NOT take or interpolate the author's or any prior agent's free-text `detail`/reasoning fields (M6; tested by SH-S13).

### 4.1 S0 — Intake (`phase('Intake')`)

**Dispatch 1: `intake`.** agentType: none. model: omit (inherit — classification quality is load-bearing). Schema:

```js
const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    confirmedIntent: {
      type: 'object',
      properties: {
        outcome: { type: 'string' }, user: { type: 'string' }, whyNow: { type: 'string' },
        success: { type: 'string', description: 'observable success statement' },
        constraint: { type: 'string' }, outOfScope: { type: 'array', items: { type: 'string' } },
      },
      required: ['outcome', 'user', 'whyNow', 'success', 'constraint', 'outOfScope'],
    },
    blockingUnknowns: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, whyBlocking: { type: 'string' } }, required: ['question', 'whyBlocking'] } },
    decidableUnknowns: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, hypothesis: { type: 'string' }, invalidatedWhen: { type: 'string', description: 'the observation that would invalidate the hypothesis' } }, required: ['question', 'hypothesis', 'invalidatedWhen'] } },
    split: { type: 'object', properties: { isMultiple: { type: 'boolean' }, primary: { type: 'string' }, excluded: { type: 'array', items: { type: 'string' } } }, required: ['isMultiple', 'primary', 'excluded'] },
    depthTier: { enum: ['lightweight', 'standard', 'deep'] },
    planType: { enum: ['feat', 'fix', 'refactor', 'chore', 'docs', 'perf', 'test'] },
    research: { type: 'object', properties: { bestPractices: { type: 'boolean' }, web: { type: 'boolean' }, reason: { type: 'string' } }, required: ['bestPractices', 'web', 'reason'] },
    nonCodeDeliverable: { type: 'boolean', description: 'true when the request is not a code change (knowledge work)' },
  },
  required: ['confirmedIntent', 'blockingUnknowns', 'decidableUnknowns', 'split', 'depthTier', 'planType', 'research', 'nonCodeDeliverable'],
}
```

Prompt skeleton (slots): raw `REQUEST`; `ORIGIN` path + `ORIGIN_VERSION` + instruction to read the origin doc when set; `PINNED_DEPTH` ("depth tier is PINNED to X — return it" vs "derive the tier: Lightweight 2–4 units / Standard 3–6 / Deep 4–8"); instructions for the six-field Confirmed Intent (derived from args/origin only, never invented); blocking-vs-decidable rule ("blocking = could materially change the outcome AND would likely upset the requester if guessed wrong; everything else: decide, attach hypothesis + the observation that would invalidate it"); the three one-thing split tests verbatim ("the 'and' test: does describing it need an 'and' joining independent outcomes; the independence test: could each part ship and be tested alone; the 'what changed' test: would each part's diff make sense as its own PR — if genuinely N independent things, pick the primary and list the rest as excluded"); external-research gates ("recommend bestPractices/web research only for implementation-guidance or landscape intent with risk or thin local patterns").

Coordinator JS after:

- `intake === null` → `return summary('halted', { haltStage: 'S0-intake', haltReason: 'intake agent returned null', nextStep: 'Re-invoke nadia-plan; if it recurs, file the request as an issue with the raw request text' })`.
- `intake.nonCodeDeliverable === true` → halt `'S0-intake'`, reason `'request is a non-code deliverable — nadia-plan only produces implementation plans for ce-work-deterministic'` (knowledge-work plans are out of scope; see §8 risk R8).
- `intake.blockingUnknowns.length > 0` → `openQuestions` = the question list; halt `'S0-blocking-unknowns'`, reason listing the questions; nextStep `'Answer the open questions (or fold answers into args.request / the origin doc), then re-invoke nadia-plan'` (M1).
- `DEPTH = PINNED_DEPTH || intake.depthTier`.
- `narrowedScope = intake.split.isMultiple ? intake.split.excluded : []`; when nonempty: `log('One-thing split: narrowed to "' + intake.split.primary + '" — excluded: ' + excluded.join('; ') + ' (routed to Deferred to Follow-Up Work; re-invoke per item)')` (M1, never N plans — decisions Q10).
- `assumptions = intake.decidableUnknowns` (carried to the author for `## Assumptions`, M-X2).
- Build `CONFIRMED_INTENT` (exact template):

```
<confirmed-intent>
Outcome: ${ci.outcome}
User: ${ci.user}
Why now: ${ci.whyNow}
Success: ${ci.success}
Constraint: ${ci.constraint}
Out of scope:
${ci.outOfScope.map((s) => '- ' + s).join('\n') || '- none stated'}
Depth tier: ${DEPTH}
${narrowedScope.length ? 'Narrowed from a multi-part request. Primary: ' + intake.split.primary + '. Excluded (deferred to follow-up work): ' + narrowedScope.join('; ') : 'Single-outcome request.'}
</confirmed-intent>
```

### 4.2 S1 — Research (`phase('Research')`)

`parallel()` is justified here (genuine barrier): S2 and the `CODEBASE_CONTEXT` assembly need the FULL prior result set together. Fan-out ≤ `RESEARCH_CAP` (roster is at most 6 — assert in code by construction, not at runtime).

Roster (thunks built conditionally; every skip logged):

| # | Label | agentType | model | When | Schema |
|---|---|---|---|---|---|
| 1 | `research-repo` | `compound-engineering:ce-repo-research-analyst` | omit | always | `REPO_RESEARCH_SCHEMA` |
| 2 | `research-learnings` | `compound-engineering:ce-learnings-researcher` | `sonnet` | always | `DIGEST_SCHEMA` |
| 3 | `research-best-practices` | `compound-engineering:ce-best-practices-researcher` | `sonnet` | `EXTERNAL_RESEARCH && intake.research.bestPractices` | `DIGEST_SCHEMA` |
| 4 | `research-web` | `compound-engineering:ce-web-researcher` | `sonnet` | `EXTERNAL_RESEARCH && intake.research.web` | `DIGEST_SCHEMA` |
| 5 | `research-flow` | `compound-engineering:ce-spec-flow-analyzer` | omit | `DEPTH !== 'lightweight'` | `FLOW_SCHEMA` |
| 6 | `research-cross-plan` | none | `sonnet` | always | `CROSS_PLAN_SCHEMA` |

Unconditional log (decisions Q8, no-silent-cap): `log('ce-framework-docs-researcher is not in the verified agent registry — skipped; framework-docs coverage rides best-practices/web research')`. Conditional skip logs: `log('External research skipped: args.externalResearch === false')` / `log('Best-practices research skipped: intake gates off (' + intake.research.reason + ')')` / same for web / `log('Spec-flow analysis skipped: lightweight tier')`.

```js
const REPO_RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    repoRoot: { type: 'string' },
    stackDigest: { type: 'string', description: '<=30 lines: stack, architecture, key modules relevant to the request' },
    conventionsDigest: { type: 'string', description: '<=20 lines distilled from AGENTS.md/CLAUDE.md' },
    testingDigest: { type: 'string', description: '<=20 lines: test harness inventory, test commands, testing conventions' },
    relevantFiles: { type: 'array', items: { type: 'string' } },
    contextMdPath: { type: 'string', description: 'repo-relative path of a CONTEXT.md domain glossary if one exists, else ""' },
  },
  required: ['repoRoot', 'stackDigest', 'conventionsDigest', 'testingDigest', 'relevantFiles', 'contextMdPath'],
}
const DIGEST_SCHEMA = {
  type: 'object',
  properties: { digest: { type: 'string', description: '<=25 lines of findings that should change planning decisions; "" when nothing material' }, sources: { type: 'array', items: { type: 'string' } } },
  required: ['digest', 'sources'],
}
const FLOW_SCHEMA = {
  type: 'object',
  properties: { digest: { type: 'string' }, edgeCases: { type: 'array', items: { type: 'string' } } },
  required: ['digest', 'edgeCases'],
}
const CROSS_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    activePlans: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, riskSurfaces: { type: 'array', items: { type: 'string' } } }, required: ['path', 'title', 'files', 'riskSurfaces'] } },
  },
  required: ['activePlans'],
}
```

Prompt skeletons — every researcher receives `CONFIRMED_INTENT`, the raw `REQUEST`, and `ORIGIN`+`ORIGIN_VERSION` (+ read instruction) when set. `research-repo` additionally carries the extended-scope instruction (M2: "include the test harness inventory, the project's test/lint commands, testing conventions, and whether a CONTEXT.md domain glossary exists at the repo root — report its path"). `research-cross-plan` carries: "List every *.md file under docs/plans/ whose YAML frontmatter says status: active. For each, extract the title, the union of all per-unit Files lists, and riskSurfaces (which of auth/payments/migrations/crypto/public-api/deps it touches). Return an empty list if the directory does not exist." (M15 gather half).

Null-handling: ALL S1 results degrade (`.filter` semantics — each missing section replaced by a fallback line in `CODEBASE_CONTEXT`), each with a log: `log('repo research failed — personas and the author will ground themselves by reading the repo directly')`, etc. `research-cross-plan === null` → treated as `activePlans: []` with `log('cross-plan scan failed — overlap check skipped (fail-open; flagged in run summary residuals as class "fixer-failed"? NO — as an openQuestions entry: "cross-plan overlap unverified")')`. Precisely: push `'cross-plan overlap unverified (scan agent failed)'` onto `openQuestions`. When the scan returns `[]`: `log('Cross-plan scan: no other active plans — overlap check self-skipped')` (decisions row 45).

`CODEBASE_CONTEXT` template (exact):

```
<codebase-context>
Repo root: ${repo ? repo.repoRoot : 'unknown — derive with git rev-parse --show-toplevel'}
Stack & architecture:
${repo ? repo.stackDigest : '(repo research unavailable — read the repo yourself as needed)'}
Conventions:
${repo ? repo.conventionsDigest : '(unavailable)'}
Testing (harness, commands, conventions):
${repo ? repo.testingDigest : '(unavailable)'}
Relevant files: ${repo ? repo.relevantFiles.join(', ') : '(unavailable)'}
Domain glossary: ${repo && repo.contextMdPath ? repo.contextMdPath : 'none detected'}
Institutional learnings:
${learnings && learnings.digest ? learnings.digest : '(none)'}
External best practices:
${bp && bp.digest ? bp.digest : '(not researched)'}
Web research:
${web && web.digest ? web.digest : '(not researched)'}
Flow analysis:
${flow ? flow.digest + '\nEdge cases:\n' + flow.edgeCases.map((e) => '- ' + e).join('\n') : (DEPTH === 'lightweight' ? '(not run — lightweight tier)' : '(flow analysis unavailable — analyze flows yourself if relevant)')}
</codebase-context>
```

Skip and failure are distinct grounding facts: the lightweight-tier line appears ONLY when the dispatch was actually skipped (`DEPTH === 'lightweight'`); a flow agent that failed on a standard/deep run renders the unavailable line, so downstream personas/author/editor are never told a failure was a tier decision.

### 4.3 S2 — Strategy/scope gate (`phase('Gate')`) — M3

**Dispatch: `strategy-gate`.** agentType: none. model: omit (genuine top-of-pipeline reasoning, but not `opus` — inherit). Schema:

```js
const STRATEGY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: ['proceed', 'adjust', 'halt'] },
    adjustedFraming: { type: 'string', description: 'replacement framing paragraph when verdict=adjust; "" otherwise' },
    scopeDelta: { type: 'string', description: 'how research changed the scope picture vs the intake claim; "" when none' },
    loggedAssumptions: { type: 'array', items: { type: 'object', properties: { assumption: { type: 'string' }, invalidatedWhen: { type: 'string' } }, required: ['assumption', 'invalidatedWhen'] } },
    haltReason: { type: 'string', description: '"" unless verdict=halt' },
  },
  required: ['verdict', 'adjustedFraming', 'scopeDelta', 'loggedAssumptions', 'haltReason'],
}
```

Prompt skeleton: `CONFIRMED_INTENT` + `CODEBASE_CONTEXT` + `ORIGIN` (+version, read instruction) + the merged challenge brief: "Challenge the framing before anything is drafted: is this the right problem? the right architectural direction for this repo? are unvalidated assumptions baked into the intent? Apply a LOW bar to redirecting the approach (do not preserve the intake framing because it exists) and a HIGH bar to halting (halt only when proceeding would bake in a decision the requester must make). Separately, compare the research against the intake scope claim and report the scope delta: the capability already exists, the approach conflicts with the architecture, or the scope is materially larger than stated. Verdict adjust = proceed with adjustedFraming and loggedAssumptions recorded as testable assumptions."

Coordinator JS:

- `null` → fail-open, mirror sibling S17 triage: `log('Strategy gate agent failed — proceeding with unadjusted framing')`; continue.
- `proceed` → continue.
- `adjust` → `assumptions.push(...loggedAssumptions.map(a => ({ question: 'scope/framing', hypothesis: a.assumption, invalidatedWhen: a.invalidatedWhen })))`; `ADJUSTED_FRAMING = '\n<adjusted-framing>\n' + adjustedFraming + '\nScope delta: ' + scopeDelta + '\n</adjusted-framing>'`; `log('Strategy gate: adjusted framing with ' + n + ' logged assumption(s)')`. There is NO redraft branch — S2 is pre-draft by design (decisions row 16).
- `halt` → push `scopeDelta`/`haltReason` onto `openQuestions`; `return summary('halted', { haltStage: 'S2-strategy-gate', haltReason, nextStep: 'Resolve the framing question, then re-invoke nadia-plan' })`.

### 4.4 S3 — Draft (`phase('Draft')`) — M4

**Dispatch 1: `author-plan`.** agentType: `'plan-author'` (new local persona, §6.1). model: omit. Schema (evidence-bearing, NO free-prose reasoning field except `detail` which is used ONLY in `log()` — never in any later prompt; M-X1, M6):

```js
const AUTHOR_SCHEMA = {
  type: 'object',
  properties: {
    planPath: { type: 'string', description: 'repo-relative path of the written file under docs/plans/' },
    planTitle: { type: 'string' },
    slug: { type: 'string', description: 'kebab-case slug used in the filename' },
    date: { type: 'string' }, nnn: { type: 'string' },
    unitCount: { type: 'number' }, requirementCount: { type: 'number' },
    uidNamePairs: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, name: { type: 'string' } }, required: ['uid', 'name'] } },
    rIds: { type: 'array', items: { type: 'string' } },
    sectionsPresent: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string', description: 'anything noteworthy about the writing — used for logging only' },
  },
  required: ['planPath', 'planTitle', 'slug', 'date', 'nnn', 'unitCount', 'requirementCount', 'uidNamePairs', 'rIds', 'sectionsPresent', 'detail'],
}
```

Prompt skeleton (per-run grounding only — the authoring discipline lives in the persona file, sibling convention): `CONFIRMED_INTENT`; `ADJUSTED_FRAMING` (or `''`); `CODEBASE_CONTEXT`; `ORIGIN`+`ORIGIN_VERSION` + "read it fully; every requirement/decision/boundary must be addressed or explicitly deferred"; the testable-assumptions list to write into `## Assumptions` (`assumptions` array rendered as `question / hypothesis / invalidated when`); `narrowedScope` exclusions + "route these verbatim into Scope Boundaries → ### Deferred to Follow-Up Work"; `DEPTH` + unit budget ("lightweight 2–4 / standard 3–6 / deep 4–8 units"); `intake.planType`; date/NNN rules (`PLAN_DATE` or "run date +%F yourself"; "derive NNN by listing docs/plans/ and counting files dated today, zero-padded to 3"); and the full document template of §5 verbatim.

Null-handling: `null` → halt `'S3-draft'`, reason `'plan author returned null — no draft exists'`. Non-null: `planPath` recorded; `uidBaseline = { pairs: author.uidNamePairs, rIds: author.rIds }`; `unitCount`/`requirementCount` seeded from author (provisional until first checker); `log('Draft written: ' + planPath + ' (' + unitCount + ' units, ' + requirementCount + ' requirements) — ' + author.detail)`.

**Dispatch 2: `classify-personas`.** agentType: none. model: `sonnet`. Schema:

```js
const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { enum: ['plan', 'requirements'] },
    personas: { type: 'object', properties: {
      productLens: { type: 'boolean' }, designLens: { type: 'boolean' }, securityLens: { type: 'boolean' },
      scopeGuardian: { type: 'boolean' }, adversarial: { type: 'boolean' },
    }, required: ['productLens', 'designLens', 'securityLens', 'scopeGuardian', 'adversarial'] },
    reasons: { type: 'array', items: { type: 'string' }, description: 'one line per activated conditional persona' },
    ktds: { type: 'array', items: { type: 'string' }, description: 'Key Technical Decisions quoted from the document, ordered most load-bearing first' },
    loadBearingAssumptions: { type: 'array', items: { type: 'string' }, description: 'assumptions from ## Assumptions whose failure would invalidate the plan, ordered' },
  },
  required: ['documentType', 'personas', 'reasons', 'ktds', 'loadBearingAssumptions'],
}
```

Prompt: plan path + read instruction + ce-doc-review's trigger rules PORTED VERBATIM (decisions Q7), including: product-lens (challengeable premise claims OR strategic weight — either leg sufficient); design-lens (UI/UX references, frontend components, user flows, screens, interactions, responsive, accessibility); security-lens (auth/authz, externally exposed endpoints, PII/payments/tokens/credentials/encryption, third-party trust boundaries); scope-guardian (multiple priority tiers, >8 requirements, stretch goals, scope-boundary language misaligned with goals); adversarial (high-stakes domain: auth/payments/billing/migrations/privacy/compliance/external integrations/crypto; new abstraction/framework/architectural pattern; greenfield with no origin doc; explicit scope extension beyond origin; explicit alternatives or unresolved tradeoffs) — plus the negative rule verbatim: "adversarial is NOT triggered by structural complexity, and NOT for a routine plan derived from a validated origin that stays in scope and touches no high-stakes domain." Plus: "Also extract the document's Key Technical Decisions (quote them) ordered most load-bearing first, and the load-bearing entries of ## Assumptions." The selection is computed once and HELD for all rounds.

Null-handling: `null` → roster degrades to the always-on duo; `ktds = []`, `loadBearingAssumptions = []`; `log('Persona classifier failed — conditional personas and KTD refutation skipped this run (always-on coherence + feasibility only)')`; additionally push `'persona classification failed — conditional review coverage and KTD refutation did not run'` onto `openQuestions` (surfaced, not silent).

### 4.5 S4 — Review loop (`phase('Review')`) — M5/M6/M7/M8/M9/M10/M13/M20

Coordinator state initialized before the loop:

```js
let primer = []            // decision-primer entries (M20)
let carryFindings = []     // editor findings + file-overlap findings carried into the next round's synthesis
let pendingFyi = []        // anchor-50 advisories (residual class 'fyi')
let spikeDone = false      // M10 boolean guard
let ktdPasses = 0          // ≤ KTD_PASSES_CAP
let ktdDirty = false       // set when a fixer touched the KTD section
let ktdHaltUsed = 0        // ≤ KTD_HALT_CAP — majority procedures consumed by refuted-KTD findings
let refutedKtdOverflow = 0 // refuted-KTD findings beyond KTD_HALT_CAP — nonzero VOIDS any READY exit
let editorVerdict = null
let roundsUsed = 0, personaRoundsUsed = 0
let readyExit = false
```

The ONE loop (decisions Q5 — single counter, stages sequenced, never nested):

```js
for (let r = 1; r <= EDITOR_ROUNDS; r++) {
  if (belowBudgetFloor()) { log(`Budget floor reached before review round ${r} — halting with the draft as-is`); return summary('halted', { haltStage: 'S4-budget-floor', … }) }
  roundsUsed = r
  // a..g below
}
if (!readyExit) return summary('halted', { haltStage: 'S4-editor-cap', … })  // never silent fall-through
```

#### a. Personas (rounds 1..PERSONA_ROUNDS only) — M6

`if (r <= PERSONA_ROUNDS) { personaRoundsUsed = r; … }` — else the stage self-disables (`log('Round ' + r + ': editor-convergence round — persona stage disabled')`).

Roster (order fixed for determinism): always `coherence` (`compound-engineering:ce-coherence-reviewer`), `feasibility` (`compound-engineering:ce-feasibility-reviewer`); then, per the held classifier result: `product` (`…ce-product-lens-reviewer`), `design` (`…ce-design-lens-reviewer`), `security` (`…ce-security-lens-reviewer`), `scope` (`…ce-scope-guardian-reviewer`), `adversarial` (`…ce-adversarial-document-reviewer`). Cap: `roster.slice(0, PERSONA_CAP)` with a drop log (cannot fire with a 7-row roster; present for M18 discipline).

Dispatch: `parallel(roster.map(p => () => agent(reviewPrompt(p, r), { label: 'review-r' + r + '-' + p.key, phase: 'Review', agentType: p.type, schema: PERSONA_FINDINGS_SCHEMA })))`. Barrier justified: synthesis (b) needs the full round's finding set for dedup/promotion.

```js
const PERSONA_FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      section: { type: 'string' }, title: { type: 'string' },
      severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
      findingType: { enum: ['error', 'omission'] },
      confidence: { enum: [0, 25, 50, 75, 100] },
      autofixClass: { enum: ['safe_auto', 'gated_auto', 'manual'] },
      evidence: { type: 'string', description: 'verbatim quote from the document' },
      whyItMatters: { type: 'string' },
      suggestedFix: { type: 'string', description: '"" when no concrete fix exists' },
    }, required: ['section', 'title', 'severity', 'findingType', 'confidence', 'autofixClass', 'evidence', 'whyItMatters', 'suggestedFix'] } },
  },
  required: ['findings'],
}
```

`reviewPrompt(p, r)` slots — and ONLY these (no-claim-passing, M6): document path (`planPath`) + "read the document yourself" (deviation from ce-doc-review's `document_content` slot is runtime-forced: the coordinator cannot read files — note in a code comment); `documentType` from the classifier (default `'plan'` when classifier died); `ORIGIN || 'none'`; `CONFIRMED_INTENT`; `CODEBASE_CONTEXT`; `primerBlock()`; the confidence-anchor rubric (0/25/50/75/100 discrete; the same wording ce-doc-review uses); for `coherence` only, when `repo.contextMdPath` is nonempty, the glossary line (M2/decisions row 53): "A domain glossary exists at ${contextMdPath} — check the plan's vocabulary against it and flag conflicts as findings."

Null-handling: a dead persona resolves to `null` in the `parallel` array → excluded with `log('Persona ' + key + ' failed round ' + r + ' — its lens is uncovered this round')`. No retry.

#### b. Synthesis (pure coordinator JS — zero agents)

Input: all round findings (flattened) + `carryFindings` (then `carryFindings = []`). Ordered steps — the trimmed step set decisions M6 sanctions ("dedup/promotion/anchor gating"), NOT ce-doc-review's full 9-step pipeline. Deliberately dropped from the base: same-persona premise collapse, premise-dependency chain linking (≤6 dependents/root), and manual→auto promotion — these are real base steps, not interactive-only ones, and dropping chain linking has a named cost (a root premise finding and its dependents each consume separate slots under the 16-per-round refuter cap); the M8 cross-finding conflict scan in the fixer prompt is the designated partial substitute:

1. **Confidence gate**: anchor 0/25 → dropped, count logged (`'Dropped N low-anchor finding(s)'`). Anchor 50 → `pendingFyi.push(…)` as residual class `'fyi'` (advisory; never fixed, never refuted). Anchor 75/100 → actionable.
2. **Dedup**: fingerprint `norm(section) + '::' + norm(title)` where `norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()`. Merge same-fingerprint findings UNLESS both carry a nonempty `suggestedFix`, neither suggestedFix is a substring of the other, AND their `findingType` differs — such pairs are kept distinct and handed to step 5 (the ONLY keep-distinct exception; it lives HERE, not in step 5). Merged value per field: severity = max (P0 < P1 < P2 < P3 ordering); anchor = max; evidence = union (join with `' | '`); reviewers concatenated `'coherence+security'`; `suggestedFix`/`findingType`/`autofixClass`/`whyItMatters` = taken whole from the max-severity entry (tiebreak: max anchor, then lexicographically smaller `suggestedFix` — deterministic).
3. **Cross-persona promotion**: 2+ distinct reviewers on one fingerprint → anchor +1 step (50→75, 75→100; 100 stays). A 50 promoted to 75 moves from FYI to actionable (remove from `pendingFyi`).
4. **R29 primer suppression** (M20): drop a finding when a primer entry with `decision` in {`rejected-refuted`,`rejected-suppressed`,`documented`} matches its fingerprint AND the evidence overlaps — overlap test: either 300-char evidence window is a substring of the other's full evidence text ("full-text fallback": when neither contains the other, treat as NEW — keep it). Each suppression logged, and each suppressed finding flagged `rejected-suppressed` for the stage-(d) primer write (this is the step that assigns that decision class).
5. **Contradiction resolution**: consumes exactly the same-fingerprint pairs step 2 kept distinct (no other input) → one combined finding, `autofixClass: 'manual'`, `findingType: 'error'`, evidence union, framed as tradeoff.
6. **Sort**: severity (P0 first) → errors before omissions → anchor descending → fingerprint lexicographic (deterministic tiebreak; document order is unavailable to the coordinator).

Output: `actionable[]` (anchor ≥ 75). If `actionable.length === 0` and no KTD work is due, stages c–e are skipped with `log('Round ' + r + ': no actionable findings — skipping refutation and fix application')`.

#### c. Refuters — M7

**Class A — gating findings.** Gating = `severity === 'P0' || severity === 'P1' || (promoted premise: anchor was promoted in step 3 AND findingType === 'error' && autofixClass === 'manual')`. Non-gating actionable findings (P2/P3 unpromoted) skip refutation (they are not trusted to gate anything; they ride to (d)'s routing as-is — which, per decisions Q9, auto-applies them only when safe_auto@100, else documents them). Take gating findings in sorted order, `slice(0, FINDING_REFUTER_CAP)`; overflow → `residualFindings.push({ class: 'dropped-cap', reason: 'refuter cap 16/round' })` + routed document-as-known-cost (joins the fixer's documentation batch) + `log('Refuter cap: N gating finding(s) beyond 16 routed to documentation without verification')`.

Dispatch via `pipeline(gating, (f, _o, i) => agent(refutePrompt(f), { label: 'refute-r' + r + '-f' + i, phase: 'Review', model: 'sonnet', agentType: 'skeptical-refuter', schema: VERDICT_SCHEMA }))` — `pipeline` (no barrier needed; each verdict independently flips one finding). `VERDICT_SCHEMA` copied from the sibling: `{ refuted: boolean, reason: string }` (required both).

`refutePrompt(f)` slots: the finding (section/title/severity/evidence/whyItMatters/suggestedFix), `planPath` + "read the document", `CODEBASE_CONTEXT`, "where to look" hints (`relevantFiles`). Verdict handling mirrors the sibling exactly: `v && !v.refuted` → confirmed; `null` or `refuted` → finding DROPPED (fail-closed) with log (`'refuted: <reason>'` / `'refuter died — dropped per fail-closed default'`) and flagged `rejected-refuted` for the stage-(d) primer write (stage (c) only flags; (d) is the single primer-write point).

**Halt-class majority** (subset of class A, evaluated BEFORE single refutation): a finding is halt-class when `severity === 'P0' && autofixClass === 'manual' && suggestedFix === ''` (an unfixable blocking claim — the only finding species that can stop the run). At most `HALT_CLASS_CAP` per run (lifetime counter; overflow → document-as-known-cost + log). For each: `parallel` of 3 skeptical-refuters, labels `refute-halt-r${r}-f${i}-v${j}` (j = 0..2), sonnet, `VERDICT_SCHEMA`. Majority = count of `v && !v.refuted` ≥ 2 (nulls count as refuted — fail-closed on the runtime side, conservative against halting). Sustained → `openQuestions.push(title + ': ' + whyItMatters)`; `return summary('halted', { haltStage: 'S4-halt-class-finding', haltReason: '2-of-3 refuters sustained: ' + title, … })`. Refuted → dropped + logged + primer `rejected-refuted`.

**Class B — KTD/assumption refutation** (run when `r === 1 && (ktds.length || loadBearingAssumptions.length)`, and again at most once more in the first round after `ktdDirty` was set, while `ktdPasses < KTD_PASSES_CAP`): claims = `[...ktds, ...loadBearingAssumptions].slice(0, KTD_CAP)`; overflow logged (`'KTD cap: N claim(s) beyond 8 not refuted — listed in run summary openQuestions'` → push titles to `openQuestions`). Dispatch via `pipeline(claims, (k, _o, i) => agent(ktdRefutePrompt(k), { label: 'ktd-refute-p' + (ktdPasses + 1) + '-' + i, … model: 'sonnet', agentType: 'skeptical-refuter', schema: KTD_VERDICT_SCHEMA }))`.

```js
const KTD_VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { enum: ['sustained', 'refuted', 'unverifiable'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
}
```

`ktdRefutePrompt(k)` slots — enumerated, same discipline as `refutePrompt` (principle 3; two implementers must not diverge): the claim text verbatim; `planPath` + "read the document's CURRENT Key Technical Decisions and Assumptions sections — on a re-refutation pass the quoted claim may be stale: locate the CURRENT decision corresponding to this claim's head in the document and refute THAT text, not the quoted snapshot" (this covers pass-2 staleness after a fixer edited the KTD section — the claims list is extracted once, pre-mutation, by classify-personas); `CODEBASE_CONTEXT`; "where to look" hints (`relevantFiles`); and the persona's fail-closed OVERRIDE for this input class verbatim (decisions row 42): "Attempt to refute this technical decision/assumption against the actual codebase. IMPORTANT — override of your default: if you can neither confirm nor refute it from code and docs, return verdict 'unverifiable', NOT 'refuted'. Fail-if-uncertain here means surface, not auto-block."

Handling:

- `refuted` → synthesize a finding `{ section: 'Key Technical Decisions', title: 'KTD refuted: ' + claim-head, severity: 'P0', findingType: 'error', confidence: 100, autofixClass: 'manual', evidence: claim, whyItMatters: reason, suggestedFix: '' }` — deliberately HALT-CLASS-SHAPED (P0/manual/no-fix): a confirmed-wrong load-bearing decision is the strongest adversarial signal the pipeline can produce, and "sustained-refutations become blocking findings" (catalog B.4, carried into M7 by decisions row 42). It is NOT appended to the round's actionable set and is NOT routed through (d); it goes straight to the halt-class majority machinery under a DEDICATED allowance: while `ktdHaltUsed < KTD_HALT_CAP`, increment `ktdHaltUsed` and run the same 3-refuter majority procedure (labels `refute-halt-ktd-p${ktdPasses + 1}-${i}-v${j}`, sonnet, `VERDICT_SCHEMA`, nulls count as refuted). Majority sustains (≥2 not-refuted) → `openQuestions.push('KTD refuted: ' + claim-head + ': ' + reason)`; `return summary('halted', { haltStage: 'S4-halt-class-finding', haltReason: '2-of-3 refuters sustained: KTD refuted: ' + claim-head, … })`. Majority refutes (the single KTD refuter was wrong) → finding dropped + logged + flagged `rejected-refuted` for the primer. Beyond the allowance (`ktdHaltUsed === KTD_HALT_CAP`): `refutedKtdOverflow++`; title pushed to `openQuestions` AND added to the next fixer batch as a documentation entry routed to `## Open Questions` (visible in the doc); `residualFindings.push({ …, class: 'dropped-cap', reason: 'KTD halt-majority allowance (3/run) exhausted' })`; logged. A nonzero `refutedKtdOverflow` VOIDS any READY exit (see the (f) exit predicate), so such a run rides to the `'S4-editor-cap'` halt with the titles in `haltReason`. This keeps principle 4 intact in BOTH directions: no single refuter's verdict halts the run unverified (the majority arbitrates it), and no confirmed-wrong KTD can reach `status: 'ready'` as a documentation footnote.
- `unverifiable` → document-as-known-cost entry routed to `## Open Questions` (joins the fixer batch) + `openQuestions.push(...)`.
- `sustained`/`null` → nothing (`null` logged). After the pass: `ktdPasses++; ktdDirty = false`.

#### d. Reconciliation routing + batch fixer — M8

Pure-JS routing of post-refutation survivors (every finding explicitly classified, counts logged — decisions row 14):

- `fixNow` = findings with `suggestedFix !== ''` AND (`autofixClass === 'safe_auto' && confidence === 100` OR refutation-survived gating). EXACTLY decisions Q9's two authority classes — nothing else. Unrefuted non-gating P2/P3 findings with a fix (gated_auto at any anchor, safe_auto below anchor 100) do NOT auto-apply: gated_auto by definition requires a gate, and in this autonomous design the only gate is refutation survival; they route to `documentAsKnownCost` (visible as `'documented'` residuals and primer entries — not lost, just never silently applied).
- `documentAsKnownCost` = everything else surviving (no suggested fix, manual P2/P3, unrefuted gated_auto / sub-100 safe_auto P2/P3, refuter-cap overflow, unverifiable KTDs, refuted-KTD overflow entries from (c)) with a routing target each: `findingType === 'omission'` premise/scope items → `'Open Questions'`; decided-bet items (evidence references Assumptions) → `'Assumptions'`; scope disputes → `'Scope Boundaries'`. Implementer note: routing target is computed by section affinity (`section` contains `assumption` → Assumptions; contains `scope` → Scope Boundaries; else Open Questions).
- `log('Round ' + r + ': ' + fixNow.length + ' fix-now, ' + documentAsKnownCost.length + ' document-as-known-cost')`.
- If both lists are empty → skip fixer + checker (no mutation), log it, go to (f).

**Dispatch: `fix-round-${r}`.** ONE sequential batch fixer (single file — parallel fixers would race). agentType: none. model: omit. Schema:

```js
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    applied: { type: 'array', items: { type: 'string' }, description: 'titles of findings whose fixes were applied' },
    documented: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, routedTo: { enum: ['Assumptions', 'Open Questions', 'Scope Boundaries'] } }, required: ['title', 'routedTo'] } },
    unapplied: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'] } },
    sectionsTouched: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
  required: ['applied', 'documented', 'unapplied', 'sectionsTouched', 'detail'],
}
```

Prompt skeleton: `planPath`; the `fixNow` list (title/section/severity/reviewers/evidence/suggestedFix — full objects, the fixer has not seen the reviewers' reasoning beyond `whyItMatters`); the `documentAsKnownCost` list with routing targets ("append each as a documentation entry to its target section; Assumptions entries MUST name the observation that would invalidate them" — M-X2); `CONFIRMED_INTENT`; the cross-finding conflict-scan instruction (M8/decisions row 10): "Before applying anything, scan the whole batch for cross-finding tensions — two fixes that contradict each other, or a premise challenge that moots others. Return conflicting findings UNAPPLIED with the conflict named in reason."; the authority rules (decisions Q9) verbatim: "You may apply safe_auto@confidence-100 fixes and refutation-survived fixes — every entry in your fix-now list is one or the other [the coordinator marks each fixNow entry `refutationSurvived: true|false`; the routing above guarantees the list contains nothing outside these two classes, so the fixer's authority rule and the coordinator's routing can never disagree]. PROTECTED SURFACES: any change to the Requirements set, Scope Boundaries, or unit uid/Dependencies structure requires refutationSurvived=true — otherwise return it unapplied. A fix may NEVER widen scope; return scope-widening proposals unapplied with reason starting 'scope-widening:'. U-IDs and R-IDs may be ADDED (next free number, gaps fine) or deleted, NEVER renumbered or reassigned."

Coordinator JS after: `unapplied` with reason starting `scope-widening:` → `residualFindings` class `'scope-widening-routed'` + `openQuestions.push(title)`; other `unapplied` → class `'unapplied-conflict'`; `documented` → class `'documented'`; titles in neither `applied`/`documented`/`unapplied` → class `'fixer-failed'` reason `'fixer did not account for this finding'` (sibling S23 pattern). `null` fixer → ALL routed findings become `'fixer-failed'` residuals + log; the checker still runs (mutation state unknown — defensive). `ktdDirty = fix && fix.sectionsTouched.some(s => /key technical decisions/i.test(s))`.

Primer update for the round (M20) — stage (d) is the SINGLE primer-write point: stage (c) only FLAGS refutation outcomes (`rejected-refuted`) and synthesis step 4 flags R29 suppressions (`rejected-suppressed`); (d) then writes ONE entry per finding (no double entries): `{ round: r, decision: 'applied' | 'documented' | 'rejected-refuted' | 'rejected-suppressed' | 'unapplied-conflict' | 'dropped-cap' | 'fyi', section, title, reviewer, confidence, evidence: first 300 chars of evidence, word-boundary-truncated }`.

#### e. Shared post-mutation checker + JS checks — M9/M13/M-X1

Runs after EVERY plan-file mutation, anywhere in the run (fix rounds, spike revision, uid re-fix, parse fix, gate fix) — same schema, label varies (`check-r${r}`, `check-spike`, `check-refix-r${r}`, `check-parse-fix`, `check-gate-fix`).

**Dispatch: `check-r${r}`.** agentType: none. model: `sonnet` (mechanical extraction + verification). Schema:

```js
const CHECKER_SCHEMA = {
  type: 'object',
  properties: {
    fixesVerified: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, landed: { type: 'boolean' }, matchesIntent: { type: 'boolean' }, note: { type: 'string' } }, required: ['title', 'landed', 'matchesIntent', 'note'] } },
    staleFindings: { type: 'array', items: { type: 'string' }, description: 'titles among the pending findings whose section/evidence no longer matches the post-edit text' },
    uidNamePairs: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, name: { type: 'string' } }, required: ['uid', 'name'] } },
    rIds: { type: 'array', items: { type: 'string' } },
    unitFiles: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, dependsOn: { type: 'array', items: { type: 'string' } } }, required: ['uid', 'files', 'dependsOn'] } },
    unitCount: { type: 'number' }, requirementCount: { type: 'number' },
    sectionsPresent: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixesVerified', 'staleFindings', 'uidNamePairs', 'rIds', 'unitFiles', 'unitCount', 'requirementCount', 'sectionsPresent'],
}
```

Prompt skeleton: `planPath` + "read the document as it now stands"; the applied-fix list (title + suggestedFix + section) for landed/matchesIntent verification; the still-pending finding list (title + section + evidence) for staleness; "extract every unit's uid, name, Files list and Dependencies; every R-ID; counts; H2 sections present. Read-only — change nothing."

Null-handling (the ONE bounded retry in the design): retry once (`check-r${r}-retry`); still `null` → halt `'S4-post-mutation-check'`, reason `'post-mutation checker failed twice — uid stability and fix fidelity unverifiable'` (fail-closed: uid corruption silently reaching ce-work breaks dependsOn topology and resume).

Coordinator JS on the checker result, in order:

1. **Fix fidelity**: `fixesVerified` entries with `!landed || !matchesIntent` → re-open as findings into `carryFindings` for the next round (severity kept, `title` suffixed `' [fix did not land faithfully]'`), logged. (R30's blind spot covered — decisions row 7/8.) Counted against the EXPECTED set, not the returned set (M-X1): any title in the round's `applied` list with NO corresponding `fixesVerified` entry is treated as `landed: false` (reason `'checker did not account for this fix'`) and re-opened the same way — the sibling-S23 unaccounted-title pattern applied to the checker, not just the fixer.
2. **Staleness**: titles in `staleFindings` that are still in any pending list → removed + `log('N stale finding(s) dropped after edits')`.
3. **uid/R-ID stability diff** (M-X1 half, ROUND-FAILING): violation when (a) a uid present in both baseline and current carries a different name (identity swap), or (b) a baseline name appears under a different uid while its old uid vanished (renumber signature), or (c) a baseline R-ID vanished and no applied finding this round was a refutation-survived protected-surface fix. Additions and (justified) deletions are fine — gaps fine. On violation: ONE re-fix dispatch `refix-uid-r${r}` (agentType none, model omit; prompt slots: `planPath` + edit instruction, the exact diff — "restore these identities; never renumber; re-add as the same uid" — and the uid/scope-protection rules reference; like every mutating prompt, it names the file it must edit), then `check-refix-r${r}` (same checker schema); still violated (or re-checker null) → halt `'S4-uid-stability'` with the diff in `haltReason`.
4. **File-overlap cross-check** (M13): over `unitFiles`, compute every file owned by 2+ units with NO dependsOn path between them (path = transitive closure over `dependsOn`, either direction; Kahn-style reachability in plain JS). Each violation → synthesized finding `{ section: 'Implementation Units', title: 'file <f> owned by <Ua> and <Ub> without a dependency path', severity: 'P1', findingType: 'error', confidence: 100, autofixClass: 'manual', suggestedFix: '', evidence: f, whyItMatters: 'independent units sharing a file produce same-wave merge conflicts in ce-work' }` pushed onto `carryFindings`, logged.
5. **Evidence cross-check** (M-X1): update `unitCount`/`requirementCount` from checker; if the round's editor (f) later claims different counts, its READY is not trusted without arbitration (see f). Baseline update: `uidBaseline = { pairs: checker.uidNamePairs, rIds: checker.rIds }` AFTER the stability check passes.

#### f. Fresh editor verdict — M5

(Stages are lettered in EXECUTION order: the editor verdict (f) runs before the spike branch (g), which consumes its `designUnknowns`.)

**Dispatch: `editor-r${r}`.** agentType: `'plan-editor'` (new local persona, §6.2). model: omit. Fresh context each round by construction. Schema:

```js
const EDITOR_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: ['READY', 'REVISED'] },
    failureModesConsidered: { type: 'array', items: { type: 'string' }, description: 'the failure-mode classes actually examined (diagnosis-before-action)' },
    findings: PERSONA_FINDINGS_SCHEMA.properties.findings,
    blockingCount: { type: 'number', description: 'count of findings above that are P0/P1' },
    designUnknowns: { type: 'array', items: { type: 'object', properties: { unknown: { type: 'string' }, affectedUids: { type: 'array', items: { type: 'string' } }, whyDesignLevel: { type: 'string' } }, required: ['unknown', 'affectedUids', 'whyDesignLevel'] } },
    units: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, approachValidated: { type: 'boolean' }, uphill: { type: 'array', items: { type: 'string' } } }, required: ['uid', 'approachValidated', 'uphill'] } },
    evidence: { type: 'object', properties: { planPath: { type: 'string' }, unitCount: { type: 'number' }, requirementCount: { type: 'number' }, sectionsPresent: { type: 'array', items: { type: 'string' } } }, required: ['planPath', 'unitCount', 'requirementCount', 'sectionsPresent'] },
  },
  required: ['verdict', 'failureModesConsidered', 'findings', 'blockingCount', 'designUnknowns', 'units', 'evidence'],
}
```

Prompt skeleton (and ONLY these slots — never the author's or fixer's reasoning): `CONFIRMED_INTENT`; `planPath` + "read the entire document fresh"; `CODEBASE_CONTEXT`; `primerBlock()` (so the editor does not re-raise settled findings); round number + cap (`'round ${r} of ${EDITOR_ROUNDS}'`). The editor is READ-ONLY (the persona file enforces it): `REVISED` means "this plan needs revision — here are the problems", and its `findings` enter the NEXT round via `carryFindings` (refuted/fixed by stages c–d). `uphill`/`approachValidated` are review-internal trigger data ONLY — never written into the plan document (decisions row 21).

Verdict handling (counted fields only — INCLUDING a coordinator recount of the editor's own findings, so a self-report never gates alone: `const editorBlocking = (ed.findings || []).filter(x => x.severity === 'P0' || x.severity === 'P1').length`):

- `null` → counts as `REVISED` with `log('Editor died round ' + r + ' — round counts as REVISED')`; continue (no `designUnknowns` exist, so (g) is not evaluated).
- Exit predicate (M-X1 evidence-checked): `verdict === 'READY' && blockingCount === 0 && editorBlocking === 0 && designUnknowns.length === 0 && refutedKtdOverflow === 0 && evidence.planPath === planPath && evidence.unitCount === unitCount && evidence.requirementCount === requirementCount` → `readyExit = true; break`. P2/P3 editor findings on an ACCEPTED READY verdict → `residualFindings` class `'documented'` (logged, not fixed — anti-churn; by construction nothing above P2 remains, since `editorBlocking === 0`).
- READY with a blocking mismatch (`blockingCount !== editorBlocking`, or `editorBlocking > 0`) → NOT trusted — same treatment as an evidence mismatch: `log('Editor READY rejected: blocking mismatch (self-reported ' + blockingCount + ', counted ' + editorBlocking + ')')`; treated as REVISED, ALL findings (including the P0/P1s) pushed to `carryFindings` — nothing dropped silently.
- READY with `designUnknowns.length > 0` → treated as REVISED: findings pushed to `carryFindings`, spike branch (g) eligible. (Not an exit, not a drop — the missing case the three explicit bullets previously left unspecified.)
- READY with `refutedKtdOverflow > 0` → rejected + `log('Editor READY voided: ' + refutedKtdOverflow + ' refuted-KTD finding(s) exceeded the majority allowance')`; treated as REVISED. No later round can clear this state — the loop deliberately rides to the cap halt, which lists the titles.
- READY failing ONLY on count/path evidence (`blockingCount === 0 && editorBlocking === 0 && designUnknowns.length === 0 && refutedKtdOverflow === 0` but evidence mismatched) → ONE arbitration dispatch per round: `check-evidence-r${r}` (CHECKER_SCHEMA, model `sonnet`, prompt = `planPath` + the extraction half of the checker prompt only, no pending-fix lists). Non-null → update `unitCount`/`requirementCount` (and `uidBaseline`) from it and re-evaluate: evidence now matching → the READY is ACCEPTED (`readyExit = true; break`). Still mismatched, or arbitration `null` → `log('Editor READY rejected: evidence mismatch (claims ' + … + ', checker says ' + … + ')')`; treated as REVISED. This breaks the author-miscount deadlock: when no mutation ever occurred, counts are still the author's self-report, and the checker — not either self-report — owns the arbitration.
- `REVISED` → `carryFindings.push(...findings)`; if `designUnknowns.length` → spike branch (g); continue.

Cap exhaustion (loop ends, `!readyExit`): `return summary('halted', { haltStage: 'S4-editor-cap', haltReason, nextStep: 'Review the draft at <planPath>, resolve the listed concerns (or raise editorRounds), then re-invoke nadia-plan' })`, where `haltReason` is composed defensively:

- last verdict non-null → `'editor loop exhausted ' + EDITOR_ROUNDS + ' round(s) without READY — unresolved: ' + [...last verdict's P0/P1 titles, ...last verdict's designUnknowns (still-open by definition: the final round never spikes, see g), ...refuted-KTD overflow titles].join('; ')`.
- last round's editor returned `null` → `'editor failed in the final round — carried: ' + carryFindings titles` (the "last verdict's titles" source does not exist).
- every component list empty (e.g. repeated evidence-mismatch rejections with zero findings) → `'editor READY repeatedly rejected on evidence mismatch — verify counts'`.

Never a silent fall-through to S5.

#### g. Spike branch — M10 (boolean-guarded, once per run; NOT a loop)

Evaluated in the SAME round, immediately after (f), whenever the surviving (non-exit) verdict path carries `designUnknowns.length > 0`:

- `r === EDITOR_ROUNDS` → the branch does NOT dispatch — no editor round remains to consume the results, so spiking would spend ~5 agents on a document nobody re-verdicts: each unknown → `openQuestions.push(...)`; the unknowns ride into the `'S4-editor-cap'` haltReason; `log('Design unknowns on the final round — spike branch skipped (' + n + ' unknown(s) routed to Open Questions and the halt reason)')`.
- `!SPIKES_ENABLED` → each unknown routed to `## Open Questions` as a blocking-class documentation entry in the NEXT round's fixer batch + `openQuestions.push(...)` + `log('Spikes disabled by args.spikes=false — N design unknown(s) routed to Open Questions')`.
- `spikeDone` already → unknowns ride as blocking findings (`carryFindings`) — at cap they land in the halt reason.
- Else: `spikeDone = true`; `const spiked = designUnknowns.slice(0, SPIKE_CAP)`; overflow logged + routed to Open Questions (`'Spike cap: N design unknown(s) beyond 3 routed to Open Questions'`). Dispatch `pipeline(spiked, (u, _o, i) => agent(spikePrompt(u), { label: 'spike-' + i, phase: 'Review', model: 'sonnet', schema: SPIKE_SCHEMA }))`.

```js
const SPIKE_SCHEMA = {
  type: 'object',
  properties: {
    unknown: { type: 'string' },
    resolution: { enum: ['resolved', 'documented-trade-off', 'runtime-blocked'] },
    evidence: { type: 'string' }, recommendation: { type: 'string' },
  },
  required: ['unknown', 'resolution', 'evidence', 'recommendation'],
}
```

`spikePrompt` slots: the unknown (+ `affectedUids`, `whyDesignLevel` from the editor), `CODEBASE_CONTEXT`, `planPath`, and the READ-ONLY contract verbatim: "Investigate by READING code and docs only. You may NOT run tests, build the app, execute the code, or probe runtime behavior — a question answerable only at runtime returns resolution 'runtime-blocked'." Null spike → treated as `runtime-blocked` with `log()`.

Then ONE revision pass: `revise-spike` (label deliberately prefix-disjoint from the `spike-` investigation labels so the fixture table's startsWith routing can never collide; agentType none, model omit, `FIX_SCHEMA`) — prompt: `planPath`, `CONFIRMED_INTENT`, the spike results, rules: "resolved → update the affected units' Approach (and KTD rationale if implicated) per the recommendation; documented-trade-off → append a testable entry to ## Assumptions naming the invalidating observation; runtime-blocked → append to ## Open Questions. Same uid/R-ID rules as a fix round; protected surfaces (Requirements set, Scope Boundaries, uid/Dependencies structure) are OFF-LIMITS entirely — no spike result carries refutation-survived authority." `runtime-blocked` results also `openQuestions.push(...)`. Then `check-spike` (checker + full JS check battery, step e). The branch never needs to void a READY: the (f) exit predicate already rejects READY while `designUnknowns` exist, so any round that reaches (g) continues the loop, and the NEXT round's editor verdicts on the post-revision document.

### 4.6 S5 — Gates (`phase('Gates')`) — M11/M12/M13/M14/M15

Head guard: `if (belowBudgetFloor())` → halt `'S5-budget-floor'` ("plan reviewed but unverified — parse/releasability gates did not run", draft path included).

**Gate 1 — parse conformance (M11).** `UNITS_SCHEMA` copied VERBATIM from the sibling (lines 39–70 of `ce-work-deterministic.js` — byte-identical const). Dispatch `parse-plan` (model `sonnet`, schema `UNITS_SCHEMA`) with the sibling's parse prompt VERBATIM except `"${PLAN}"` → `"${planPath}"` and the version parenthetical → `(version: post-review)`; the trailing missing-file/knowledge-work sentence stays (a zero-unit return is a gate failure here). `null` → ONE re-dispatch `parse-plan-retry`; still `null` → halt `'S5-parse-gate'` reason `'parse agent failed twice'`.

JS checks over the parse (plain JS, sibling's Kahn shape): `units.length > 0`; `dependsOn` references resolve to existing uids; acyclic (Kahn with the sibling's guard-100 loop); every `unit.requirements` entry resolves to a `requirements[].id`; M13 final assert (file-overlap-without-edge over parsed units). `riskSurfaces` well-formedness is NOT a gate: unknown entries (outside `{auth,payments,migrations,crypto,public-api,deps}`) are filtered out in coordinator JS with a `log()` — fail-open, because the value is PARSER-derived (§5: "derived by the parser from files/goals"), not document text; a document fix round cannot control the parser's derivation, and the sibling never validates this set either (it only does `.includes()` lookups, lines 772–781). On ANY gate failure: ONE fix round — `parse-fix` (agentType none, model omit, `FIX_SCHEMA`; prompt = the exact violation list + `planPath` + uid rules + the gate-authority paragraph below) → `check-parse-fix` (checker + JS battery incl. uid stability vs baseline) → `parse-plan-retry` re-parse + re-run JS checks. Still failing → halt `'S5-parse-gate'` with the violation list. On success: `unitCount = parsed.units.length`, `requirementCount = parsed.requirements.length`, `slug = parsed.slug`.

**Gate-originated edit authority (parse-fix and gate-fix prompts ONLY).** The S4 fixer's protected-surfaces rule would deadlock these fixes: gate violations never carry `refutationSurvived` (they are JS-computed or checklist items, not refuted findings), yet a `dependsOn → nonexistent uid` or a Kahn cycle can ONLY be fixed by editing Dependencies, and `scope-boundaries-substantive` can ONLY be fixed by editing Scope Boundaries. These two prompts therefore REPLACE the refutationSurvived requirement with: "The listed gate violations ARE the authorization to edit Dependencies, Scope Boundaries, or Requirements — exactly as far as needed to resolve them, no further. NEVER renumber or reassign uids/R-IDs. NEVER widen scope." The full protected-surfaces paragraph appears only in the S4 round fixer (and `revise-spike` bans protected surfaces outright).

**Gate 2 — releasability checklist (M12, the host gate).** Dispatch `releasability` (agentType none, model omit). Schema:

```js
const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      id: { enum: ['scope-boundaries-substantive', 'verification-observable', 'no-design-unknown-deferred', 'no-oversized-unit', 'unit-count-within-tier', 'scenarios-final-non-tautological', 'ktd-rationale-present'] },
      pass: { type: 'boolean' }, evidence: { type: 'string' },
    }, required: ['id', 'pass', 'evidence'] } },
  },
  required: ['items'],
}
```

Prompt slots: `planPath` + read instruction; `CONFIRMED_INTENT`; `DEPTH` + tier budgets (lightweight 2–4 / standard 3–6 / deep 4–8); the seven item definitions: scope-boundaries-substantive ("real exclusions of specific functionality, not boilerplate" — M4 no-gos); verification-observable ("every requirement and per-unit Verification states an observable outcome, numeric where applicable — outcome-level, no command recipes"); no-design-unknown-deferred ("no architecture choice/unvalidated technical assumption sits in Deferred to Implementation — only execution detail belongs there"); no-oversized-unit ("a unit is oversized when its Files list exceeds ~8 files, its Goal needs an 'and' joining independent outcomes, it spans 2+ independent subsystems, or its Test scenarios mix unrelated concerns"); unit-count-within-tier; scenarios-final-non-tautological ("Test scenarios derive from requirements and match the FINAL post-review interfaces — they never just restate the Approach"); ktd-rationale-present ("every Key Technical Decision carries a rationale with trade-offs"). ALL items are blocking. Coordinator JS completeness rule (M-X1 — gates count against the EXPECTED set, never the returned set): for each of the seven enum ids, a missing item in the return is synthesized as `{ id, pass: false, evidence: 'not reported' }` and routed to the gate-fix round like any other failure — an agent returning 0–6 items can never vacuously pass. `null` → treated as all-fail with `log('Releasability agent failed — routed to the shared gate-fix round')`. The editor's READY is surfaced via `log('editor-ready-before-gates: READY in round ' + roundsUsed + ' — post-READY gate-fix mutations are covered by parse-plan-final + check-gate-fix, not by the verdict')`; it is NOT appended as an eighth checklist item: no agent re-evaluates the verdict against post-gate-fix bytes (the same "mutating after READY invalidates the verdict" objection decisions row 48 treated as decisive), the §3 return contract has no releasability field to carry it, and the `id` enum has exactly seven values.

**Gate 3 — origin coverage (M14, conditional `ORIGIN !== ''`).** Dispatch `origin-coverage` (agentType none, model `sonnet`). Schema:

```js
const ORIGIN_COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, status: { enum: ['addressed', 'deferred', 'omitted'] }, evidence: { type: 'string' } }, required: ['heading', 'status', 'evidence'] } },
    omissions: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, fromSection: { type: 'string' }, detail: { type: 'string' } }, required: ['item', 'fromSection', 'detail'] } },
  },
  required: ['sections', 'omissions'],
}
```

Prompt: `ORIGIN` + `ORIGIN_VERSION` + "walk the origin document section by section; confirm each requirement/decision/boundary is addressed or explicitly deferred in the plan at ${planPath}; do NOT take the plan's word — check the plan text. Your sections[] walk is the evidence of work: return one entry per origin section"; independence note: it never sees the author's claims. `null` → fail-uncertain: `openQuestions.push('origin coverage unverified (verifier failed)')` + log; NOT a halt (coverage was reviewed by personas too); skipped entirely (no dispatch) when no origin, with `log('Origin coverage skipped: no origin doc')`. Vacuous-return rule (M-X1): when `ORIGIN` is set, a return with `sections.length === 0` is treated EXACTLY like `null` (verifier failure: openQuestions entry + log) regardless of `omissions` — `omissions: []` alone is not evidence of coverage; a verifier that read nothing must not pass the gate. Same rule applies to `origin-coverage-retry`.

**Gate 4 — cross-plan overlap (M15, pure JS).** When `activePlans.length === 0` → already logged at S1. Else compute `overlaps = activePlans.map(p => ({ path: p.path, files: intersect(p.files, union of parsed unit files) })).filter(o => o.files.length)`; shared riskSurfaces logged as advisory only. Each overlap → documentation entry for the gate-fix round (`'Open Questions'`) + `openQuestions.push('overlaps active plan ' + path + ' on: ' + files.join(', '))` + log.

**Shared gate-fix round (boolean, ONCE).** Inputs: releasability failures + origin omissions + cross-plan overlap entries. If all empty → proceed. Else dispatch `gate-fix` (agentType none, model omit, `FIX_SCHEMA`; prompt: `planPath`, `CONFIRMED_INTENT`, the three input groups with instructions — fix releasability failures substantively; address or explicitly defer each origin omission; append overlaps to Open Questions; uid/scope-protection rules) → `check-gate-fix` (checker + JS battery) → re-verify ONLY what failed: `releasability-retry` (when gate 2 had failures) and/or `origin-coverage-retry` (when gate 3 had omissions). Then, because the document mutated after the parse, re-dispatch `parse-plan-final` + JS checks (the consumer's parser must bless the FINAL bytes — total parse dispatches ≤ 3 per run, bounded). Any retry still failing → halt `'S5-releasability'` or `'S5-origin-coverage'` (or `'S5-parse-gate'` if the final parse breaks) with per-item failures in `haltReason`. Gate-fix `null` → same halts (nothing was fixed).

### 4.7 S6 — Finalize (`phase('Finalize')`) — M16/M17

Budget guard: `if (belowBudgetFloor())` → skip commit + hygiene with logs; return `'ready'` with `planVersion: null`, `hygieneClean: null`, nextStep noting the unverified workspace.

**Optional commit (first, so the hygiene gate can verify it).** Only when `COMMIT === true`: dispatch `commit-plan` (agentType none, model `sonnet`). Schema `COMMIT_SCHEMA = { type:'object', properties: { committed: {type:'boolean'}, sha: {type:'string'}, filesInCommit: {type:'array', items:{type:'string'}}, detail: {type:'string'} }, required: ['committed','sha','filesInCommit','detail'] }`. Prompt: "git add ${planPath} (by name, nothing else) && git commit -m 'docs(plans): add ${slug} plan'. Report the sha and `git show --name-only` file list. If the working tree contains other changes, do NOT stage them." `null`/`committed:false` → `committed = false` + log; run still returns `'ready'` (the file exists). `filesInCommit` not exactly `[planPath]` → `log('WARNING: commit contains more than the plan file')` + `hygieneClean` forced `false` later. When `COMMIT === false`: `log('Commit skipped: args.commit !== true — the run summary nextStep carries the commit command')`.

**Hygiene tail gate (M16).** Dispatch `hygiene` (agentType none, model `sonnet`). Schema `HYGIENE_SCHEMA = { type:'object', properties: { onlyPlanChanged: {type:'boolean', description:'true when git status shows no tracked change outside the plan file (and, when a commit was just made, the tree is clean)'}, changedFiles: {type:'array', items:{type:'string'}}, planVersion: {type:'string', description:'git hash-object of the plan file'}, detail: {type:'string'} }, required: ['onlyPlanChanged','changedFiles','planVersion','detail'] }`. Prompt: "Run git status --porcelain at the repo root. Report every tracked-file change. onlyPlanChanged = true iff nothing outside ${planPath} changed (untracked files outside docs/plans/ count as violations). Compute planVersion with git hash-object ${planPath}. Read-only — change nothing, stage nothing." Handling: `null` → `hygieneClean = null`, `planVersion = null`, `log('Hygiene gate failed — workspace state and planVersion unverified')`. `onlyPlanChanged === false` → `hygieneClean = false`, `log('WARNING: files outside the plan changed during the run: ' + changedFiles.join(', ') + ' — inspect before committing')`; commit was already conditional, status stays `'ready'` (late-phase graceful degradation; the violation is loud in the summary). Else `hygieneClean = true`, `planVersion` recorded.

Return `summary('ready', { nextStep: … per §3 })`.

### 4.8 Every loop and its bound (implementer checklist)

| Loop / fan-out | Bound | Guard | Exit predicate (counted fields only) | Logged per round | Escalation |
|---|---|---|---|---|---|
| S4 editor loop (ONLY counter) | `EDITOR_ROUNDS` ∈ 1..5 | `belowBudgetFloor()` at head | `verdict==='READY' && blockingCount===0 && editorBlocking===0 && designUnknowns.length===0 && refutedKtdOverflow===0 && evidence matches (arbitrated ≤1/round on pure count mismatch)` | round number, finding counts, fix/document counts, verdict | halt `'S4-editor-cap'` |
| Evidence arbitration | ≤1 `check-evidence-r${r}`/round | only on READY failing solely on counts | counts updated from checker | logged | — |
| Persona stage | rounds 1..`PERSONA_ROUNDS`; ≤8/round | self-disables (not a counter) | — | roster + failures | — |
| Finding refuters | ≤16/round | severity-ordered slice | — | drops → document-as-known-cost | — |
| Halt-class majority | 3 refuters × ≤3 generic findings/run | lifetime counter (`HALT_CLASS_CAP`) | sustained = ≥2 not-refuted | every procedure | halt `'S4-halt-class-finding'` |
| Refuted-KTD majority | 3 refuters × ≤3 refuted-KTD findings/run | dedicated counter (`KTD_HALT_CAP`); overflow → `refutedKtdOverflow` voids READY | sustained = ≥2 not-refuted | every procedure + overflow | halt `'S4-halt-class-finding'` (or rides to `'S4-editor-cap'`) |
| KTD refuters | ≤8/pass, ≤2 passes/run | `ktdPasses` | — | overflow → openQuestions | — |
| Spike branch | once/run, ≤3 spikes + 1 revision; never on the final round | `spikeDone` boolean + `r === EDITOR_ROUNDS` skip | — | overflow + runtime-blocked + final-round skip | unknowns ride to cap halt |
| uid re-fix | 1 dispatch + 1 re-check | — | stability diff clean | the diff | halt `'S4-uid-stability'` |
| Checker retry | 1 retry | — | non-null | — | halt `'S4-post-mutation-check'` |
| Parse gate | ≤3 parse dispatches, 1 fix round | — | JS checks all pass | violations | halt `'S5-parse-gate'` |
| S5 shared gate-fix | 1 round + per-gate retry | — | retries pass | per-item failures | halt `'S5-releasability'` / `'S5-origin-coverage'` |
| S1 fan-out | ≤6 | roster construction | — | every skip/exclusion | degrade |

Budget envelope, recomputed honestly from the caps above (per-round vs lifetime): S0–S3 ≤ 10. S4 per persona round worst ≈ 30 (7 personas + 16 refuters + fixer + checker/retry + uid re-fix/re-check + editor + evidence arbitration); per convergence round worst ≈ 23; lifetime S4 extras ≤ ~39 (halt-class 9 + KTD refuters 16 + refuted-KTD majorities 9 + spike branch 5). Default args (editorRounds 3, reviewRounds 2) worst ≈ 10 + 2×30 + 23 + 39 + S5 ≤ 13 + S6 ≤ 2 ≈ **145**; absolute worst (editorRounds 5, reviewRounds 3, every cap saturated) ≈ **200**; typical ≈ **45**. All far inside the 1000-agent lifetime ceiling (constraints §2); the largest single `parallel()` is the 7-persona fan-out, far under the concurrency cap. Note: the 30000-token `BUDGET_FLOOR` covers roughly ONE worst-case stage, not a worst-case round — it is a last-resort brake, not a per-round budget. (decisions.md §4's "worst ≈ 90" was computed at lighter per-round assumptions and predates the refuted-KTD majority allowance; this figure supersedes it as arithmetic only — no cap or mechanism changes.)

---

## 5. The plan-document template (byte-compatible with ce-plan — decisions Q13)

NO sections outside ce-plan's section catalog, NO new fields, NO appetite frontmatter, NO Size lines, NO hill positions, NO checkpoints, NO parallelization annotations, NO mandatory file map, NO test-strategy section, NO second artifact. Review-internal data (uphill, approachValidated, primer) lives in agent schemas and the run summary only. (Decisions Q13 bans INVENTED sections — "byte-compatible with ce-plan's section catalog" — it does not subset the base catalog; the include-when-material list below is part of that catalog.)

The author writes this shape as the hard floor (template embedded verbatim in the author prompt — the minimum, not the maximum):

```markdown
---
title: "<type>: <Plan title>"
type: <feat|fix|refactor|chore|docs|perf|test>     # from intake.planType
status: active
date: <YYYY-MM-DD>
origin: <origin path>                               # ONLY when args.origin was provided
---

## Summary
<1–3 lines, forward-looking: what this plan proposes.>

## Problem Frame
<Why the work is being done, backward-looking. May merge into Summary for lightweight plans.>

## Requirements
R1. <observable, numeric-where-applicable requirement text>
R2. …
<R-IDs plain (`R1.`, not bolded), stable, continuous; grouped by concern only when spanning distinct areas.>

## Key Technical Decisions
- <decision>: <rationale naming trade-offs and rejected alternatives>

## Implementation Units

### U1. <Name>
**Goal**: <one meaningful change ≈ one atomic commit>
**Requirements**: R1, R3            <!-- optional field -->
**Dependencies**: none | U1, U2
**Files**: `path/a`, `path/b`       <!-- repo-relative -->
**Approach**: <how, no implementation code, no git commands, no exact test recipes, no RED/GREEN/REFACTOR>
**Execution note**: <optional>
**Patterns to follow**: <existing repo patterns by path>
**Test scenarios**:
- <scenario derived from requirements — never a restatement of the Approach>
**Verification**: <observable outcome a validator can check>

### U2. …

## Scope Boundaries
- <specific functionality declared out of bounds — substantive, never boilerplate; MANDATORY non-empty>

### Deferred to Follow-Up Work
- <narrowedScope exclusions verbatim + tangential work discovered while planning>

## Assumptions
- <hypothesis> — invalidated when: <the observation that would invalidate it>
<!-- always present in nadia-plan output (headless mode); every entry MUST carry its invalidating observation (M-X2) -->

## Deferred to Implementation
- <execution-detail questions ONLY — never design-level unknowns (releasability gate enforces)>

## Open Questions
<!-- only when entries exist: unverifiable KTDs, refuted KTDs beyond the majority allowance, runtime-blocked spikes, cross-plan overlaps, scope-widening proposals -->
```

**Include-when-material sections (ce-plan's own catalog — PERMITTED, never required).** A Standard/Deep nadia-plan output must be able to look like a sibling of a ce-plan-produced deep plan; catalog A.1 Phase 3 makes "high-level technical design when material" part of the base methodology, and its Phase 5 pre-write checklist audits HTD presence. The author MAY add, per the base inclusion rules: `## High-Level Technical Design` (when the approach has shape prose alone doesn't carry — Mermaid in markdown); `## System-Wide Impact` (cross-cutting concerns: data lifecycles, auth boundaries, performance, shared infrastructure); `## Risks & Dependencies` (real risks with mitigations, material upstream dependencies); `## Acceptance Examples` (when requirements have conditional shape); `## Documentation / Operational Notes` (monitoring, runbooks, rollout); `## Sources / Research` (research breadcrumbs). All are additive markdown that the sibling's parse prompt ignores (it extracts only the mapped headings below) — parser-safe by construction. The "no new sections" ban applies to sections OUTSIDE this catalog.

Heading-by-heading parse mapping (why this passes the sibling's `UNITS_SCHEMA` prompt): `planTitle` ← frontmatter title; `slug` ← derived by the parser from the title; `requirements` ← `## Requirements` R-ID bullets; `deferredQuestions` ← `## Deferred to Implementation`; `scopeBoundaries` ← `## Scope Boundaries`; `units[*]` ← `### U<n>.` headings with the bold fields (uid/name/goal/dependsOn/files/approach/patterns/testScenarios/verification all populated — `dependsOn: []` rendered as `**Dependencies**: none`); `riskSurfaces` ← derived by the parser from files/goals. Rendering rules: repo-relative paths; ASCII identifiers; no HTML; `---` rule between H2 sections for standard/deep; plain ID prefixes.

Writer-agent rules (enforced via the plan-author persona + prompt):

- **Path**: `docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md`. Date = `args.date` else the agent's own `date +%F`. NNN = (count of `docs/plans/` files — `.md` and `.html` — dated today) + 1, zero-padded to 3. The author creates `docs/plans/` if missing.
- **U-ID authority** (decisions Q11): the plan-author owns initial assignment (U1..Un, sequential). Every later mutating agent (fixer, spike revision `revise-spike`, parse-fix, gate-fix) may ADD `U<max+1>` (gaps fine after deletions) or DELETE, NEVER renumber or reassign; uid→name identity pairs must not swap. Same regime for R-IDs.
- The author touches ONLY the plan file (M16); everything it needs to read is read-only.

---

## 6. New persona files

Two files, in the existing persona format (frontmatter `name`/`description`(/`tools`), then second-person prose). `agents/` is symlinked into `.claude/agents`, so `agentType: 'plan-author'` / `'plan-editor'` resolve like `'task-splitter'` does.

### 6.1 `/home/vadim/Code/nadia/agents/plan-author.md` (full content)

```markdown
---
name: plan-author
description: Writes a complete ce-plan-format plan document from a Confirmed Intent block, research context, and an optional origin doc. Owns initial U-ID/R-ID assignment, derives its own date and sequence number, and writes exactly one file under docs/plans/. The only file it may create or modify is the plan file.
tools: Read, Grep, Glob, Bash, Write, Edit
---

You author one implementation plan document. Your brief carries the locked
Confirmed Intent, the codebase context, the document template, the depth tier
with its unit budget, assumptions to record, and (sometimes) an origin document
path. You write exactly ONE file — the plan — and nothing else. NEVER write
implementation code, run tests, or modify any other file.

Own the first plan. Do the architectural and semantic thinking NOW; do not rely
on the downstream review loop to find the real gaps. Cover the parts most
likely to be wrong or missing: user-visible behavior, contracts and invariants,
tricky boundaries, cutover and regression risk.

Decomposition discipline:

- Map the dependency graph first, then cut units as VERTICAL slices, each
  delivering working, observable functionality. Horizontal layering (all
  schema, then all logic, then all UI) is an anti-pattern — do not do it.
- One unit ≈ one meaningful change ≈ one atomic commit. A unit is oversized
  when its Files list exceeds ~8 files, its Goal needs an "and" joining
  independent outcomes, it spans 2+ independent subsystems, or its Test
  scenarios mix unrelated concerns. Split oversized units. The cap exists for
  plan reviewability and atomic commits — NOT context fitting; the execution
  pipeline has its own task splitter.
- Where real dependencies leave ordering freedom, shape Dependencies and unit
  numbering so the approach-riskiest units land in the earliest legitimate
  waves. NEVER add artificial Dependencies edges; put risk rationale in
  Approach prose.
- Units sharing an API contract get a preceding contract-defining unit both
  depend on. Migrations and shared-state units sit on Dependencies chains,
  never as parallel-independent units. No file may be owned by two units
  unless a Dependencies path connects them.
- Assign U-IDs U1..Un once; they are permanent. R-IDs likewise.

Content discipline:

- Requirements and per-unit Verification state OBSERVABLE outcomes, numeric
  where applicable — outcomes a validator could check, never vague adjectives,
  never command recipes.
- Test scenarios derive from requirements; a scenario that merely restates the
  Approach is worthless — write what must be observably true, including
  failure and edge cases.
- Scope Boundaries is mandatory and substantive: name specific functionality
  that is OUT. Route excluded request parts and tangential discoveries to
  "### Deferred to Follow-Up Work".
- Every ## Assumptions entry must name the observation that would invalidate
  it.
- Defer only execution-detail questions to "Deferred to Implementation";
  design-level unknowns (architecture choices, unvalidated technical
  assumptions) must be resolved in the plan or surfaced in Open Questions.
- Key Technical Decisions carry rationale with trade-offs and rejected
  alternatives.

Mechanics: derive the date (use the brief's date, else run `date +%F`); derive
NNN by listing docs/plans/ and counting today's files (zero-padded 3); write to
docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md following the
brief's template, adding the include-when-material sections the brief lists
(High-Level Technical Design, System-Wide Impact, Risks & Dependencies,
Acceptance Examples, Documentation/Operational Notes, Sources/Research) when
their stated inclusion rules fire — and NEVER any section outside that
catalog. Report the evidence fields your brief's schema asks for, honestly —
they are cross-checked against an independent parse.
```

### 6.2 `/home/vadim/Code/nadia/agents/plan-editor.md` (full content)

```markdown
---
name: plan-editor
description: Whole-plan diagnostician for a bounded review loop. Reads the current plan fresh, enumerates every failure mode before choosing a verdict, and returns READY or REVISED with structured findings, design unknowns, and per-unit confidence. Read-only — it never edits the plan; fixes are applied and verified by other agents.
tools: Read, Grep, Glob, Bash
---

You judge whether one plan document is execution-ready. Your brief carries the
locked Confirmed Intent, the plan path, codebase context, a decision primer of
already-settled findings, and the round number. You read the ENTIRE document
fresh and judge it on your own reading. You are READ-ONLY: never modify the
plan or any other file.

You are judged on VERDICT CORRECTNESS, not on whether you found something.
An unnecessary rewrite is a failure. Missing a real problem is a failure.
READY means: unchanged, execution-ready, you would stake the run on it.
REVISED means: you found real problems that must be fixed before execution.

Diagnose before you act. Enumerate EVERY way executing this plan could fail —
do not stop at the first issue; find them all, then act proportionately:

- wrong problem or missed intent vs the Confirmed Intent block
- false assumptions about the repo (claims that do not match the code)
- incorrect contracts or interfaces between units
- missing edge cases or failure paths
- unsafe sequencing (a unit depending on work a later unit does)
- weak or unobservable verification text
- oversized units (Files > ~8, "and" in the Goal, 2+ subsystems, mixed
  scenario concerns)
- horizontal slicing instead of vertical slices
- test scenarios that are stale against the FINAL interfaces or merely
  restate the Approach (tautological)
- design-level unknowns hiding in Deferred to Implementation
- ## Assumptions entries that do not name the observation that would
  invalidate them (every entry must carry its invalidating observation)

Report design-level unknowns in designUnknowns (architecture choices,
unvalidated technical assumptions, misunderstood dependencies — things that
must be resolved BEFORE execution). Execution-detail deferrals are fine and
are not design unknowns. For each unit report approachValidated and, when not
validated, name the open unknowns in uphill.

Do not re-raise findings the decision primer marks as applied or rejected
unless the document text they referenced has materially changed. Fill the
evidence block (plan path, unit count, requirement count, sections present)
from your own reading — it is cross-checked; a READY verdict with wrong
evidence is discarded.
```

No other new personas: the seven reviewers + five researchers ride the verified `compound-engineering:*` agentTypes; the refuter reuses `agents/skeptical-refuter.md` (with the KTD prompt override delivered in the prompt, not a file change); fixer/checker/gates are plain prompts (decisions Q6).

---

## 7. Test plan — `/home/vadim/Code/nadia/workflows/nadia-plan.test.mjs`

### 7.1 Harness boilerplate (copy from the sibling, byte-for-byte where possible)

- Same injection contract: `readFileSync('nadia-plan.js')`, strip `export const meta = `, `AsyncFunction('args','agent','parallel','pipeline','phase','log','budget','workflow', src)`.
- Same `makeRuntime(dispatcher, { budgetTotal, costPerCall = 10000 })` (agent→null on error, `__hardThrow` escape, parallel/pipeline fakes, budget object).
- Same `S(name, fn)` scenario list + runner + exit code.
- `makeDispatcher(overrides, opts)` routes by LABEL PREFIX with `__hardThrow` on unhandled labels. Default fixture table (the "strong plan" happy path):

| Label (prefix) | Default return |
|---|---|
| `intake` | `INTAKE()` fixture: clean confirmedIntent, no blocking, 1 decidable, `split.isMultiple:false`, depthTier `standard`, planType `feat`, research `{bestPractices:false, web:false}`, `nonCodeDeliverable:false` |
| `research-repo` | repoRoot `/repo`, digests, `contextMdPath: ''` |
| `research-learnings` | `{ digest: '', sources: [] }` |
| `research-flow` | `{ digest: 'flows ok', edgeCases: [] }` |
| `research-cross-plan` | `{ activePlans: [] }` |
| `strategy-gate` | `{ verdict: 'proceed', adjustedFraming: '', scopeDelta: '', loggedAssumptions: [], haltReason: '' }` |
| `author-plan` | `AUTHOR()` fixture: planPath `docs/plans/2026-06-10-001-feat-test-plan.md`, 4 units U1..U4, 2 R-IDs, sectionsPresent (full hard floor), `detail: 'AUTHOR-REASONING-SENTINEL'` |
| `classify-personas` | duo only (`personas` all false), `ktds: []`, `loadBearingAssumptions: []` |
| `review-` | `{ findings: [] }` |
| `refute-` / `ktd-refute-` | `{ refuted: false, reason: 'confirmed' }` / `{ verdict: 'sustained', reason: '' }` |
| `fix-round-` / `revise-spike` / `parse-fix` / `gate-fix` | `FIX_OK()`: applied = echo of titles, `documented: []`, `unapplied: []`, `sectionsTouched: []` |
| `check-` | `CHECKER()` mirroring AUTHOR uids/rIds/counts, `staleFindings: []`, `fixesVerified` all landed |
| `editor-r` | `{ verdict: 'READY', blockingCount: 0, findings: [], designUnknowns: [], units: [...validated], failureModesConsidered: [...], evidence: matching counts }` |
| `spike-` | `{ resolution: 'resolved', ... }` |
| `parse-plan` | `PARSED()`: valid UNITS fixture (acyclic U1..U4, R-IDs resolve, riskSurfaces `[]`, distinct files) |
| `releasability` | all 7 items pass |
| `origin-coverage` | `{ sections: [{ heading: 'Goals', status: 'addressed', evidence: 'plan §Summary' }], omissions: [] }` (non-vacuous: an empty `sections` walk is a verifier failure when origin is set) |
| `hygiene` | `{ onlyPlanChanged: true, changedFiles: [], planVersion: 'abc123', detail: '' }` |
| `commit-plan` | `{ committed: true, sha: 'deadbee', filesInCommit: ['docs/plans/…'], detail: '' }` |

`ARGS = { request: 'add a widget exporter' }`.

### 7.2 Scenarios (S1..S24 — M19 families: threshold, convergence, halt-at-cap, prompt-content)

1. **S1 happy path / anti-churn THRESHOLD**: default dispatcher (strong plan). Asserts: `status==='ready'`; `roundsUsed===1`; `personaRoundsUsed===1`; NO `fix-round-` or `check-r` calls (zero findings → no mutation, no churn); persona agentTypes are the plugin strings (`review-r1-coherence` → `compound-engineering:ce-coherence-reviewer`, `review-r1-feasibility` → `…ce-feasibility-reviewer`); `editor-r1` agentType `plan-editor`; `author-plan` agentType `plan-author`; `parse-plan` model sonnet; result.planPath/planVersion/unitCount===4/requirementCount===2; `nextStep` contains both `git add` (commit:false default) and `ce-work-deterministic` and `planVersion`; phases sequence Intake>Research>Gate>Draft>Review>Gates>Finalize.
2. **S2 preflight throws**: (a) `args:{}` → `/requires args\.request/`; (b) `depth:'huge'` → `/depth must be one of/`; (c) `date:'June 10'` → `/YYYY-MM-DD/`. Asserts zero agent calls in each.
3. **S3 blocking unknowns → structured halt**: intake returns 2 blocking → `status==='halted'`, `haltStage==='S0-blocking-unknowns'`, `openQuestions.length===2`, `planPath===null`, NO `research-` calls ever dispatched, never throws.
4. **S4 strategy gate**: (a) `adjust` → run proceeds, author prompt contains `<adjusted-framing>` and the logged assumption reaches the author's assumptions slot; log matches `/adjusted framing/`. (b) `halt` → `haltStage==='S2-strategy-gate'`, no `author-plan` call. (c) gate dies (throw) → run proceeds + log `/Strategy gate agent failed/` (fail-open, sibling-S17 mirror).
5. **S5 weak plan CONVERGES within cap**: round-1 `review-r1-coherence` returns one P1 finding with a suggestedFix; refuter confirms; fixer applies; checker verifies; `editor-r1` returns REVISED with one P2 `safe_auto` finding at confidence 100 (with suggestedFix), `blockingCount:0`. Round 2: personas clean; the carried P2 (safe_auto@100) routes to fixNow per decisions Q9 — no refutation needed, and no other class auto-applies; it is fixed and checker-verified; `editor-r2` returns READY with matching evidence → `status==='ready'`, `roundsUsed===2`. Asserts the round-2 fixer prompt contains the editor's carried finding title, and the label ordering `review-r1-* < refute-r1-f0 < fix-round-1 < check-r1 < editor-r1 < review-r2-* < fix-round-2 < check-r2 < editor-r2`. Variant (b): the carried P2 is `gated_auto` (any anchor) instead → it does NOT reach `fix-round-2`'s fix-now list; it appears in the documentation batch and lands as a `'documented'` residual (unrefuted gated_auto never auto-applies).
6. **S6 cap exhausted → structured halt, never silent**: editor always REVISED (`blockingCount:1`, one P0 finding w/ suggestedFix so refute+fix keep cycling). `editorRounds: 3` → `status==='halted'`, `haltStage==='S4-editor-cap'`, `haltReason` includes the unresolved title, `roundsUsed===3`, log matches `/without READY/`, result.planPath still set (draft preserved). Also: `editorRounds: 99` clamps to 5 (`roundsUsed===5`); `editorRounds: 0` falls back to the default 3 (`roundsUsed===3` — `0` is falsy under the decided `args.editorRounds || 3` form, decisions Q5, mirroring sibling line 34); `editorRounds: -2` clamps to 1 (the lower clamp is reachable only via negative/sub-1 values). Same convention asserted for `reviewRounds: 0` → default 2 in S20.
7. **S7 refuter kills a finding (+fail-closed null)**: persona returns 2 P1 findings; `refute-r1-f0` → `{refuted:true}`, `refute-r1-f1` → throws (null). Asserts: NO fixer dispatch (both findings dead), log matches `/refuted/` and `/fail-closed|dropped/`, primer suppresses re-raise: round-2 persona returns the same f0 finding (same section/title/evidence) → synthesis drops it, fixer round 2 never sees it (R29 — assert via absence in any `fix-round-2` prompt) — this also covers **S22's** suppression family.
8. **S8 halt-class majority**: persona returns a P0/manual/no-suggestedFix finding. (a) 3 `refute-halt-r1-f0-v*` dispatched; 2 sustain → `status==='halted'`, `haltStage==='S4-halt-class-finding'`, finding title in `openQuestions`. (b) 2-of-3 refute → finding dropped, run completes `'ready'`, log `/refuted/`. (c) 4 such findings → only 3 majority procedures (label count), 4th routed `dropped-cap` + logged.
9. **S9 uid-stability violation ROUND-FAILING**: round-1 fixer applies; `check-r1` returns U2 renamed (identity swap). (a) `refix-uid-r1` dispatched (prompt contains the swapped pair), `check-refix-r1` clean → run proceeds to ready. (b) re-check still swapped → `status==='halted'`, `haltStage==='S4-uid-stability'`, `haltReason` mentions U2.
10. **S10 parse-conformance gate failure + bounded fix**: `parse-plan` returns U3 dependsOn `['U9']` (unresolvable). Asserts: `parse-fix` dispatched with the violation text, `check-parse-fix` ran, `parse-plan-retry` re-parsed; (a) retry clean → ready; (b) retry still broken → `haltStage==='S5-parse-gate'`, log lists violations. (c) cycle fixture (U1→U2→U1) caught by Kahn; (d) parse returns zero units → same fix path.
11. **S11 budget-floor degradation**: `costPerCall:10000`; tune `budgetTotal` so the floor trips at the round-2 head → `status==='halted'`, `haltStage==='S4-budget-floor'`, log `/Budget floor reached before review round 2/`, draft path in result. Second variant: floor trips entering S5 → `haltStage==='S5-budget-floor'`. Third: floor trips entering S6 → `status==='ready'` with `planVersion===null`, `hygieneClean===null`, logs for skipped hygiene/commit.
12. **S12 no-silent-caps logs**: (a) persona returns 20 gating P1 findings → exactly 16 `refute-r1-*` labels, log `/beyond 16/`, 4 residuals class `dropped-cap`; (b) the unconditional `/ce-framework-docs-researcher/` log present on every run (assert in S1 too); (c) `externalResearch:false` → no `research-best-practices`/`research-web` labels + log `/externalResearch === false/`; (d) editor returns 5 designUnknowns → 3 `spike-` labels, log `/beyond 3/`.
13. **S13 prompt hygiene + no-claim-passing**: happy path with every optional branch on (origin set, KTDs present). Asserts for EVERY dispatched prompt: no `/undefined|\[object Object\]|<PLACEHOLDER>|\$\{/`. Plus M6: no `review-`, `editor-`, `refute-` prompt contains `AUTHOR-REASONING-SENTINEL` (the author's `detail` value); review prompts DO contain `<confirmed-intent>` and the plan path; round-1 review prompts contain `<decision-primer>none — first round</decision-primer>`.
14. **S14 commit:false vs commit:true vs hygiene violation**: (a) default → no `commit-plan` label, `committed===false`, nextStep has the commit hint; (b) `commit:true` → `commit-plan` before `hygiene`, `committed===true`, nextStep is the bare ce-work invocation; (c) `commit:true` + hygiene `onlyPlanChanged:false` → `hygieneClean===false`, WARNING log, status still `'ready'`; (d) commit agent dies → `committed===false`, ready, log.
15. **S15 spike branch**: editor-r1 REVISED with 2 designUnknowns. Asserts: 2 `spike-` calls (model sonnet, prompt contains `/READ|read/ … /may NOT run tests/`), `revise-spike` then `check-spike` dispatched, round 2 editor READY → ready with `roundsUsed===2`; `spike-` prompts carry the unknown text + affectedUids. (b) one spike `runtime-blocked` → its text lands in `openQuestions` and the revision prompt routes it to Open Questions. (c) `spikes:false` → no `spike-` labels, unknowns in `openQuestions`, log `/Spikes disabled/`. (d) second editor designUnknowns at round 2 (spikeDone) → no second spike batch; at cap → unknowns in `haltReason`. (e) FINAL-round unknowns (`editorRounds:1`, editor-r1 REVISED with designUnknowns) → NO `spike-`/`revise-spike` labels at all, log `/spike branch skipped/`, unknowns in both `openQuestions` and `haltReason`. (f) editor-r1 READY but with 1 designUnknown → treated as REVISED (spike branch fires, findings carried), `roundsUsed===2` on a clean round-2 READY.
16. **S16 releasability failure → shared gate-fix → retry**: `releasability` fails `scope-boundaries-substantive`. Asserts `gate-fix` prompt contains the failed item + evidence (and the gate-authority text authorizing Scope Boundaries edits, NOT the refutationSurvived requirement), `check-gate-fix` ran, `releasability-retry` dispatched, `parse-plan-final` re-parsed; (a) retry passes → ready; (b) retry fails → `haltStage==='S5-releasability'` with the item id in `haltReason`; (c) `releasability` returns only 6 of the 7 enum ids → the missing id is synthesized `{pass:false, evidence:'not reported'}` and the `gate-fix` prompt contains it (no vacuous pass on a partial return).
17. **S17 origin coverage conditional**: (a) `args.origin` set → `origin-coverage` dispatched (prompt contains origin path AND `originVersion` when given); omission returned → `gate-fix` prompt contains it; `origin-coverage-retry` after fix. (b) no origin → label never dispatched + log `/no origin doc/`. (c) origin-coverage dies → ready still possible, `openQuestions` contains `/origin coverage unverified/`. (d) origin set + verifier returns `sections: [], omissions: []` → treated exactly like (c): `openQuestions` entry, log, no gate-fix from this source (a vacuous walk never passes the gate).
18. **S18 cross-plan overlap**: (a) `research-cross-plan` returns an active plan sharing `src/u1.js` with parsed U1 → `gate-fix` prompt routes it to Open Questions, `openQuestions` contains the path; (b) empty scan → log `/no other active plans/` and no gate-fix from this source.
19. **S19 determinism**: two identical runs (weak-plan fixture with one fix round) → byte-identical label sequences AND byte-identical prompts (sibling S11 mirror).
20. **S20 persona roster + rounds**: (a) classifier activates security only → round-1 labels exactly `review-r1-coherence`, `review-r1-feasibility`, `review-r1-security` with correct plugin agentTypes; (b) classifier dies → duo only + log + `openQuestions` entry; (c) `reviewRounds:1`, weak plan converging round 2 → no `review-r2-*` labels, log `/editor-convergence round/`; `reviewRounds:99` clamps to 3; `reviewRounds:0` falls back to the default 2 (falsy under `args.reviewRounds || 2`).
21. **S21 evidence-mismatch READY rejected (self-reports never gate alone, M-X1)**: (a) editor-r1 READY but `evidence.unitCount` ≠ current count → `check-evidence-r1` arbitration dispatched; arbitration sides with the standing count → READY rejected, loop continues (round 2 dispatched), log `/evidence mismatch/`; editor-r2 with correct evidence → ready, `roundsUsed===2`. (b) arbitration sides with the EDITOR's count (author had miscounted, no mutation ever ran) → counts updated, the round-1 READY is ACCEPTED, `roundsUsed===1` (no deterministic dead end on an author miscount). (c) editor-r1 READY with `blockingCount: 0` but `findings` containing one P1 → coordinator recount rejects the READY, log `/blocking mismatch/`, the P1 is carried (appears in round-2 synthesis / fixer prompt), NOT silently dropped. (d) every round rejected this way with empty title lists → `haltReason` matches `/repeatedly rejected on evidence mismatch/`.
22. **S22 KTD refutation**: classifier returns 2 ktds + 1 loadBearingAssumption. (a) round 1: 3 `ktd-refute-p1-*` labels (agentType `skeptical-refuter`, model sonnet, prompt contains the `/unverifiable/` override text AND the plan path with the read-the-CURRENT-KTD-section instruction); (b) one returns `refuted` → a P0 `KTD refuted:` finding is synthesized and enters the refuted-KTD majority: exactly 3 `refute-halt-ktd-p1-0-v*` labels dispatched; (b1) 2-of-3 sustain → `status==='halted'`, `haltStage==='S4-halt-class-finding'`, `haltReason` contains `KTD refuted:`, title in `openQuestions`; (b2) 2-of-3 refute → finding dropped (primer flag `rejected-refuted`), run reaches `'ready'`, log `/refuted/` — the single KTD refuter's verdict never stands as ground truth in either direction; (c) one returns `unverifiable` → routed to Open Questions (fixer prompt) + `openQuestions`; (d) fixer reports `sectionsTouched:['Key Technical Decisions']` → round 2 has `ktd-refute-p2-*` labels whose prompts carry the refute-the-CURRENT-text instruction; round 3 has none (`KTD_PASSES_CAP`); (e) 10 ktds → only 8 refuted, overflow in `openQuestions` + log; (f) 4 claims return `refuted` with all majorities REFUTING the first 3 → only 3 majority procedures (`KTD_HALT_CAP`), the 4th title in `openQuestions` + residual class `'dropped-cap'`, a subsequent editor READY is rejected (log `/READY voided/`), and the run rides to `haltStage==='S4-editor-cap'` with the title in `haltReason`.
23. **S23 research degradation**: (a) `research-repo` throws → author + review prompts contain the fallback text `/repo research unavailable|read the repo yourself/`, log present, run completes; (b) `intake` throws → `haltStage==='S0-intake'`, zero further labels; (c) `research-cross-plan` throws → `openQuestions` contains `/cross-plan overlap unverified/`.
24. **S24 fixer accounting + reconciliation routing**: persona returns 4 findings: one safe_auto@100, one P1 manual with fix (refutation-survived), one P2 manual no-fix, one anchor-50 advisory. Asserts: log `/2 fix-now, 1 document-as-known-cost/`; fixer prompt marks `refutationSurvived` on the P1 and carries the routing target for the P2; fixer returns one `unapplied` reason `scope-widening: …` → residual class `scope-widening-routed` + `openQuestions` entry; one applied title omitted from the fixer return → residual class `fixer-failed` (sibling-S23 mirror); checker `fixesVerified` reports one `landed:false` → carried finding title suffixed `[fix did not land faithfully]` appears in round-2 synthesis (fixer-2 prompt); one APPLIED title absent from `fixesVerified` entirely → treated as `landed:false` and re-opened the same way (checker accounting, expected-set rule); the anchor-50 advisory lands in the final `residualFindings` as class `'fyi'` (pendingFyi fold).
25. **S25 halt-taxonomy completeness** (every declared haltStage is exercised somewhere in the suite): (a) `author-plan` throws → `haltStage==='S3-draft'`, zero `classify-personas`/`review-` labels; (b) weak-plan fixture so a fix round runs, then `check-r1` AND `check-r1-retry` both throw → `haltStage==='S4-post-mutation-check'` (the design's only bounded retry, fail-closed); (c) intake returns `nonCodeDeliverable:true` → `haltStage==='S0-intake'`, `haltReason` matches `/non-code deliverable/`, zero `research-` labels; (d) origin set + `origin-coverage-retry` still returning an omission after gate-fix → `haltStage==='S5-origin-coverage'`, the omission item text in `haltReason`; (e) `budgetTotal` tuned so the floor trips before round 1 → `haltStage==='S4-budget-floor'`, `roundsUsed===0`, draft path preserved.

Total: 25 scenarios. Every mandated family is present: happy path (S1), parse-gate failure+bounded fix (S10), threshold/anti-churn round-1 exit (S1), weak-plan convergence (S5), cap exhaustion → structured halt (S6), budget-floor degradation (S11, S25e), refuter-majority kills a finding (S8), uid-stability round-fail (S9), no-silent-caps logs (S12), prompt hygiene + no-claim-passing (S13), commit:false/true (S14), missing-required-arg throw (S2). Halt-stage coverage map: `S0-intake` S23b+S25c; `S0-blocking-unknowns` S3; `S2-strategy-gate` S4b; `S3-draft` S25a; `S4-budget-floor` S11+S25e; `S4-post-mutation-check` S25b; `S4-uid-stability` S9b; `S4-halt-class-finding` S8a+S22b1; `S4-editor-cap` S6+S22f; `S5-budget-floor` S11; `S5-parse-gate` S10b; `S5-releasability` S16b; `S5-origin-coverage` S25d — all 13 declared stages exercised.

---

## 8. Open risks the implementer must NOT silently resolve

Surface each of these back to the user the moment it is hit; do not improvise:

1. **Plugin agentType resolution drift.** The twelve `compound-engineering:*` agentTypes were verified against the live registry at design time. If any dispatch fails at run time (consistent nulls from one persona), STOP and report — do not re-author the persona locally (that forks the evolved review half, decisions Q6).
2. **Parse-prompt verbatim drift.** `UNITS_SCHEMA` and the parse-plan prompt are byte-copies of `ce-work-deterministic.js`. If the sibling has changed since (check before copying), surface the diff — do not reconcile silently; the copy IS the compatibility guarantee.
3. **document_content vs document_path deviation.** ce-doc-review feeds personas the full document text; this design feeds the path (the coordinator cannot read files). If a plugin persona proves unable to read files itself (tool restrictions), surface it — do not paste content via an extra reader agent without a decision.
4. **R29 evidence-overlap heuristic.** The 300-char-window substring test is a deliberate simplification of ce-doc-review's ">50% overlap". If it visibly mis-suppresses or re-litigates in real runs, surface; do not invent a similarity metric.
5. **Halt-class definition.** `P0 && manual && suggestedFix===''` is this design's operationalization of "halt-class". If real runs show it firing on noise or missing real plan-killers, surface the calibration question.
6. **NNN race.** Two concurrent nadia-plan runs on one repo can derive the same NNN. Accepted as out of scope; if it bites, surface (candidate fix is author-side retry-on-collision, but that is a decision, not an implementation detail).
7. **Hygiene-violation severity.** A dirty workspace currently degrades (ready + warning + commit skipped), not halts. If the user wants a hard gate, that is a one-line change — but it changes the return contract; ask first.
8. **Knowledge-work plans.** `execution: knowledge-work` zero-unit plans are deliberately unsupported (S0 halts on `nonCodeDeliverable`). Do not add a bypass.
9. **`workflow()` chaining.** The run summary is shaped for a future plan→work meta-workflow, but nesting is one level — nadia-plan itself must never call `workflow('ce-work-deterministic', …)` as a "convenience"; that is a separate design decision.
10. **Budget-floor constant.** `30000` matches the sibling. Do not tune it independently; if it proves wrong for review-heavy runs, surface.
11. **Editor-as-diagnostician.** This design makes the plan-editor read-only (trycycle's editor rewrites). The verdict semantics were adapted deliberately (single-writer-per-round invariant, M9 coverage of every mutation). Do not "restore" editor write access without a decision.
12. **Budget-envelope arithmetic vs decisions §4.** decisions.md §4 states "worst ≈ 90"; the recomputation in §4.8 gives ≈145 default / ≈200 absolute. No cap, bound, or mechanism changed — arithmetic only — but if any budget planning relied on the ≈90 figure, surface it rather than tuning caps to fit.
13. **Refuted-KTD majority allowance (`KTD_HALT_CAP`).** decisions M7 caps halt-class majority procedures at 3 findings/run; this design adds a DEDICATED allowance of 3 more for refuted-KTD findings (worst case 6 majority procedures ≈ 18 refuter agents). Rationale: catalog B.4's "sustained-refutations become blocking findings" (carried into M7 by row 42 without revocation) plus principle 4 (no single refuter's verdict may stand as ground truth — in either direction). If this is judged a decisions amendment rather than an implementation of row 42's intent, surface it; do not silently fold the two caps into one.
14. **`editor-ready-on-file` demoted from checklist item to log line.** decisions row 40 lists it among the host gate's folded items; §4.6 now surfaces it via `log('editor-ready-before-gates: …')` instead, because no agent re-evaluates the verdict against post-gate-fix bytes (row 48's own objection) and the §3 contract carries no releasability field. If the checklist-item form is wanted, that is a return-contract change — ask first.

---

## Revision log

Single revision round against three critic lenses (repo-standards RS-1..12, base-fidelity BF-1..8, implementability IM-1..12). Every major fixed; every minor fixed (none skipped, none rebutted — each finding traced to a binding source on inspection). Overlapping findings share one fix.

| # | Finding (lens, severity) | Disposition |
|---|---|---|
| RS-1 / BF-2 | fixNow third category vs decisions Q9 (major) | FIXED — §4.5.d restricted to exactly Q9's two classes (safe_auto@100 OR refutation-survived); unrefuted P2/P3 gated_auto/sub-100 route to documentAsKnownCost; authority sentence now provably consistent with the routing; S5 fixture rewritten (safe_auto@100 + a gated_auto variant asserting NO auto-apply). |
| RS-2 / BF-1 / IM-3 | refuted KTD can never block; single refuter as ground truth (major) | FIXED — refuted KTDs synthesized P0/manual/'' (halt-class shape) and sent to the majority-of-3 machinery under a dedicated `KTD_HALT_CAP` allowance; sustain → `S4-halt-class-finding` halt; overflow increments `refutedKtdOverflow`, which voids any READY exit and rides to the cap halt; added to §3 openQuestions taxonomy + template comment; S22(b) rewritten as unambiguous assertions (b1/b2/f). Recorded as Open risk 13 in case the dedicated allowance is read as a decisions amendment. |
| RS-3 | exit gate reads self-reported blockingCount alone (major) | FIXED — coordinator recounts `editorBlocking` from `ed.findings`; exit requires both zero; mismatch → READY rejected, logged, findings carried (S21c). |
| RS-4 / IM-1 | synthesis steps 2/5 contradiction + unspecified merge winners (major) | FIXED — keep-distinct exception moved INTO step 2 with an explicit predicate; merge winners defined for suggestedFix/findingType/autofixClass/whyItMatters (max-severity entry, deterministic tiebreaks); step 5 consumes exactly the kept-distinct pairs. |
| RS-5 | three vacuous gates (releasability/origin/fix-fidelity) (major) | FIXED — 7 expected releasability ids counted (missing → pass:false 'not reported', S16c); origin `sections:[]` with ORIGIN set = verifier failure (S17d, happy fixture made non-vacuous); applied titles absent from `fixesVerified` → landed:false re-opened (S24). |
| RS-6 | four declared haltStages never exercised (major) | FIXED — new S25 (S3-draft, S4-post-mutation-check, S0-intake nonCodeDeliverable, S5-origin-coverage, pre-round-1 budget floor); halt-stage coverage map added showing all 13 stages exercised. |
| RS-7 / BF-5 | EDITOR_ROUNDS `\|\|` form vs S6 "0 clamps to 1" (major) | FIXED on the test side — S6 now asserts 0 → default 3 (decisions Q5 binds the `args.editorRounds \|\| 3` form, sibling line 34); lower clamp asserted via `-2 → 1`; same convention asserted for reviewRounds (S20). |
| RS-8 | "Nothing else throws" vs constraints §12 budget ceiling (minor) | FIXED — §2.1 names the runtime budget-ceiling throw as a documented, sibling-identical exception. |
| RS-9 / IM-9 | budget envelope arithmetic understated (minor) | FIXED — §4.8 recomputed (≈145 default / ≈200 absolute / ≈45 typical), floor-vs-round note added; divergence from decisions §4's ≈90 recorded as Open risk 12 (arithmetic only, no cap change). |
| RS-10 | flow slot conflates lightweight skip with failure (minor) | FIXED — DEPTH-aware fallback distinguishes "(not run — lightweight tier)" from "(flow analysis unavailable …)". |
| RS-11 (with IM-5) | final-round spike waste; READY-with-designUnknowns unspecified (minor) | FIXED — spike branch never dispatches when `r === EDITOR_ROUNDS` (unknowns → openQuestions + cap haltReason, logged; S15e); explicit bullet: READY with designUnknowns → REVISED, findings carried, spike-eligible (S15f). |
| RS-12 / BF-8 | pendingFyi merge point + cap haltReason on null verdict (minor) | FIXED — `summary()` folds pendingFyi as its first line (asserted in S24); cap haltReason gains null-verdict and empty-lists fallbacks. |
| BF-3 | M-X2 editor-check half dropped (major) | FIXED — assumptions-without-invalidating-observation bullet added to the plan-editor's diagnosis enumeration (where decisions row 49 placed the check). The optional releasability enum item NOT added: row 49 sits M-X2 at "S3 authoring rule + S4 editor check" only, and an 8th enum id would ripple through the gate contract for coverage decisions did not mandate. |
| BF-4 | template subsets ce-plan's section catalog (major) | FIXED — include-when-material list (HTD, System-Wide Impact, Risks & Dependencies, Acceptance Examples, Documentation/Operational Notes, Sources/Research) appended to §5 with base inclusion rules, parser-safe note; "NO new sections" rescoped to outside-the-catalog; author persona updated to add them when the rules fire. |
| BF-6 | editor-ready-on-file synthetic pass overstates (minor) | FIXED (with IM-8) — demoted to `log('editor-ready-before-gates: …')` naming the round and the parse-plan-final/check-gate-fix coverage of post-READY mutations; no contract change; recorded as Open risk 14 vs decisions row 40. |
| BF-7 | "minus interactive-only steps" misattribution (minor) | FIXED — synthesis intro cites decisions M6's trimmed set as the authority and names the dropped base steps plus the refuter-cap cost of dropped chain linking, with the M8 conflict scan as designated partial substitute. |
| IM-2 | gate prompts forbid the edits the gates demand (major) | FIXED — "Gate-originated edit authority" paragraph in §4.6: parse-fix/gate-fix replace the refutationSurvived requirement with violation-list authorization (never renumber, never widen scope); full protected-surfaces rule stays S4-fixer-only; `revise-spike` bans protected surfaces outright; S16 asserts the prompt content. Consistent with decisions row 39 (mandating a parse fix round, which inherently edits Dependencies). |
| IM-4 | ktdRefutePrompt slots unenumerated; pass-2 refutes stale quotes (major) | FIXED — slots enumerated (claim, planPath + read-CURRENT-KTD-section, CODEBASE_CONTEXT, relevantFiles, override); pass-2 instruction to locate and refute the CURRENT decision text; asserted in S22a/d. |
| IM-5 | stage lettering vs execution order; (d) jump; void-READY sentence (major) | FIXED — stages re-lettered to execution order (f = editor verdict, g = spike branch); (d)'s empty-list jump now lands on the editor by construction; void-READY sentence replaced with the never-needs-voiding explanation; final-round behavior stated explicitly (does NOT dispatch). |
| IM-6 | 'spike-revision' label prefix collision (minor) | FIXED — renamed `revise-spike` (prefix-disjoint); fixture table + S15 + §5 updated. |
| IM-7 | riskSurfaces well-formedness forces doc fix for parser-derived value (minor) | FIXED — fail-open JS filter with log(), matching the sibling's `.includes()`-only tolerance (lines 772–781); removed from the gate-failure set. |
| IM-8 | eighth checklist item has no landing zone (minor) | FIXED with BF-6 — log line, not data; enum stays 7. |
| IM-9 | evidence-mismatch deadlock on author miscount (minor) | FIXED — `check-evidence-r${r}` arbitration (≤1/round, only on pure count mismatch); checker owns the counts; empty-lists haltReason special case (S21b/d). |
| IM-10 | envelope 90 vs 185 (minor) | FIXED with RS-9. |
| IM-11 | primer double-entry; 'rejected-suppressed' unassigned; pendingFyi (minor) | FIXED — stage (d) declared the single primer-write point (c and step 4 only flag); step 4 assigns `rejected-suppressed`; pendingFyi fold per RS-12. |
| IM-12 | refix-uid prompt lacks planPath (minor) | FIXED — planPath + protection-rules reference added to the refix-uid slot list. |

---

*End of spec. An implementer following §1–§7 in order, with decisions.md as tie-breaker, should produce a coordinator functionally identical to any other faithful implementation: same labels, same schemas, same prompts modulo whitespace, same return contract, same test assertions.*
