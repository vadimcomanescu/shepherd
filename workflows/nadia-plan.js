export const meta = {
  name: 'nadia-plan',
  description: 'Plan-production pipeline: lock a request or brainstorm into Confirmed Intent, research the repo, challenge the framing, author a ce-plan-format plan document, then run a bounded editor loop (persona doc-review, skeptical refutation, verified fix application, read-only spikes for design unknowns) and final gates (ce-work parse conformance, releasability checklist, origin coverage, cross-plan overlap), hygiene-check the workspace, optionally commit, and return a machine-readable run summary consumable by nadia-deliver.',
  whenToUse: 'Producing a plan document for nadia-deliver from a request or an origin brainstorm/requirements doc, autonomously (no interactive questions; blocking unknowns become a structured halt). Passing commit: true IS the consent to commit the plan file. args: { request?: "<what to plan>", origin?: "<path to brainstorm/requirements doc>", originVersion?: "<hash-or-mtime — pass a NEW value after editing the origin doc so resume does not replay stale cached research>", depth?: "lightweight"|"standard"|"deep", date?: "YYYY-MM-DD", commit?: true|false, editorRounds?: <1..5, default 3>, reviewRounds?: <1..3, default 2>, spikes?: true|false, externalResearch?: true|false }',
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

// ============================================================
// args contract — preflight zone: the ONLY throw zone in the whole
// coordinator. Every later failure resolves to the M17 structured halt
// return. (One documented exception outside coordinator control: when
// budget.total is set, the RUNTIME throws from a bare-awaited agent()
// dispatched after the ceiling is reached — sibling-identical behavior.)
// ============================================================
if (!args || ((!args.request || !String(args.request).trim()) && !args.origin)) {
  throw new Error('nadia-plan requires args.request (text) or args.origin (path to a brainstorm/requirements doc)')
}
if (args.depth !== void 0 && !['lightweight', 'standard', 'deep'].includes(args.depth)) {
  throw new Error('args.depth must be one of lightweight|standard|deep')
}
if (args.date !== void 0 && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
  throw new Error('args.date must be YYYY-MM-DD')
}

const REQUEST = args.request ? String(args.request).trim() : ''
const ORIGIN = args.origin || ''
const ORIGIN_VERSION = args.originVersion || 'unversioned'
const PINNED_DEPTH = args.depth || ''
const PLAN_DATE = args.date || ''
const COMMIT = args.commit === true                  // DEFAULT FALSE — commit: true IS the consent (global git-read-only rule)
const EDITOR_ROUNDS = Math.max(1, Math.min(5, args.editorRounds || 3))   // the single outer loop counter
const PERSONA_ROUNDS = Math.max(1, Math.min(3, args.reviewRounds || 2))  // persona stage active rounds 1..PERSONA_ROUNDS; NOT a second counter
const SPIKES_ENABLED = args.spikes !== false
const EXTERNAL_RESEARCH = args.externalResearch !== false
// Args echo — a launch whose args never arrived (observed live: a scriptPath
// launch delivered no tool-level args) must die loudly AND legibly, never silently.
log(`nadia-plan args resolved: request=${REQUEST ? `"${REQUEST.slice(0, 80)}${REQUEST.length > 80 ? '…' : ''}"` : '(none)'}, origin=${ORIGIN || '(none)'}, depth=${PINNED_DEPTH || '(auto)'}, date=${PLAN_DATE || '(derived)'}, commit=${COMMIT}, editorRounds=${EDITOR_ROUNDS}, reviewRounds=${PERSONA_ROUNDS}, spikes=${SPIKES_ENABLED}, externalResearch=${EXTERNAL_RESEARCH}, repo=${args.repo || '(session cwd)'}`)

// ---- target-repo grounding (first-class repo arg) ----
// Every agent runs with the session cwd, which is NOT necessarily the repo the
// plan is for (observed live: planning for a sibling checkout required shimming
// a grounding prefix into every prompt). One chokepoint grounds every dispatch.
const REPO = args.repo ? String(args.repo).replace(/\/+$/, '') : ''
if (REPO) {
  const ungroundedAgent = agent
  agent = (prompt, opts) => ungroundedAgent(`TARGET REPOSITORY: ${REPO}
You are working on the repository at ${REPO}, NOT your current working directory.
Resolve every relative path in this brief (docs/plans/..., lib/..., test and git
commands) against ${REPO}: cd into it first in any shell command, search and
read only there, and write files only under ${REPO}.

${prompt}`, opts)
}
const BUDGET_FLOOR = 30000                            // sibling line-548 constant, unchanged
const belowBudgetFloor = () => !!budget.total && budget.remaining() <= BUDGET_FLOOR

// Caps as named consts — every drop they cause is log()ged (M18).
const FINDING_REFUTER_CAP = 16   // per round, severity-ordered (M7 class A)
const HALT_CLASS_CAP = 3         // majority-of-3 procedures per run (M7)
const KTD_CAP = 8                // KTD refuters, prioritized (M7 class B)
const KTD_PASSES_CAP = 2         // initial pass + at most one primer-triggered re-refutation pass
const KTD_HALT_CAP = 3           // majority-of-3 procedures for refuted-KTD findings (dedicated allowance)
const SPIKE_CAP = 3              // read-only spikes, once per run (M10)
const PERSONA_CAP = 8            // personas per round (roster is 7; cap asserted anyway)
const RESEARCH_CAP = 6           // S1 fan-out ceiling (roster is at most 6 by construction)

// ============================================================
// Schemas (M-X1: every agent returns opts.schema-validated JSON; every
// gate and loop predicate reads counted fields, never prose)
// ============================================================
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

// Copied verbatim from nadia-deliver.js — the refuter verdict contract.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const KTD_VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { enum: ['sustained', 'refuted', 'unverifiable'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
}

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

const SPIKE_SCHEMA = {
  type: 'object',
  properties: {
    unknown: { type: 'string' },
    resolution: { enum: ['resolved', 'documented-trade-off', 'runtime-blocked'] },
    evidence: { type: 'string' }, recommendation: { type: 'string' },
  },
  required: ['unknown', 'resolution', 'evidence', 'recommendation'],
}

// Copied VERBATIM from nadia-deliver.js (lines 39-70) — this byte-copy
// IS the compatibility guarantee: ce-work's own parser is the release test.
const UNITS_SCHEMA = {
  type: 'object',
  properties: {
    planTitle: { type: 'string' },
    slug: { type: 'string', description: 'kebab-case branch slug derived from plan title' },
    riskSurfaces: { type: 'array', items: { type: 'string' }, description: 'subset of: auth, payments, migrations, crypto, public-api, deps' },
    requirements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
    deferredQuestions: { type: 'array', items: { type: 'string' } },
    scopeBoundaries: { type: 'array', items: { type: 'string' } },
    units: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'U-ID, e.g. U3' },
          name: { type: 'string' },
          goal: { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'U-IDs' },
          files: { type: 'array', items: { type: 'string' } },
          approach: { type: 'string' },
          executionNote: { type: 'string' },
          patterns: { type: 'array', items: { type: 'string' } },
          testScenarios: { type: 'array', items: { type: 'string' } },
          verification: { type: 'string' },
        },
        required: ['uid', 'name', 'goal', 'dependsOn', 'files', 'approach', 'patterns', 'testScenarios', 'verification'],
      },
    },
  },
  required: ['planTitle', 'slug', 'units', 'requirements', 'riskSurfaces'],
}

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

const ORIGIN_COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, status: { enum: ['addressed', 'deferred', 'omitted'] }, evidence: { type: 'string' } }, required: ['heading', 'status', 'evidence'] } },
    omissions: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, fromSection: { type: 'string' }, detail: { type: 'string' } }, required: ['item', 'fromSection', 'detail'] } },
  },
  required: ['sections', 'omissions'],
}

const COMMIT_SCHEMA = { type: 'object', properties: { committed: { type: 'boolean' }, sha: { type: 'string' }, filesInCommit: { type: 'array', items: { type: 'string' } }, detail: { type: 'string' } }, required: ['committed', 'sha', 'filesInCommit', 'detail'] }

const HYGIENE_SCHEMA = { type: 'object', properties: { onlyPlanChanged: { type: 'boolean', description: 'true when git status shows no tracked change outside the plan file (and, when a commit was just made, the tree is clean)' }, changedFiles: { type: 'array', items: { type: 'string' } }, planVersion: { type: 'string', description: 'git hash-object of the plan file' }, detail: { type: 'string' } }, required: ['onlyPlanChanged', 'changedFiles', 'planVersion', 'detail'] }

// ============================================================
// Pure helpers (no I/O) + run-summary state (M17). ALL fields always
// present in the return — nulls explicit, arrays empty not missing.
// ============================================================
const SEV_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 }
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
const fingerprint = (f) => norm(f.section) + '::' + norm(f.title)
const window300 = (s) => {
  const t = String(s)
  if (t.length <= 300) return t
  const cut = t.slice(0, 300)
  const sp = cut.lastIndexOf(' ')
  return sp > 0 ? cut.slice(0, sp) : cut
}
const head80 = (s) => (String(s).length > 80 ? String(s).slice(0, 80) : String(s))
const routeTarget = (f) => (/assumption/i.test(f.section) ? 'Assumptions' : /scope/i.test(f.section) ? 'Scope Boundaries' : 'Open Questions')

let planPath = null
let planVersion = null
let depthTier = null
let unitCount = 0
let requirementCount = 0
let roundsUsed = 0
let personaRoundsUsed = 0
let residualFindings = []
let narrowedScope = []
let openQuestions = []
let committed = false
let hygieneClean = null
let slug = ''
let pendingFyi = []           // anchor-50 advisories (residual class 'fyi')

// One pure-JS builder used by every terminal return. It folds pendingFyi as
// its first line — the one and only merge point for anchor-50 advisories —
// and is called exactly once per run.
const summary = (status, extra) => {
  residualFindings.push(...pendingFyi.map((f) => ({ title: f.title, section: f.section, class: 'fyi', reason: 'anchor-50 advisory' })))
  return { status, planPath, planVersion, depthTier, unitCount, requirementCount,
    roundsUsed, personaRoundsUsed, residualFindings, narrowedScope, openQuestions, committed, hygieneClean,
    haltStage: null, haltReason: null, nextStep: '', ...extra }
}

// ============================================================
// S0 — Intake (M1: confirmed intent, unknown classification, split tests)
// ============================================================
phase('Intake')

const intake = await agent(
  `You are the intake classifier for an autonomous plan-production pipeline.
There is no human to ask: never pose questions back — classify them instead.

Request (raw):
${REQUEST || '(none — origin document only)'}

${ORIGIN ? `Origin document: ${ORIGIN} (version: ${ORIGIN_VERSION}). Read it fully before classifying.` : 'No origin document was provided.'}

Depth tier: ${PINNED_DEPTH ? `depth tier is PINNED to "${PINNED_DEPTH}" — return it as depthTier unchanged.` : 'derive the tier: Lightweight 2–4 units / Standard 3–6 / Deep 4–8.'}

Confirmed Intent — fill all six fields (outcome, user, whyNow, success as an
observable statement, constraint, outOfScope) derived from the request and the
origin doc ONLY; never invent facts the requester did not state or imply.

Unknown classification: blocking = could materially change the outcome AND
would likely upset the requester if guessed wrong; everything else: decide,
attach hypothesis + the observation that would invalidate it.

One-thing split tests (apply all three): the 'and' test: does describing it
need an 'and' joining independent outcomes; the independence test: could each
part ship and be tested alone; the 'what changed' test: would each part's diff
make sense as its own PR — if genuinely N independent things, pick the primary
and list the rest as excluded.

External research gates: recommend bestPractices/web research only for
implementation-guidance or landscape intent with risk or thin local patterns;
give the reason either way.

planType: classify the work as feat|fix|refactor|chore|docs|perf|test.
nonCodeDeliverable: true when the request is not a code change (knowledge work).`,
  { label: 'intake', phase: 'Intake', schema: INTAKE_SCHEMA },
)

if (!intake) {
  return summary('halted', {
    haltStage: 'S0-intake',
    haltReason: 'intake agent returned null',
    nextStep: 'Re-invoke nadia-plan; if it recurs, file the request as an issue with the raw request text',
  })
}
if (intake.nonCodeDeliverable === true) {
  return summary('halted', {
    haltStage: 'S0-intake',
    haltReason: 'request is a non-code deliverable — nadia-plan only produces implementation plans for nadia-deliver',
    nextStep: 'Restate the request as a code change (or handle the knowledge work directly), then re-invoke nadia-plan',
  })
}
if (intake.blockingUnknowns.length > 0) {
  openQuestions.push(...intake.blockingUnknowns.map((u) => u.question))
  return summary('halted', {
    haltStage: 'S0-blocking-unknowns',
    haltReason: `blocking unknowns: ${intake.blockingUnknowns.map((u) => `${u.question} (${u.whyBlocking})`).join('; ')}`,
    nextStep: 'Answer the open questions (or fold answers into args.request / the origin doc), then re-invoke nadia-plan',
  })
}

const DEPTH = PINNED_DEPTH || intake.depthTier
depthTier = DEPTH
narrowedScope = intake.split.isMultiple ? intake.split.excluded : []
if (narrowedScope.length) {
  log('One-thing split: narrowed to "' + intake.split.primary + '" — excluded: ' + narrowedScope.join('; ') + ' (routed to Deferred to Follow-Up Work; re-invoke per item)')
}
const assumptions = intake.decidableUnknowns.slice()   // carried to the author for ## Assumptions (M-X2)

const ci = intake.confirmedIntent
const CONFIRMED_INTENT = `<confirmed-intent>
Outcome: ${ci.outcome}
User: ${ci.user}
Why now: ${ci.whyNow}
Success: ${ci.success}
Constraint: ${ci.constraint}
Out of scope:
${ci.outOfScope.map((s) => '- ' + s).join('\n') || '- none stated'}
Depth tier: ${DEPTH}
${narrowedScope.length ? 'Narrowed from a multi-part request. Primary: ' + intake.split.primary + '. Excluded (deferred to follow-up work): ' + narrowedScope.join('; ') : 'Single-outcome request.'}
</confirmed-intent>`

// ============================================================
// S1 — Research (M2). parallel() justified: S2 and the CODEBASE_CONTEXT
// assembly need the FULL prior result set together.
// ============================================================
phase('Research')

// Unconditional no-silent-cap log (decisions Q8): one researcher in the ce-plan
// roster has no verified agentType in this runtime's registry.
log('ce-framework-docs-researcher is not in the verified agent registry — skipped; framework-docs coverage rides best-practices/web research')

const researchGrounding = `${CONFIRMED_INTENT}

Raw request: ${REQUEST || '(origin document only)'}${ORIGIN ? `\nOrigin document: ${ORIGIN} (version: ${ORIGIN_VERSION}) — read it.` : ''}`

const researchRoster = []
researchRoster.push({ key: 'repo', thunk: () => agent(
  `${researchGrounding}

Research THIS repository for planning context: stack, architecture, key modules
relevant to the request, conventions distilled from AGENTS.md/CLAUDE.md, and
the files a planner must know about. Extended scope: include the test harness
inventory, the project's test/lint commands, testing conventions, and whether a
CONTEXT.md domain glossary exists at the repo root — report its path (or "").`,
  { label: 'research-repo', phase: 'Research', agentType: 'compound-engineering:ce-repo-research-analyst', schema: REPO_RESEARCH_SCHEMA },
) })
researchRoster.push({ key: 'learnings', thunk: () => agent(
  `${researchGrounding}

Search this repo's institutional learnings (docs/solutions/ and similar) for
anything that should change planning decisions for this request. Return a
digest of <=25 lines ("" when nothing material) plus the source paths.`,
  { label: 'research-learnings', phase: 'Research', agentType: 'compound-engineering:ce-learnings-researcher', model: 'sonnet', schema: DIGEST_SCHEMA },
) })
if (!EXTERNAL_RESEARCH) {
  log('External research skipped: args.externalResearch === false')
} else {
  if (intake.research.bestPractices) {
    researchRoster.push({ key: 'bp', thunk: () => agent(
      `${researchGrounding}

Research current external best practices relevant to this request (intake gate
reason: ${intake.research.reason}). Return a digest of <=25 lines of findings
that should change planning decisions ("" when nothing material) plus sources.`,
      { label: 'research-best-practices', phase: 'Research', agentType: 'compound-engineering:ce-best-practices-researcher', model: 'sonnet', schema: DIGEST_SCHEMA },
    ) })
  } else {
    log('Best-practices research skipped: intake gates off (' + intake.research.reason + ')')
  }
  if (intake.research.web) {
    researchRoster.push({ key: 'web', thunk: () => agent(
      `${researchGrounding}

Run web research on the landscape relevant to this request (intake gate
reason: ${intake.research.reason}). Return a digest of <=25 lines of findings
that should change planning decisions ("" when nothing material) plus sources.`,
      { label: 'research-web', phase: 'Research', agentType: 'compound-engineering:ce-web-researcher', model: 'sonnet', schema: DIGEST_SCHEMA },
    ) })
  } else {
    log('Web research skipped: intake gates off (' + intake.research.reason + ')')
  }
}
if (DEPTH !== 'lightweight') {
  researchRoster.push({ key: 'flow', thunk: () => agent(
    `${researchGrounding}

Analyze the user/data/control flows this request touches in this repository.
Return a digest of the flow picture a planner needs plus the edge cases the
plan must not miss.`,
    { label: 'research-flow', phase: 'Research', agentType: 'compound-engineering:ce-spec-flow-analyzer', schema: FLOW_SCHEMA },
  ) })
} else {
  log('Spec-flow analysis skipped: lightweight tier')
}
researchRoster.push({ key: 'crossplan', thunk: () => agent(
  `${researchGrounding}

List every *.md file under docs/plans/ whose YAML frontmatter says status:
active. For each, extract the title, the union of all per-unit Files lists,
and riskSurfaces (which of auth/payments/migrations/crypto/public-api/deps it
touches). Return an empty list if the directory does not exist.`,
  { label: 'research-cross-plan', phase: 'Research', model: 'sonnet', schema: CROSS_PLAN_SCHEMA },
) })

// Clamp for M18 discipline — cannot fire with a <=6-row roster by construction.
const researchActive = researchRoster.slice(0, RESEARCH_CAP)
if (researchRoster.length > researchActive.length) log(`Research cap: ${researchRoster.length - researchActive.length} researcher(s) beyond ${RESEARCH_CAP} dropped`)

const researchReturns = await parallel(researchActive.map((r0) => r0.thunk))
const research = {}
researchActive.forEach((r0, i) => { research[r0.key] = researchReturns[i] })

const repo = research.repo || null
const learnings = research.learnings || null
const bp = research.bp || null
const web = research.web || null
const flow = research.flow || null
if (!repo) log('repo research failed — personas and the author will ground themselves by reading the repo directly')
if (!learnings) log('learnings research failed — institutional learnings unavailable in the context block')
if (researchActive.some((r0) => r0.key === 'bp') && !bp) log('best-practices research failed — external best practices unavailable in the context block')
if (researchActive.some((r0) => r0.key === 'web') && !web) log('web research failed — web findings unavailable in the context block')
if (researchActive.some((r0) => r0.key === 'flow') && !flow) log('spec-flow analysis failed — flow coverage unavailable in the context block')

let activePlans = []
if (!research.crossplan) {
  log('cross-plan scan failed — overlap check skipped (fail-open)')
  openQuestions.push('cross-plan overlap unverified (scan agent failed)')
} else {
  activePlans = research.crossplan.activePlans
  if (!activePlans.length) log('Cross-plan scan: no other active plans — overlap check self-skipped')
}

// Skip and failure are distinct grounding facts: the lightweight-tier line
// renders ONLY when the flow dispatch was actually skipped.
const CODEBASE_CONTEXT = `<codebase-context>
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
</codebase-context>`

// ============================================================
// S2 — Strategy/scope gate (M3): challenge the framing BEFORE drafting.
// There is NO redraft branch — S2 is pre-draft by design.
// ============================================================
phase('Gate')

const strategy = await agent(
  `${CONFIRMED_INTENT}

${CODEBASE_CONTEXT}
${ORIGIN ? `\nOrigin document: ${ORIGIN} (version: ${ORIGIN_VERSION}) — read it.\n` : ''}
Challenge the framing before anything is drafted: is this the right problem?
the right architectural direction for this repo? are unvalidated assumptions
baked into the intent? Apply a LOW bar to redirecting the approach (do not
preserve the intake framing because it exists) and a HIGH bar to halting (halt
only when proceeding would bake in a decision the requester must make).
Separately, compare the research against the intake scope claim and report the
scope delta: the capability already exists, the approach conflicts with the
architecture, or the scope is materially larger than stated. Verdict adjust =
proceed with adjustedFraming and loggedAssumptions recorded as testable
assumptions.`,
  { label: 'strategy-gate', phase: 'Gate', schema: STRATEGY_SCHEMA },
)

let ADJUSTED_FRAMING = ''
if (!strategy) {
  // Fail-open, mirroring the sibling's S17 triage treatment of a dead gate agent.
  log('Strategy gate agent failed — proceeding with unadjusted framing')
} else if (strategy.verdict === 'halt') {
  if (strategy.scopeDelta) openQuestions.push(strategy.scopeDelta)
  if (strategy.haltReason) openQuestions.push(strategy.haltReason)
  return summary('halted', {
    haltStage: 'S2-strategy-gate',
    haltReason: strategy.haltReason || 'strategy gate halted without a stated reason',
    nextStep: 'Resolve the framing question, then re-invoke nadia-plan',
  })
} else if (strategy.verdict === 'adjust') {
  assumptions.push(...strategy.loggedAssumptions.map((a) => ({ question: 'scope/framing', hypothesis: a.assumption, invalidatedWhen: a.invalidatedWhen })))
  ADJUSTED_FRAMING = '\n<adjusted-framing>\n' + strategy.adjustedFraming + '\nScope delta: ' + strategy.scopeDelta + '\n</adjusted-framing>'
  log('Strategy gate: adjusted framing with ' + strategy.loggedAssumptions.length + ' logged assumption(s)')
}

// ============================================================
// S3 — Draft (M4): the plan-author persona writes the document; a sonnet
// classifier then selects conditional review personas and extracts KTDs.
// ============================================================
phase('Draft')

// The document template — the hard floor (the minimum, not the maximum) —
// byte-compatible with ce-plan's section catalog (decisions Q13).
const PLAN_TEMPLATE = `---
title: "<type>: <Plan title>"
type: <feat|fix|refactor|chore|docs|perf|test>
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
<R-IDs plain (\`R1.\`, not bolded), stable, continuous; grouped by concern only when spanning distinct areas.>

## Key Technical Decisions
- <decision>: <rationale naming trade-offs and rejected alternatives>

## Implementation Units

### U1. <Name>
**Goal**: <one meaningful change ≈ one atomic commit>
**Requirements**: R1, R3            <!-- optional field -->
**Dependencies**: none | U1, U2
**Files**: \`path/a\`, \`path/b\`       <!-- repo-relative -->
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
<!-- always present in nadia-plan output (headless mode); every entry MUST carry its invalidating observation -->

## Deferred to Implementation
- <execution-detail questions ONLY — never design-level unknowns (releasability gate enforces)>

## Open Questions
<!-- only when entries exist: unverifiable KTDs, refuted KTDs beyond the majority allowance, runtime-blocked spikes, cross-plan overlaps, scope-widening proposals -->`

const assumptionsBlock = assumptions.map((a) => `- ${a.question} / hypothesis: ${a.hypothesis} / invalidated when: ${a.invalidatedWhen}`).join('\n') || '- none'

const author = await agent(
  `${CONFIRMED_INTENT}${ADJUSTED_FRAMING}

${CODEBASE_CONTEXT}
${ORIGIN ? `\nOrigin document: ${ORIGIN} (version: ${ORIGIN_VERSION}) — read it fully; every requirement/decision/boundary must be addressed or explicitly deferred.\n` : ''}
Testable assumptions to write into ## Assumptions (every entry must name its
invalidating observation):
${assumptionsBlock}
${narrowedScope.length ? `\nExcluded request parts — route these verbatim into Scope Boundaries → "### Deferred to Follow-Up Work":\n${narrowedScope.map((s) => '- ' + s).join('\n')}\n` : ''}
Depth tier: ${DEPTH} — unit budget: lightweight 2–4 / standard 3–6 / deep 4–8 units.
Plan type: ${intake.planType}.
${PLAN_DATE ? `Plan date: ${PLAN_DATE}.` : 'Derive the date yourself: run date +%F.'} Derive NNN by listing docs/plans/
(count the .md and .html files dated today, plus 1, zero-padded to 3); create
docs/plans/ if missing. Write to
docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md and include the
origin frontmatter line ONLY when an origin document is named above.

Document template (the hard floor — follow it exactly):

${PLAN_TEMPLATE}

Include-when-material sections (PERMITTED, never required — add them when their
inclusion rules fire, and NEVER any section outside this catalog):
## High-Level Technical Design (when the approach has shape prose alone doesn't
carry — Mermaid in markdown); ## System-Wide Impact (cross-cutting concerns:
data lifecycles, auth boundaries, performance, shared infrastructure);
## Risks & Dependencies (real risks with mitigations, material upstream
dependencies); ## Acceptance Examples (when requirements have conditional
shape); ## Documentation / Operational Notes (monitoring, runbooks, rollout);
## Sources / Research (research breadcrumbs).`,
  { label: 'author-plan', phase: 'Draft', agentType: 'plan-author', schema: AUTHOR_SCHEMA },
)

if (!author) {
  return summary('halted', {
    haltStage: 'S3-draft',
    haltReason: 'plan author returned null — no draft exists',
    nextStep: 'Simplify or clarify the request if it recurs, then re-invoke nadia-plan',
  })
}
planPath = author.planPath
slug = author.slug
let uidBaseline = { pairs: author.uidNamePairs, rIds: author.rIds }
unitCount = author.unitCount
requirementCount = author.requirementCount
// author.detail is used ONLY here (logging) — never threaded into any later
// prompt (no-claim-passing, M6).
log('Draft written: ' + planPath + ' (' + unitCount + ' units, ' + requirementCount + ' requirements) — ' + author.detail)

const classify = await agent(
  `Read the plan document at ${planPath}. Classify it and select conditional
review personas using EXACTLY these trigger rules (ce-doc-review's rules):
- documentType: plan (implementation plan) or requirements.
- productLens: challengeable premise claims OR strategic weight — either leg sufficient.
- designLens: UI/UX references, frontend components, user flows, screens, interactions, responsive, accessibility.
- securityLens: auth/authz, externally exposed endpoints, PII/payments/tokens/credentials/encryption, third-party trust boundaries.
- scopeGuardian: multiple priority tiers, >8 requirements, stretch goals, scope-boundary language misaligned with goals.
- adversarial: high-stakes domain (auth/payments/billing/migrations/privacy/compliance/external integrations/crypto); new abstraction/framework/architectural pattern; greenfield with no origin doc; explicit scope extension beyond origin; explicit alternatives or unresolved tradeoffs. Negative rule: adversarial is NOT triggered by structural complexity, and NOT for a routine plan derived from a validated origin that stays in scope and touches no high-stakes domain.
Origin document: ${ORIGIN || 'none'}.
Return one reason line per activated conditional persona.
Also extract the document's Key Technical Decisions (quote them) ordered most
load-bearing first, and the load-bearing entries of ## Assumptions (the ones
whose failure would invalidate the plan), ordered.`,
  { label: 'classify-personas', phase: 'Draft', model: 'sonnet', schema: CLASSIFY_SCHEMA },
)

let personaSel = { productLens: false, designLens: false, securityLens: false, scopeGuardian: false, adversarial: false }
let documentType = 'plan'
let ktds = []
let loadBearingAssumptions = []
if (!classify) {
  log('Persona classifier failed — conditional personas and KTD refutation skipped this run (always-on coherence + feasibility only)')
  openQuestions.push('persona classification failed — conditional review coverage and KTD refutation did not run')
} else {
  // The selection is computed once and HELD for all rounds.
  personaSel = classify.personas
  documentType = classify.documentType
  ktds = classify.ktds
  loadBearingAssumptions = classify.loadBearingAssumptions
  if (classify.reasons.length) log('Conditional personas: ' + classify.reasons.join('; '))
}

// ============================================================
// S4 — Review loop (M5/M6/M7/M8/M9/M10/M13/M20). ONE loop counter; the
// persona stage self-disables after PERSONA_ROUNDS (never a second counter).
// ============================================================
phase('Review')

let primer = []                  // decision-primer entries (M20)
let carryFindings = []           // editor findings + overlap/fidelity findings carried into the next round's synthesis
let pendingDocEntries = []       // documentation entries queued for the next fixer batch
let spikeDone = false            // M10 boolean guard
let ktdPasses = 0                // <= KTD_PASSES_CAP
let ktdDirty = false             // set when a fixer touched the KTD section
let ktdHaltUsed = 0              // <= KTD_HALT_CAP
let haltClassUsed = 0            // <= HALT_CLASS_CAP (lifetime counter)
let refutedKtdOverflow = 0       // refuted-KTD findings beyond KTD_HALT_CAP — nonzero VOIDS any READY exit
let refutedKtdOverflowTitles = []
let editorVerdict = null
let readyExit = false

// M20: literal first-round marker; afterwards renders Applied/Rejected state
// with ~300-char evidence windows.
const primerBlock = () => (primer.length
  ? `<decision-primer>\n${primer.map((e) => `- round ${e.round} ${e.decision}: [${e.section}] ${e.title} (reviewer: ${e.reviewer}, confidence ${e.confidence}) — evidence: ${e.evidence}`).join('\n')}\n</decision-primer>`
  : '<decision-primer>none — first round</decision-primer>')

// Confidence-anchor rubric — ce-doc-review's behavioral anchors, condensed.
const ANCHOR_RUBRIC = `Confidence is a discrete anchor — exactly one of 0/25/50/75/100, never a value
between anchors. Pick the anchor whose behavioral criterion you can honestly
self-apply:
- 0 — Not confident at all: a false positive that does not stand up to light scrutiny. Do not emit.
- 25 — Somewhat confident: might be real but could be a false positive; you were not able to verify. Do not emit.
- 50 — Moderately confident: verified as real but advisory — "nothing breaks, but..." findings land here (FYI tier).
- 75 — Highly confident: double-checked and verified the issue will be hit in practice; requires naming a concrete downstream consequence someone will hit.
- 100 — Absolutely certain: double-checked and confirmed; the document text leaves no room for interpretation.
Anchor and severity are independent axes.`

// Prompt factories take only positional data plus the locked blocks above —
// NEVER the author's or any prior agent's free-text detail/reasoning (M6).
// Personas receive the document PATH, not its content: ce-doc-review feeds
// document_content, but this coordinator cannot read files (runtime-forced
// deviation) — every reviewer reads the document itself.
const reviewPrompt = (p, r) => `Review the ${documentType} document at ${planPath} — read the document yourself, fully.
Document type: ${documentType}. Origin document: ${ORIGIN || 'none'}.

${CONFIRMED_INTENT}

${CODEBASE_CONTEXT}

${primerBlock()}

${ANCHOR_RUBRIC}

Report findings with section, title, severity (P0|P1|P2|P3), findingType
(error|omission), confidence (the anchor), autofixClass
(safe_auto|gated_auto|manual), evidence (verbatim quote from the document),
whyItMatters, and suggestedFix ("" when no concrete fix exists). Do not
re-raise findings the decision primer marks as settled unless the document
text they referenced has materially changed.${p.key === 'coherence' && repo && repo.contextMdPath ? `
A domain glossary exists at ${repo.contextMdPath} — check the plan's vocabulary against it and flag conflicts as findings.` : ''}`

const refutePrompt = (f) => `Attempt to REFUTE this document-review finding against the actual document and codebase.
Finding (${f.severity}, ${f.findingType}, reviewer: ${f.reviewer}): [${f.section}] ${f.title}
Evidence quoted: ${window300(f.evidence)}
Why it matters: ${f.whyItMatters}
Suggested fix: ${f.suggestedFix || '(none)'}
Document: ${planPath} — read it yourself.

${CODEBASE_CONTEXT}

Where to look: ${repo && repo.relevantFiles.length ? repo.relevantFiles.join(', ') : 'derive the relevant files from the document'}`

const ktdRefutePrompt = (k) => `Claim under refutation (quoted from the plan document):
${k}

Document: ${planPath} — read the document's CURRENT Key Technical Decisions and
Assumptions sections. On a re-refutation pass the quoted claim may be stale:
locate the CURRENT decision corresponding to this claim's head in the document
and refute THAT text, not the quoted snapshot.

${CODEBASE_CONTEXT}

Where to look: ${repo && repo.relevantFiles.length ? repo.relevantFiles.join(', ') : 'derive the relevant files from the document'}

Attempt to refute this technical decision/assumption against the actual
codebase. IMPORTANT — override of your default: if you can neither confirm nor
refute it from code and docs, return verdict 'unverifiable', NOT 'refuted'.
Fail-if-uncertain here means surface, not auto-block.`

const fixerPrompt = (fixNow, docList) => `Plan document to edit: ${planPath} (edit ONLY this file).

${CONFIRMED_INTENT}

Fix-now findings (apply each fix):
${fixNow.map((f) => `- [${f.section}] (${f.severity}, reviewer: ${f.reviewer}, refutationSurvived: ${f.refutationSurvived ? 'true' : 'false'}) ${f.title}
  evidence: ${window300(f.evidence)}
  fix: ${f.suggestedFix}`).join('\n') || '- none'}

Document-as-known-cost entries (append each as a documentation entry to its
target section; Assumptions entries MUST name the observation that would
invalidate them):
${docList.map((f) => `- [route to: ${f.routedTo}] ${f.title}: ${window300(f.whyItMatters || f.evidence || f.title)}`).join('\n') || '- none'}

Before applying anything, scan the whole batch for cross-finding tensions —
two fixes that contradict each other, or a premise challenge that moots
others. Return conflicting findings UNAPPLIED with the conflict named in
reason.

You may apply safe_auto@confidence-100 fixes and refutation-survived fixes —
every entry in your fix-now list is one or the other. PROTECTED SURFACES: any
change to the Requirements set, Scope Boundaries, or unit uid/Dependencies
structure requires refutationSurvived=true — otherwise return it unapplied. A
fix may NEVER widen scope; return scope-widening proposals unapplied with
reason starting 'scope-widening:'. U-IDs and R-IDs may be ADDED (next free
number, gaps fine) or deleted, NEVER renumbered or reassigned.

Report every finding as applied (title), documented (title + routedTo), or
unapplied (title + reason); report sectionsTouched (the H2 sections you
edited).`

const checkerPrompt = (applied, pending) => `Plan document: ${planPath} — read the document as it now stands.
${applied.length ? `Applied fixes to verify (did each land, and does the edit match the fix's intent?):
${applied.map((f) => `- [${f.section}] ${f.title}: ${f.suggestedFix || '(documentation entry)'}`).join('\n')}` : 'No applied fixes to verify — return fixesVerified: [].'}
${pending.length ? `Still-pending findings (report as staleFindings the titles whose section/evidence no longer matches the post-edit text):
${pending.map((f) => `- [${f.section}] ${f.title}: ${window300(f.evidence)}`).join('\n')}` : 'No pending findings — return staleFindings: [].'}
Extract every unit's uid, name, Files list and Dependencies; every R-ID; the
unit count and requirement count; the H2 sections present. Read-only — change
nothing.`

const refixUidPrompt = (violations) => `Plan document to edit: ${planPath} (edit ONLY this file).
A post-edit check found U-ID/R-ID identity violations. Restore these
identities — never renumber; re-add as the same uid:
${violations.map((v) => '- ' + v).join('\n')}
Rules: U-IDs and R-IDs may be ADDED (next free number, gaps fine) or deleted
with justification, NEVER renumbered or reassigned; uid-to-name identity pairs
must not swap. Edit the protected surfaces (Requirements set, Scope
Boundaries, uid/Dependencies structure) ONLY as far as needed to restore the
listed identities — no further. NEVER widen scope.`

const editorPrompt = (r) => `${CONFIRMED_INTENT}

Plan document: ${planPath} — read the ENTIRE document fresh and judge it on
your own reading. Round ${r} of ${EDITOR_ROUNDS}.

${CODEBASE_CONTEXT}

${primerBlock()}

${ANCHOR_RUBRIC}

You are READ-ONLY. READY means: unchanged, execution-ready, you would stake
the run on it. REVISED means: this plan needs revision — return the problems
as findings (section/title/severity/findingType/confidence/autofixClass/
evidence/whyItMatters/suggestedFix); they will be refuted, fixed, and verified
by other agents, never by you. Report design-level unknowns in designUnknowns
(architecture choices, unvalidated technical assumptions — things to resolve
BEFORE execution) and per-unit approachValidated plus uphill unknowns. Fill
the evidence block (planPath, unitCount, requirementCount, sectionsPresent)
from your OWN reading — it is cross-checked; a READY verdict with wrong
evidence is discarded.`

const spikePrompt = (u) => `Design unknown to investigate: ${u.unknown}
Affected units: ${u.affectedUids.join(', ') || 'unspecified'}
Why design-level: ${u.whyDesignLevel}
Plan document: ${planPath}

${CODEBASE_CONTEXT}

Investigate by READING code and docs only. You may NOT run tests, build the
app, execute the code, or probe runtime behavior — a question answerable only
at runtime returns resolution 'runtime-blocked'. Return the unknown, the
resolution (resolved | documented-trade-off | runtime-blocked), the evidence
you found, and a recommendation.`

const reviseSpikePrompt = (spikeResults) => `Plan document to edit: ${planPath} (edit ONLY this file).

${CONFIRMED_INTENT}

Spike investigation results:
${spikeResults.map((s) => `- [${s.resolution}] ${s.unknown}
  evidence: ${window300(s.evidence)}
  recommendation: ${s.recommendation}`).join('\n')}

Rules: resolved → update the affected units' Approach (and KTD rationale if
implicated) per the recommendation; documented-trade-off → append a testable
entry to ## Assumptions naming the invalidating observation; runtime-blocked →
append to ## Open Questions. Same uid/R-ID rules as a fix round: U-IDs and
R-IDs may be ADDED (next free number, gaps fine) or deleted, NEVER renumbered
or reassigned. Protected surfaces (Requirements set, Scope Boundaries,
uid/Dependencies structure) are OFF-LIMITS entirely — no spike result carries
refutation-survived authority. Report applied/documented/unapplied and
sectionsTouched.`

// ---- shared pure-JS checks (M9/M13/M-X1) ----
// Identity is about WHICH unit a uid names, not how the name is typeset: fixers
// legitimately add backticks or rewrap whitespace while editing surrounding text,
// and that must not read as a rename (observed live: playground run 2026-06-10).
const canonUnitName = (s) => String(s).replace(/`/g, '').replace(/\s+/g, ' ').trim()
const uidStabilityViolations = (baseline, current, rIdEditAuthorized) => {
  const v = []
  const baseByUid = new Map(baseline.pairs.map((p) => [p.uid, p.name]))
  const curByUid = new Map(current.uidNamePairs.map((p) => [p.uid, p.name]))
  for (const [uid, name] of baseByUid) {
    if (curByUid.has(uid) && canonUnitName(curByUid.get(uid)) !== canonUnitName(name)) v.push(`uid ${uid} renamed: "${name}" is now "${curByUid.get(uid)}" (identity swap)`)
  }
  for (const [uid, name] of baseByUid) {
    if (!curByUid.has(uid)) {
      const moved = current.uidNamePairs.find((p) => canonUnitName(p.name) === canonUnitName(name) && p.uid !== uid)
      if (moved) v.push(`unit "${name}" moved from ${uid} to ${moved.uid} (renumber signature)`)
    }
  }
  const curRIds = new Set(current.rIds)
  const missingR = baseline.rIds.filter((id) => !curRIds.has(id))
  if (missingR.length && !rIdEditAuthorized) v.push(`R-ID(s) vanished without an authorized protected-surface fix: ${missingR.join(', ')}`)
  return v
}

const fileOverlapViolations = (unitFiles) => {
  const adj = new Map(unitFiles.map((u) => [u.uid, u.dependsOn || []]))
  const reaches = (from, to) => {
    const seen = new Set([from])
    const queue = [from]
    while (queue.length) {
      const cur = queue.shift()
      for (const d of (adj.get(cur) || [])) {
        if (d === to) return true
        if (!seen.has(d)) { seen.add(d); queue.push(d) }
      }
    }
    return false
  }
  const owners = new Map()
  for (const u of unitFiles) for (const f of (u.files || [])) {
    if (!owners.has(f)) owners.set(f, [])
    owners.get(f).push(u.uid)
  }
  const out = []
  for (const [f, uids] of owners) {
    for (let i = 0; i < uids.length; i++) {
      for (let j = i + 1; j < uids.length; j++) {
        if (!reaches(uids[i], uids[j]) && !reaches(uids[j], uids[i])) out.push({ file: f, a: uids[i], b: uids[j] })
      }
    }
  }
  return out
}

// Dispatch the shared post-mutation checker, with the design's ONE bounded
// retry. Returns the checker result or null (caller halts fail-closed).
const runChecker = async (tag, applied, pending, phaseName) => {
  const p = checkerPrompt(applied, pending)
  let c = await agent(p, { label: `check-${tag}`, phase: phaseName, model: 'sonnet', schema: CHECKER_SCHEMA })
  if (!c) c = await agent(p, { label: `check-${tag}-retry`, phase: phaseName, model: 'sonnet', schema: CHECKER_SCHEMA })
  return c
}

// JS battery over a checker result. Returns a halt payload or null; mutates
// carryFindings (reopened/stale/overlap), counts, and uidBaseline.
const postMutationChecks = async (checkerIn, ctx) => {
  let current = checkerIn
  // 1. Fix fidelity — counted against the EXPECTED set, not the returned set:
  // an applied title with no fixesVerified entry is treated as landed:false.
  const verified = new Map(current.fixesVerified.map((v) => [v.title, v]))
  for (const af of ctx.applied) {
    const v = verified.get(af.title)
    const failed = !v ? 'checker did not account for this fix' : (!v.landed || !v.matchesIntent ? (v.note || 'fix did not match intent') : '')
    if (failed) {
      carryFindings.push({ ...af, title: af.title + ' [fix did not land faithfully]', refutationSurvived: false })
      log(`Fix "${af.title}" did not land faithfully (${failed}) — re-opened for the next round`)
    }
  }
  // 2. Staleness: pending findings whose anchor text no longer exists drop.
  if (current.staleFindings.length) {
    const stale = new Set(current.staleFindings)
    const before = carryFindings.length
    carryFindings = carryFindings.filter((f) => !stale.has(f.title))
    if (before > carryFindings.length) log(`${before - carryFindings.length} stale finding(s) dropped after edits`)
  }
  // 3. uid/R-ID stability diff — ROUND-FAILING: one re-fix dispatch, then halt.
  let violations = uidStabilityViolations(uidBaseline, current, ctx.rIdEditAuthorized)
  if (violations.length) {
    log(`uid/R-ID stability violation after ${ctx.tag}: ${violations.join('; ')}`)
    await agent(refixUidPrompt(violations), { label: `refix-uid-${ctx.tag}`, phase: ctx.phase, schema: FIX_SCHEMA })
    const recheck = await agent(checkerPrompt([], []), { label: `check-refix-${ctx.tag}`, phase: ctx.phase, model: 'sonnet', schema: CHECKER_SCHEMA })
    if (!recheck) {
      return { haltStage: 'S4-uid-stability', haltReason: `uid stability re-check failed after violation: ${violations.join('; ')}`, nextStep: `Restore the original U-ID/R-ID identities in ${planPath} by hand (draft preserved at ${planPath}), then re-invoke nadia-plan` }
    }
    violations = uidStabilityViolations(uidBaseline, recheck, ctx.rIdEditAuthorized)
    if (violations.length) {
      return { haltStage: 'S4-uid-stability', haltReason: `uid/R-ID stability violated after re-fix: ${violations.join('; ')}`, nextStep: `Restore the original U-ID/R-ID identities in ${planPath} by hand (draft preserved at ${planPath}), then re-invoke nadia-plan` }
    }
    current = recheck
  }
  // 4. File-overlap cross-check (M13): no file owned by two units without a
  // dependsOn path — independent units sharing a file produce same-wave merge
  // conflicts in ce-work.
  for (const o of fileOverlapViolations(current.unitFiles)) {
    carryFindings.push({
      section: 'Implementation Units',
      title: `file ${o.file} owned by ${o.a} and ${o.b} without a dependency path`,
      severity: 'P1', findingType: 'error', confidence: 100, autofixClass: 'manual', suggestedFix: '',
      evidence: o.file,
      whyItMatters: 'independent units sharing a file produce same-wave merge conflicts in ce-work',
      reviewer: 'coordinator',
    })
    log(`File-overlap violation: ${o.file} owned by ${o.a} and ${o.b} without a dependency path — carried as a finding`)
  }
  // 5. Evidence cross-check + baseline update (AFTER the stability check passed).
  unitCount = current.unitCount
  requirementCount = current.requirementCount
  uidBaseline = { pairs: current.uidNamePairs, rIds: current.rIds }
  return null
}

const CHECKER_HALT = (tag) => ({
  haltStage: 'S4-post-mutation-check',
  haltReason: `post-mutation checker failed twice (${tag}) — uid stability and fix fidelity unverifiable`,
  nextStep: `Inspect the draft at ${planPath} for uid/R-ID corruption (draft preserved at ${planPath}), then re-invoke nadia-plan`,
})

// ---- the ONE loop ----
for (let r = 1; r <= EDITOR_ROUNDS; r++) {
  if (belowBudgetFloor()) {
    log(`Budget floor reached before review round ${r} — halting with the draft as-is`)
    return summary('halted', {
      haltStage: 'S4-budget-floor',
      haltReason: `token budget floor reached before review round ${r}`,
      nextStep: `Raise the token budget or lower editorRounds (draft preserved at ${planPath}), then re-invoke nadia-plan`,
    })
  }
  roundsUsed = r

  // ---- a. Personas (rounds 1..PERSONA_ROUNDS only) — M6 ----
  const roundFindings = []
  if (r <= PERSONA_ROUNDS) {
    personaRoundsUsed = r
    const personaRosterAll = [
      { key: 'coherence', type: 'compound-engineering:ce-coherence-reviewer' },
      { key: 'feasibility', type: 'compound-engineering:ce-feasibility-reviewer' },
      ...(personaSel.productLens ? [{ key: 'product', type: 'compound-engineering:ce-product-lens-reviewer' }] : []),
      ...(personaSel.designLens ? [{ key: 'design', type: 'compound-engineering:ce-design-lens-reviewer' }] : []),
      ...(personaSel.securityLens ? [{ key: 'security', type: 'compound-engineering:ce-security-lens-reviewer' }] : []),
      ...(personaSel.scopeGuardian ? [{ key: 'scope', type: 'compound-engineering:ce-scope-guardian-reviewer' }] : []),
      ...(personaSel.adversarial ? [{ key: 'adversarial', type: 'compound-engineering:ce-adversarial-document-reviewer' }] : []),
    ]
    const personaRoster = personaRosterAll.slice(0, PERSONA_CAP)
    if (personaRosterAll.length > personaRoster.length) log(`Persona cap: ${personaRosterAll.length - personaRoster.length} persona(s) beyond ${PERSONA_CAP} dropped this round`)
    // Barrier justified: synthesis (b) needs the full round's finding set for dedup/promotion.
    const reviews = await parallel(personaRoster.map((p) => () =>
      agent(reviewPrompt(p, r), { label: `review-r${r}-${p.key}`, phase: 'Review', agentType: p.type, schema: PERSONA_FINDINGS_SCHEMA })))
    reviews.forEach((rev, i) => {
      if (!rev) {
        log(`Persona ${personaRoster[i].key} failed round ${r} — its lens is uncovered this round`)
        return
      }
      roundFindings.push(...rev.findings.map((f) => ({ ...f, reviewer: personaRoster[i].key })))
    })
  } else {
    log(`Round ${r}: editor-convergence round — persona stage disabled`)
  }

  // ---- b. Synthesis (pure coordinator JS — zero agents). Trimmed step set
  // per decisions M6 (dedup/promotion/anchor gating); deliberately dropped
  // base steps: same-persona premise collapse, premise-dependency chain
  // linking, manual->auto promotion — the M8 cross-finding conflict scan in
  // the fixer prompt is the designated partial substitute. ----
  const rawFindings = [...roundFindings, ...carryFindings]
  carryFindings = []
  const lowAnchor = rawFindings.filter((f) => f.confidence === 0 || f.confidence === 25)
  if (lowAnchor.length) log(`Dropped ${lowAnchor.length} low-anchor finding(s)`)
  const surviving = rawFindings.filter((f) => f.confidence >= 50)

  const groups = new Map()
  for (const f of surviving) {
    const key = fingerprint(f)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  const keepDistinct = (a, b) => !!a.suggestedFix && !!b.suggestedFix
    && !a.suggestedFix.includes(b.suggestedFix) && !b.suggestedFix.includes(a.suggestedFix)
    && a.findingType !== b.findingType
  const mergePair = (a, b) => {
    const donor = SEV_ORDER[a.severity] < SEV_ORDER[b.severity] ? a
      : SEV_ORDER[b.severity] < SEV_ORDER[a.severity] ? b
      : a.confidence > b.confidence ? a
      : b.confidence > a.confidence ? b
      : (a.suggestedFix <= b.suggestedFix ? a : b)
    return {
      ...donor,
      severity: SEV_ORDER[a.severity] <= SEV_ORDER[b.severity] ? a.severity : b.severity,
      confidence: Math.max(a.confidence, b.confidence),
      evidence: a.evidence === b.evidence ? a.evidence : a.evidence + ' | ' + b.evidence,
      reviewer: a.reviewer === b.reviewer ? a.reviewer : a.reviewer + '+' + b.reviewer,
    }
  }
  let merged = []
  const conflictPairs = []
  for (const [, group] of groups) {
    let acc = null
    for (const f of group) {
      if (acc === null) { acc = f; continue }
      // The ONLY keep-distinct exception lives HERE (step 2), feeding step 5.
      if (keepDistinct(acc, f)) { conflictPairs.push([acc, f]); acc = null }
      else acc = mergePair(acc, f)
    }
    if (acc) {
      // Step 3 — cross-persona promotion: 2+ distinct reviewers on one
      // fingerprint -> anchor +1 step (50->75, 75->100; 100 stays).
      const distinctReviewers = new Set(group.map((f) => f.reviewer)).size
      if (distinctReviewers >= 2 && acc.confidence < 100) {
        acc = { ...acc, confidence: acc.confidence === 50 ? 75 : 100, promoted: true }
      }
      merged.push(acc)
    }
  }
  // Step 4 — R29 primer suppression (M20), 300-char-window overlap with
  // full-text fallback (neither contains the other -> treat as NEW, keep).
  const suppressedThisRound = []
  merged = merged.filter((f) => {
    const pe = primer.find((e) =>
      ['rejected-refuted', 'rejected-suppressed', 'documented'].includes(e.decision)
      && fingerprint(e) === fingerprint(f)
      && (String(f.evidence).includes(e.evidence) || e.evidence.includes(window300(f.evidence))))
    if (pe) {
      log(`R29 suppression: "${f.title}" — settled in round ${pe.round} (${pe.decision})`)
      suppressedThisRound.push(f)
      return false
    }
    return true
  })
  // Step 5 — contradiction resolution: consumes exactly the kept-distinct pairs.
  for (const [a, b] of conflictPairs) {
    merged.push({
      section: a.section,
      title: `${a.title} / ${b.title} (conflicting fixes — tradeoff)`,
      severity: SEV_ORDER[a.severity] <= SEV_ORDER[b.severity] ? a.severity : b.severity,
      findingType: 'error',
      confidence: Math.max(a.confidence, b.confidence),
      autofixClass: 'manual',
      evidence: a.evidence === b.evidence ? a.evidence : a.evidence + ' | ' + b.evidence,
      whyItMatters: `Two reviewers propose contradictory fixes: (1) ${a.suggestedFix} (2) ${b.suggestedFix} — resolve as a tradeoff.`,
      suggestedFix: '',
      reviewer: a.reviewer === b.reviewer ? a.reviewer : a.reviewer + '+' + b.reviewer,
    })
  }
  // Step 6 — deterministic sort: severity -> errors before omissions ->
  // anchor descending -> fingerprint lexicographic.
  merged.sort((a, b) =>
    (SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
    || ((a.findingType === 'error' ? 0 : 1) - (b.findingType === 'error' ? 0 : 1))
    || (b.confidence - a.confidence)
    || (fingerprint(a) < fingerprint(b) ? -1 : fingerprint(a) > fingerprint(b) ? 1 : 0))
  const roundFyi = merged.filter((f) => f.confidence === 50)
  pendingFyi.push(...roundFyi)
  const actionable = merged.filter((f) => f.confidence >= 75)

  const ktdClaims = [...ktds, ...loadBearingAssumptions]
  const ktdDue = ktdClaims.length > 0 && ktdPasses < KTD_PASSES_CAP && (r === 1 || ktdDirty)

  const roundRefuted = []     // findings dropped by refutation this round (primer: rejected-refuted)
  const roundDroppedCap = []  // cap-overflow findings this round (primer: dropped-cap)
  let confirmedGating = []
  let nonGatingActionable = []

  if (actionable.length === 0 && !ktdDue && !pendingDocEntries.length) {
    log(`Round ${r}: no actionable findings — skipping refutation and fix application`)
  } else {
    // ---- c. Refuters — M7 ----
    const isGating = (f) => f.severity === 'P0' || f.severity === 'P1' || (!!f.promoted && f.findingType === 'error' && f.autofixClass === 'manual')
    const isHaltClass = (f) => f.severity === 'P0' && f.autofixClass === 'manual' && f.suggestedFix === ''
    const gatingAll = actionable.filter(isGating)
    nonGatingActionable = actionable.filter((f) => !isGating(f))
    const gating = gatingAll.slice(0, FINDING_REFUTER_CAP)
    const gatingOverflow = gatingAll.slice(FINDING_REFUTER_CAP)
    if (gatingOverflow.length) {
      log(`Refuter cap: ${gatingOverflow.length} gating finding(s) beyond ${FINDING_REFUTER_CAP} routed to documentation without verification`)
      residualFindings.push(...gatingOverflow.map((f) => ({ title: f.title, section: f.section, class: 'dropped-cap', reason: `refuter cap ${FINDING_REFUTER_CAP}/round` })))
      roundDroppedCap.push(...gatingOverflow)
    }

    // Halt-class majority — evaluated BEFORE single refutation. The only
    // finding species that can stop the run: P0 + manual + no suggested fix.
    const haltCandidates = gating.filter(isHaltClass)
    const singles = gating.filter((f) => !isHaltClass(f))
    const haltDocs = []
    for (let i = 0; i < haltCandidates.length; i++) {
      const f = haltCandidates[i]
      if (haltClassUsed >= HALT_CLASS_CAP) {
        log(`Halt-class cap: "${f.title}" beyond ${HALT_CLASS_CAP} majority procedures — routed document-as-known-cost`)
        residualFindings.push({ title: f.title, section: f.section, class: 'dropped-cap', reason: `halt-class majority cap ${HALT_CLASS_CAP}/run` })
        roundDroppedCap.push(f)
        haltDocs.push(f)
        continue
      }
      haltClassUsed++
      const votes = await parallel([0, 1, 2].map((j) => () =>
        agent(refutePrompt(f), { label: `refute-halt-r${r}-f${i}-v${j}`, phase: 'Review', model: 'sonnet', agentType: 'skeptical-refuter', schema: VERDICT_SCHEMA })))
      // nulls count as refuted — fail-closed on the runtime side, conservative against halting.
      const sustainedVotes = votes.filter((v) => v && !v.refuted).length
      if (sustainedVotes >= 2) {
        openQuestions.push(`${f.title}: ${f.whyItMatters}`)
        return summary('halted', {
          haltStage: 'S4-halt-class-finding',
          haltReason: `2-of-3 refuters sustained: ${f.title}`,
          nextStep: `Resolve the sustained blocking finding (draft preserved at ${planPath}), then re-invoke nadia-plan`,
        })
      }
      log(`Halt-class finding "${f.title}" refuted by majority — dropped`)
      roundRefuted.push(f)
    }

    // Single refuters for the remaining gating findings — pipeline: each
    // verdict independently flips one finding, no barrier needed.
    const verdicts = await pipeline(singles, (f, _o, i) =>
      agent(refutePrompt(f), { label: `refute-r${r}-f${i}`, phase: 'Review', model: 'sonnet', agentType: 'skeptical-refuter', schema: VERDICT_SCHEMA }))
    confirmedGating = []
    singles.forEach((f, i) => {
      const v = verdicts[i]
      if (v && !v.refuted) { confirmedGating.push(f); return }
      if (v) log(`Finding "${f.title}" refuted: ${v.reason}`)
      else log(`Refuter died for "${f.title}" — dropped per fail-closed default`)
      roundRefuted.push(f)
    })

    // Class B — KTD/assumption refutation (once in round 1; re-refuted at most
    // once more after a fixer touched the KTD section).
    if (ktdDue) {
      const pass = ktdPasses + 1
      const claims = ktdClaims.slice(0, KTD_CAP)
      const claimOverflow = ktdClaims.slice(KTD_CAP)
      if (claimOverflow.length) {
        log(`KTD cap: ${claimOverflow.length} claim(s) beyond ${KTD_CAP} not refuted — listed in run summary openQuestions`)
        openQuestions.push(...claimOverflow.map((k) => `unrefuted claim (KTD cap): ${head80(k)}`))
      }
      const ktdVerdicts = await pipeline(claims, (k, _o, i) =>
        agent(ktdRefutePrompt(k), { label: `ktd-refute-p${pass}-${i}`, phase: 'Review', model: 'sonnet', agentType: 'skeptical-refuter', schema: KTD_VERDICT_SCHEMA }))
      for (let i = 0; i < claims.length; i++) {
        const k = claims[i]
        const v = ktdVerdicts[i]
        if (!v) { log(`KTD refuter died for claim "${head80(k)}" — claim stands unrefuted`); continue }
        if (v.verdict === 'sustained') continue
        if (v.verdict === 'unverifiable') {
          // Fail-if-uncertain means surface, not auto-block.
          pendingDocEntries.push({ title: `unverifiable KTD: ${head80(k)}`, section: 'Key Technical Decisions', routedTo: 'Open Questions', whyItMatters: v.reason, evidence: k, confidence: 100 })
          openQuestions.push(`unverifiable KTD: ${head80(k)}: ${v.reason}`)
          continue
        }
        // refuted -> synthesize a HALT-CLASS-SHAPED finding and arbitrate it
        // with a dedicated majority allowance: no single refuter's verdict
        // halts the run, and no confirmed-wrong KTD can reach 'ready'.
        const kf = { section: 'Key Technical Decisions', title: `KTD refuted: ${head80(k)}`, severity: 'P0', findingType: 'error', confidence: 100, autofixClass: 'manual', evidence: k, whyItMatters: v.reason, suggestedFix: '', reviewer: 'ktd-refuter' }
        if (ktdHaltUsed < KTD_HALT_CAP) {
          ktdHaltUsed++
          const votes = await parallel([0, 1, 2].map((j) => () =>
            agent(refutePrompt(kf), { label: `refute-halt-ktd-p${pass}-${i}-v${j}`, phase: 'Review', model: 'sonnet', agentType: 'skeptical-refuter', schema: VERDICT_SCHEMA })))
          const sustainedVotes = votes.filter((vv) => vv && !vv.refuted).length
          if (sustainedVotes >= 2) {
            openQuestions.push(`KTD refuted: ${head80(k)}: ${v.reason}`)
            return summary('halted', {
              haltStage: 'S4-halt-class-finding',
              haltReason: `2-of-3 refuters sustained: KTD refuted: ${head80(k)}`,
              nextStep: `Rework the refuted Key Technical Decision (draft preserved at ${planPath}), then re-invoke nadia-plan`,
            })
          }
          log(`Refuted-KTD finding "${kf.title}" refuted by majority — dropped`)
          roundRefuted.push(kf)
        } else {
          refutedKtdOverflow++
          refutedKtdOverflowTitles.push(kf.title)
          openQuestions.push(kf.title)
          pendingDocEntries.push({ title: kf.title, section: kf.section, routedTo: 'Open Questions', whyItMatters: v.reason, evidence: k, confidence: 100 })
          residualFindings.push({ title: kf.title, section: kf.section, class: 'dropped-cap', reason: `KTD halt-majority allowance (${KTD_HALT_CAP}/run) exhausted` })
          roundDroppedCap.push(kf)
          log(`KTD halt-majority allowance exhausted — "${kf.title}" routed to Open Questions; READY exits are voided`)
        }
      }
      ktdPasses++
      ktdDirty = false
    }

    // ---- d. Reconciliation routing + ONE sequential batch fixer — M8 ----
    // Exactly decisions Q9's two authority classes: safe_auto@100 OR
    // refutation-survived. Everything else surviving documents, never applies.
    const fixNow = []
    const docCost = []
    for (const f of confirmedGating) {
      if (f.suggestedFix !== '') fixNow.push({ ...f, refutationSurvived: true })
      else docCost.push({ ...f, routedTo: routeTarget(f) })
    }
    for (const f of nonGatingActionable) {
      if (f.autofixClass === 'safe_auto' && f.confidence === 100 && f.suggestedFix !== '') fixNow.push({ ...f, refutationSurvived: false })
      else docCost.push({ ...f, routedTo: routeTarget(f) })
    }
    docCost.push(...gatingOverflow.map((f) => ({ ...f, routedTo: routeTarget(f) })))
    docCost.push(...haltDocs.map((f) => ({ ...f, routedTo: routeTarget(f) })))
    docCost.push(...pendingDocEntries)
    pendingDocEntries = []

    let fx = null
    let appliedSet = []
    if (!fixNow.length && !docCost.length) {
      log(`Round ${r}: nothing to fix or document — fixer and checker skipped`)
    } else {
      log(`Round ${r}: ${fixNow.length} fix-now, ${docCost.length} document-as-known-cost`)
      fx = await agent(fixerPrompt(fixNow, docCost), { label: `fix-round-${r}`, phase: 'Review', schema: FIX_SCHEMA })
      const routed = [...fixNow, ...docCost]
      if (!fx) {
        residualFindings.push(...routed.map((f) => ({ title: f.title, section: f.section, class: 'fixer-failed', reason: 'fixer agent failed' })))
        log(`Round ${r}: fixer failed — ${routed.length} finding(s) recorded as fixer-failed residuals`)
      } else {
        for (const u of fx.unapplied) {
          const orig = routed.find((f) => f.title === u.title)
          const section = orig ? orig.section : ''
          if (u.reason.startsWith('scope-widening:')) {
            residualFindings.push({ title: u.title, section, class: 'scope-widening-routed', reason: u.reason })
            openQuestions.push(u.title)
          } else {
            residualFindings.push({ title: u.title, section, class: 'unapplied-conflict', reason: u.reason })
          }
        }
        for (const dd of fx.documented) {
          const orig = routed.find((f) => f.title === dd.title)
          residualFindings.push({ title: dd.title, section: orig ? orig.section : '', class: 'documented', reason: `documented in ${dd.routedTo}` })
        }
        const unaccounted = routed.filter((f) => !fx.applied.includes(f.title) && !fx.documented.some((dd) => dd.title === f.title) && !fx.unapplied.some((uu) => uu.title === f.title))
        residualFindings.push(...unaccounted.map((f) => ({ title: f.title, section: f.section, class: 'fixer-failed', reason: 'fixer did not account for this finding' })))
        appliedSet = fixNow.filter((f) => fx.applied.includes(f.title))
      }
      ktdDirty = !!(fx && fx.sectionsTouched.some((s) => /key technical decisions/i.test(s)))

      // ---- e. Shared post-mutation checker + JS checks — M9/M13/M-X1 ----
      // The fixer dispatched (even if it died: mutation state unknown), so the
      // checker runs — defensive.
      const checker = await runChecker(`r${r}`, appliedSet, carryFindings, 'Review')
      if (!checker) return summary('halted', CHECKER_HALT(`round ${r}`))
      const ridAuth = !!(fx && appliedSet.some((f) => f.refutationSurvived) && fx.sectionsTouched.some((s) => /requirements/i.test(s)))
      const batteryHalt = await postMutationChecks(checker, { tag: `r${r}`, phase: 'Review', applied: appliedSet, rIdEditAuthorized: ridAuth })
      if (batteryHalt) return summary('halted', batteryHalt)
    }

    // Primer write — stage (d) is the SINGLE primer-write point; (c) and
    // synthesis step 4 only flag. One entry per finding, first bucket wins.
    const written = new Set()
    const writePrimer = (decision, f) => {
      if (written.has(f.title)) return
      written.add(f.title)
      primer.push({ round: r, decision, section: f.section, title: f.title, reviewer: f.reviewer || 'coordinator', confidence: f.confidence, evidence: window300(f.evidence || '') })
    }
    if (fx) {
      for (const t of fx.applied) { const orig = fixNow.find((f) => f.title === t); if (orig) writePrimer('applied', orig) }
      for (const dd of fx.documented) { const orig = [...fixNow, ...docCost].find((f) => f.title === dd.title); if (orig) writePrimer('documented', orig) }
      for (const u of fx.unapplied) { const orig = [...fixNow, ...docCost].find((f) => f.title === u.title); if (orig) writePrimer('unapplied-conflict', orig) }
    }
    for (const f of roundRefuted) writePrimer('rejected-refuted', f)
    for (const f of suppressedThisRound) writePrimer('rejected-suppressed', f)
    for (const f of roundDroppedCap) writePrimer('dropped-cap', f)
    for (const f of roundFyi) writePrimer('fyi', f)
  }

  // ---- f. Fresh editor verdict — M5 (runs before the spike branch, which
  // consumes its designUnknowns) ----
  const ed = await agent(editorPrompt(r), { label: `editor-r${r}`, phase: 'Review', agentType: 'plan-editor', schema: EDITOR_SCHEMA })
  editorVerdict = ed
  if (!ed) {
    log(`Editor died round ${r} — round counts as REVISED`)
    continue
  }
  // Coordinator recount: a self-report never gates alone (M-X1).
  const editorBlocking = (ed.findings || []).filter((x) => x.severity === 'P0' || x.severity === 'P1').length
  let evidenceMatches = ed.evidence.planPath === planPath && ed.evidence.unitCount === unitCount && ed.evidence.requirementCount === requirementCount

  if (ed.verdict === 'READY' && ed.blockingCount === 0 && editorBlocking === 0 && ed.designUnknowns.length === 0 && refutedKtdOverflow === 0 && evidenceMatches) {
    const minor = (ed.findings || []).filter((f) => f.severity === 'P2' || f.severity === 'P3')
    if (minor.length) {
      residualFindings.push(...minor.map((f) => ({ title: f.title, section: f.section, class: 'documented', reason: 'editor P2/P3 finding on an accepted READY verdict — documented, not churned' })))
      log(`Editor READY with ${minor.length} P2/P3 finding(s) — recorded as documented residuals (anti-churn)`)
    }
    readyExit = true
    break
  }
  if (ed.verdict === 'READY' && refutedKtdOverflow > 0) {
    // No later round can clear this state — the loop deliberately rides to the cap halt.
    log(`Editor READY voided: ${refutedKtdOverflow} refuted-KTD finding(s) exceeded the majority allowance`)
  } else if (ed.verdict === 'READY' && (ed.blockingCount !== editorBlocking || editorBlocking > 0)) {
    log(`Editor READY rejected: blocking mismatch (self-reported ${ed.blockingCount}, counted ${editorBlocking})`)
  } else if (ed.verdict === 'READY' && ed.designUnknowns.length > 0) {
    log(`Editor READY treated as REVISED: ${ed.designUnknowns.length} design unknown(s) outstanding`)
  } else if (ed.verdict === 'READY' && !evidenceMatches) {
    // READY failing ONLY on count/path evidence: one arbitration dispatch per
    // round — the checker, not either self-report, owns the counts. This
    // breaks the author-miscount deadlock when no mutation ever occurred.
    const arb = await agent(checkerPrompt([], []), { label: `check-evidence-r${r}`, phase: 'Review', model: 'sonnet', schema: CHECKER_SCHEMA })
    if (arb) {
      unitCount = arb.unitCount
      requirementCount = arb.requirementCount
      uidBaseline = { pairs: arb.uidNamePairs, rIds: arb.rIds }
      evidenceMatches = ed.evidence.planPath === planPath && ed.evidence.unitCount === unitCount && ed.evidence.requirementCount === requirementCount
      if (evidenceMatches) {
        const minor = (ed.findings || []).filter((f) => f.severity === 'P2' || f.severity === 'P3')
        if (minor.length) {
          residualFindings.push(...minor.map((f) => ({ title: f.title, section: f.section, class: 'documented', reason: 'editor P2/P3 finding on an accepted READY verdict — documented, not churned' })))
          log(`Editor READY with ${minor.length} P2/P3 finding(s) — recorded as documented residuals (anti-churn)`)
        }
        readyExit = true
        break
      }
    }
    log(`Editor READY rejected: evidence mismatch (claims ${ed.evidence.unitCount} units / ${ed.evidence.requirementCount} requirements at ${ed.evidence.planPath}; checker says ${unitCount} / ${requirementCount} at ${planPath})`)
  }
  // Any rejected READY is treated as REVISED: nothing dropped silently.
  // Editor findings are tagged with their reviewer so downstream prompt
  // factories never interpolate a missing field.
  carryFindings.push(...(ed.findings || []).map((f) => ({ ...f, reviewer: f.reviewer || 'editor' })))

  // ---- g. Spike branch — M10 (boolean-guarded, once per run; NOT a loop) ----
  if (ed.designUnknowns.length) {
    if (r === EDITOR_ROUNDS) {
      // No editor round remains to consume the results — spiking would spend
      // agents on a document nobody re-verdicts.
      openQuestions.push(...ed.designUnknowns.map((u) => u.unknown))
      log(`Design unknowns on the final round — spike branch skipped (${ed.designUnknowns.length} unknown(s) routed to Open Questions and the halt reason)`)
    } else if (!SPIKES_ENABLED) {
      for (const u of ed.designUnknowns) {
        pendingDocEntries.push({ title: `design unknown: ${u.unknown}`, section: 'Open Questions', routedTo: 'Open Questions', whyItMatters: u.whyDesignLevel, evidence: u.unknown, confidence: 100 })
        openQuestions.push(u.unknown)
      }
      log(`Spikes disabled by args.spikes=false — ${ed.designUnknowns.length} design unknown(s) routed to Open Questions`)
    } else if (spikeDone) {
      carryFindings.push(...ed.designUnknowns.map((u) => ({
        section: 'Implementation Units', title: `design unknown: ${u.unknown}`, severity: 'P1', findingType: 'omission',
        confidence: 100, autofixClass: 'manual', suggestedFix: '', evidence: u.unknown,
        whyItMatters: `${u.whyDesignLevel} (affects ${u.affectedUids.join(', ') || 'unspecified units'})`, reviewer: 'editor',
      })))
      log(`Spike branch already used this run — ${ed.designUnknowns.length} design unknown(s) ride as blocking findings`)
    } else {
      spikeDone = true
      const spiked = ed.designUnknowns.slice(0, SPIKE_CAP)
      const spikeOverflow = ed.designUnknowns.slice(SPIKE_CAP)
      if (spikeOverflow.length) {
        log(`Spike cap: ${spikeOverflow.length} design unknown(s) beyond ${SPIKE_CAP} routed to Open Questions`)
        for (const u of spikeOverflow) {
          openQuestions.push(u.unknown)
          pendingDocEntries.push({ title: `design unknown: ${u.unknown}`, section: 'Open Questions', routedTo: 'Open Questions', whyItMatters: u.whyDesignLevel, evidence: u.unknown, confidence: 100 })
        }
      }
      const spikeReturns = await pipeline(spiked, (u, _o, i) =>
        agent(spikePrompt(u), { label: `spike-${i}`, phase: 'Review', model: 'sonnet', schema: SPIKE_SCHEMA }))
      const spikeResults = spiked.map((u, i) => {
        if (spikeReturns[i]) return spikeReturns[i]
        log(`Spike ${i} died — "${u.unknown}" treated as runtime-blocked`)
        return { unknown: u.unknown, resolution: 'runtime-blocked', evidence: '(spike agent failed)', recommendation: 'investigate by hand' }
      })
      for (const s of spikeResults) if (s.resolution === 'runtime-blocked') openQuestions.push(s.unknown)
      // ONE revision pass (label prefix-disjoint from spike- investigations).
      const rev = await agent(reviseSpikePrompt(spikeResults), { label: 'revise-spike', phase: 'Review', schema: FIX_SCHEMA })
      if (!rev) log('Spike revision agent failed — spike results were not folded into the document')
      const spikeChecker = await runChecker('spike', [], carryFindings, 'Review')
      if (!spikeChecker) return summary('halted', CHECKER_HALT('spike revision'))
      const spikeBatteryHalt = await postMutationChecks(spikeChecker, { tag: 'spike', phase: 'Review', applied: [], rIdEditAuthorized: false })
      if (spikeBatteryHalt) return summary('halted', spikeBatteryHalt)
      // The (f) exit predicate already rejects READY while designUnknowns
      // exist, so this round continues and the NEXT round's editor verdicts
      // on the post-revision document — the branch never voids a READY.
    }
  }
}

// Cap exhaustion — never a silent fall-through to S5.
if (!readyExit) {
  log(`Editor loop exhausted ${EDITOR_ROUNDS} round(s) without READY — halting with unresolved concerns`)
  let haltReason
  if (editorVerdict) {
    const parts = [
      ...(editorVerdict.findings || []).filter((f) => f.severity === 'P0' || f.severity === 'P1').map((f) => f.title),
      ...(editorVerdict.designUnknowns || []).map((u) => u.unknown),
      ...refutedKtdOverflowTitles,
    ]
    haltReason = parts.length
      ? `editor loop exhausted ${EDITOR_ROUNDS} round(s) without READY — unresolved: ${parts.join('; ')}`
      : 'editor READY repeatedly rejected on evidence mismatch — verify counts'
  } else {
    haltReason = `editor failed in the final round — carried: ${carryFindings.map((f) => f.title).join('; ') || 'none'}`
  }
  return summary('halted', {
    haltStage: 'S4-editor-cap',
    haltReason,
    nextStep: `Review the draft at ${planPath}, resolve the listed concerns (or raise editorRounds), then re-invoke nadia-plan`,
  })
}

// ============================================================
// S5 — Gates (M11/M12/M13/M14/M15)
// ============================================================
phase('Gates')
if (belowBudgetFloor()) {
  log('Budget floor reached before the gates — plan reviewed but unverified')
  return summary('halted', {
    haltStage: 'S5-budget-floor',
    haltReason: 'plan reviewed but unverified — parse/releasability gates did not run',
    nextStep: `Raise the token budget (draft preserved at ${planPath}), then re-invoke nadia-plan`,
  })
}

// The sibling's parse prompt VERBATIM except the path slot and the version
// parenthetical; the trailing missing-file/knowledge-work sentence stays — a
// zero-unit return is a gate failure here.
const parsePlanPrompt = () => `Read the plan document at "${planPath}" (version: post-review) in this repository. It follows the ce-plan format:
level-3 headed Implementation Units ("### U1. Name") with bold fields Goal,
Requirements, Dependencies, Files, Approach, Execution note (optional), Patterns
to follow, Test scenarios, Verification; plus plan-level Requirements (R-IDs),
"Deferred to Implementation" questions, and "Scope Boundaries".
Extract everything into the structured output, faithfully and completely — quote
field text rather than paraphrasing. Derive "slug" as a short kebab-case branch
slug from the title. For riskSurfaces, report which of
auth/payments/migrations/crypto/public-api/deps the plan touches based on its
units' files and goals. If the file is missing or carries
"execution: knowledge-work" frontmatter, return zero units and explain in
planTitle.`

const KNOWN_RISK_SURFACES = ['auth', 'payments', 'migrations', 'crypto', 'public-api', 'deps']
// riskSurfaces well-formedness is NOT a gate: the value is PARSER-derived, a
// document fix round cannot control it — filter unknown entries fail-open.
const filterRiskSurfaces = (parsedDoc) => {
  const unknown = parsedDoc.riskSurfaces.filter((s) => !KNOWN_RISK_SURFACES.includes(s))
  if (unknown.length) {
    log(`Parser returned unknown riskSurfaces entries filtered out (fail-open): ${unknown.join(', ')}`)
    parsedDoc.riskSurfaces = parsedDoc.riskSurfaces.filter((s) => KNOWN_RISK_SURFACES.includes(s))
  }
  return parsedDoc
}

const parseViolations = (parsedDoc) => {
  const out = []
  if (!parsedDoc.units.length) out.push('zero units extracted from the plan document')
  const uids = new Set(parsedDoc.units.map((u) => u.uid))
  for (const u of parsedDoc.units) {
    for (const d of (u.dependsOn || [])) if (!uids.has(d)) out.push(`${u.uid} dependsOn ${d}, which does not exist`)
  }
  // Kahn with the sibling's guard-100 loop (over resolvable edges only —
  // unresolvable edges are already reported above).
  const placed = new Set()
  let remaining = parsedDoc.units.slice()
  let guard = 0
  while (remaining.length && guard < 100) {
    const ready = remaining.filter((u) => (u.dependsOn || []).filter((d) => uids.has(d)).every((d) => placed.has(d)))
    if (!ready.length) {
      out.push(`dependency cycle among units: ${remaining.map((u) => u.uid).join(', ')}`)
      break
    }
    for (const u of ready) placed.add(u.uid)
    remaining = remaining.filter((u) => !placed.has(u.uid))
    guard++
  }
  if (remaining.length && guard >= 100) out.push(`dependency leveling exceeded ${guard} levels with ${remaining.length} unit(s) unplaced`)
  const reqIds = new Set(parsedDoc.requirements.map((rq) => rq.id))
  for (const u of parsedDoc.units) {
    for (const rid of (u.requirements || [])) if (!reqIds.has(rid)) out.push(`${u.uid} references requirement ${rid}, which is not defined`)
  }
  // M13 final assert over the parsed units.
  for (const o of fileOverlapViolations(parsedDoc.units.map((u) => ({ uid: u.uid, files: u.files, dependsOn: u.dependsOn || [] })))) {
    out.push(`file ${o.file} owned by ${o.a} and ${o.b} without a dependency path`)
  }
  return out
}

// Gate-originated edit authority (parse-fix and gate-fix prompts ONLY): gate
// violations never carry refutationSurvived, yet a dependsOn cycle can only
// be fixed by editing Dependencies — so these two prompts REPLACE the S4
// fixer's refutationSurvived requirement with violation-list authorization.
const GATE_AUTHORITY = `The listed gate violations ARE the authorization to edit Dependencies, Scope
Boundaries, or Requirements — exactly as far as needed to resolve them, no
further. NEVER renumber or reassign uids/R-IDs. NEVER widen scope.`

const parseFixPrompt = (violations) => `Plan document to edit: ${planPath} (edit ONLY this file).
The execution pipeline's parser found these structural violations:
${violations.map((v) => '- ' + v).join('\n')}
${GATE_AUTHORITY}
U-IDs and R-IDs may be ADDED (next free number, gaps fine) or deleted, NEVER
renumbered or reassigned. Report applied/documented/unapplied and
sectionsTouched.`

// ---- Gate 1: parse conformance (M11) ----
let parsed = await agent(parsePlanPrompt(), { label: 'parse-plan', phase: 'Gates', model: 'sonnet', schema: UNITS_SCHEMA })
if (!parsed) parsed = await agent(parsePlanPrompt(), { label: 'parse-plan-retry', phase: 'Gates', model: 'sonnet', schema: UNITS_SCHEMA })
if (!parsed) {
  return summary('halted', {
    haltStage: 'S5-parse-gate',
    haltReason: 'parse agent failed twice',
    nextStep: `Verify ${planPath} parses as a ce-plan document (draft preserved at ${planPath}), then re-invoke nadia-plan`,
  })
}
parsed = filterRiskSurfaces(parsed)
let violations = parseViolations(parsed)
if (violations.length) {
  log(`Parse gate violations: ${violations.join('; ')}`)
  await agent(parseFixPrompt(violations), { label: 'parse-fix', phase: 'Gates', schema: FIX_SCHEMA })
  const parseFixChecker = await runChecker('parse-fix', [], [], 'Gates')
  if (!parseFixChecker) return summary('halted', CHECKER_HALT('parse-fix'))
  const parseBatteryHalt = await postMutationChecks(parseFixChecker, { tag: 'parse-fix', phase: 'Gates', applied: [], rIdEditAuthorized: true })
  if (parseBatteryHalt) return summary('halted', parseBatteryHalt)
  parsed = await agent(parsePlanPrompt(), { label: 'parse-plan-retry', phase: 'Gates', model: 'sonnet', schema: UNITS_SCHEMA })
  if (parsed) parsed = filterRiskSurfaces(parsed)
  violations = parsed ? parseViolations(parsed) : ['re-parse after the fix round returned null']
  if (violations.length) {
    log(`Parse gate still failing after the fix round: ${violations.join('; ')}`)
    return summary('halted', {
      haltStage: 'S5-parse-gate',
      haltReason: `parse conformance violations after one fix round: ${violations.join('; ')}`,
      nextStep: `Fix the listed parse violations in ${planPath} (draft preserved at ${planPath}), then re-invoke nadia-plan`,
    })
  }
}
unitCount = parsed.units.length
requirementCount = parsed.requirements.length
slug = parsed.slug

// ---- Gate 2: releasability checklist (M12, the host gate) ----
// The editor's READY is surfaced as a log line, not an eighth checklist item:
// no agent re-evaluates the verdict against post-gate-fix bytes.
log(`editor-ready-before-gates: READY in round ${roundsUsed} — post-READY gate-fix mutations are covered by parse-plan-final + check-gate-fix, not by the verdict`)

const RELEASE_IDS = ['scope-boundaries-substantive', 'verification-observable', 'no-design-unknown-deferred', 'no-oversized-unit', 'unit-count-within-tier', 'scenarios-final-non-tautological', 'ktd-rationale-present']
const releasabilityPrompt = () => `Plan document: ${planPath} — read it fully.

${CONFIRMED_INTENT}

Depth tier: ${DEPTH} — tier unit budgets: lightweight 2–4 / standard 3–6 / deep 4–8.

Evaluate EVERY one of these seven releasability items, returning pass/fail
with one line of evidence each (return all seven ids):
- scope-boundaries-substantive: Scope Boundaries names real exclusions of specific functionality, not boilerplate.
- verification-observable: every requirement and per-unit Verification states an observable outcome, numeric where applicable — outcome-level, no command recipes.
- no-design-unknown-deferred: no architecture choice or unvalidated technical assumption sits in Deferred to Implementation — only execution detail belongs there.
- no-oversized-unit: a unit is oversized when its Files list exceeds ~8 files, its Goal needs an 'and' joining independent outcomes, it spans 2+ independent subsystems, or its Test scenarios mix unrelated concerns.
- unit-count-within-tier: the unit count fits the depth tier's budget.
- scenarios-final-non-tautological: Test scenarios derive from requirements and match the FINAL post-review interfaces — they never just restate the Approach.
- ktd-rationale-present: every Key Technical Decision carries a rationale with trade-offs.`

// Completeness rule (M-X1): gates count against the EXPECTED set — a missing
// item is synthesized as a failure, so a partial return can never vacuously pass.
const normalizeRelease = (res) => RELEASE_IDS.map((id) => {
  const item = res && res.items.find((it) => it.id === id)
  return item || { id, pass: false, evidence: 'not reported' }
})
const release = await agent(releasabilityPrompt(), { label: 'releasability', phase: 'Gates', schema: RELEASE_SCHEMA })
if (!release) log('Releasability agent failed — routed to the shared gate-fix round')
const releaseItems = normalizeRelease(release)
const releaseFailures = releaseItems.filter((it) => !it.pass)

// ---- Gate 3: origin coverage (M14, conditional) ----
const originCoveragePrompt = () => `Origin document: ${ORIGIN} (version: ${ORIGIN_VERSION}).
Walk the origin document section by section; confirm each
requirement/decision/boundary is addressed or explicitly deferred in the plan
at ${planPath}; do NOT take the plan's word — check the plan text. Your
sections[] walk is the evidence of work: return one entry per origin section.
You have not seen the plan author's claims and must not assume coverage.`
let originOmissions = []
if (!ORIGIN) {
  log('Origin coverage skipped: no origin doc')
} else {
  const cov = await agent(originCoveragePrompt(), { label: 'origin-coverage', phase: 'Gates', model: 'sonnet', schema: ORIGIN_COVERAGE_SCHEMA })
  // Vacuous-return rule (M-X1): a zero-section walk is a verifier failure —
  // omissions: [] alone is not evidence of coverage.
  if (!cov || !cov.sections.length) {
    openQuestions.push('origin coverage unverified (verifier failed)')
    log('Origin coverage verifier failed or returned a vacuous walk — coverage unverified')
  } else {
    originOmissions = cov.omissions
  }
}

// ---- Gate 4: cross-plan overlap (M15, pure JS) ----
const overlapEntries = []
if (activePlans.length) {
  const newPlanFiles = new Set(parsed.units.flatMap((u) => u.files))
  for (const p of activePlans) {
    const sharedRisk = p.riskSurfaces.filter((s) => parsed.riskSurfaces.includes(s))
    if (sharedRisk.length) log(`Cross-plan advisory: shares risk surface(s) ${sharedRisk.join(', ')} with active plan ${p.path}`)
    const sharedFiles = p.files.filter((f) => newPlanFiles.has(f))
    if (sharedFiles.length) {
      const entry = `overlaps active plan ${p.path} on: ${sharedFiles.join(', ')}`
      openQuestions.push(entry)
      overlapEntries.push({ title: entry, section: 'Open Questions', routedTo: 'Open Questions', whyItMatters: `active plan "${p.title}" also touches these files`, evidence: sharedFiles.join(', '), confidence: 100 })
      log(`Cross-plan overlap: ${entry}`)
    }
  }
}

// ---- Shared gate-fix round (boolean, ONCE) across releasability/origin/overlap ----
if (releaseFailures.length || originOmissions.length || overlapEntries.length) {
  const gateFixPrompt = () => `Plan document to edit: ${planPath} (edit ONLY this file).

${CONFIRMED_INTENT}

Releasability failures (fix each substantively):
${releaseFailures.map((it) => `- ${it.id}: ${it.evidence}`).join('\n') || '- none'}

Origin coverage omissions (address each in the plan, or explicitly defer it):
${originOmissions.map((o) => `- ${o.item} (from origin section "${o.fromSection}"): ${o.detail}`).join('\n') || '- none'}

Cross-plan overlaps (append each to ## Open Questions):
${overlapEntries.map((e) => `- ${e.title}`).join('\n') || '- none'}

${GATE_AUTHORITY}
U-IDs and R-IDs may be ADDED (next free number, gaps fine) or deleted, NEVER
renumbered or reassigned. Report applied/documented/unapplied and
sectionsTouched.`
  const gateFix = await agent(gateFixPrompt(), { label: 'gate-fix', phase: 'Gates', schema: FIX_SCHEMA })
  if (!gateFix && (releaseFailures.length || originOmissions.length)) {
    // Nothing was fixed — same halts as failed retries.
    if (releaseFailures.length) {
      return summary('halted', {
        haltStage: 'S5-releasability',
        haltReason: `gate-fix agent failed; releasability item(s) failing: ${releaseFailures.map((it) => it.id).join(', ')}`,
        nextStep: `Fix the failing releasability items in ${planPath} (draft preserved at ${planPath}), then re-invoke nadia-plan`,
      })
    }
    return summary('halted', {
      haltStage: 'S5-origin-coverage',
      haltReason: `gate-fix agent failed; origin omissions outstanding: ${originOmissions.map((o) => o.item).join('; ')}`,
      nextStep: `Address the listed origin omissions in ${planPath} (or defer them explicitly) (draft preserved at ${planPath}), then re-invoke nadia-plan`,
    })
  }
  if (!gateFix) log('Gate-fix agent failed on an overlap-only batch — overlaps remain in openQuestions only')
  if (gateFix) {
    const gateFixChecker = await runChecker('gate-fix', [], [], 'Gates')
    if (!gateFixChecker) return summary('halted', CHECKER_HALT('gate-fix'))
    const gateBatteryHalt = await postMutationChecks(gateFixChecker, { tag: 'gate-fix', phase: 'Gates', applied: [], rIdEditAuthorized: true })
    if (gateBatteryHalt) return summary('halted', gateBatteryHalt)
    // Re-verify ONLY what failed.
    if (releaseFailures.length) {
      const releaseRetry = await agent(releasabilityPrompt(), { label: 'releasability-retry', phase: 'Gates', schema: RELEASE_SCHEMA })
      const stillFailing = normalizeRelease(releaseRetry).filter((it) => !it.pass)
      if (stillFailing.length) {
        return summary('halted', {
          haltStage: 'S5-releasability',
          haltReason: `releasability item(s) still failing after the gate-fix round: ${stillFailing.map((it) => `${it.id} (${it.evidence})`).join('; ')}`,
          nextStep: `Fix the failing releasability items in ${planPath} (draft preserved at ${planPath}), then re-invoke nadia-plan`,
        })
      }
    }
    if (originOmissions.length) {
      const covRetry = await agent(originCoveragePrompt(), { label: 'origin-coverage-retry', phase: 'Gates', model: 'sonnet', schema: ORIGIN_COVERAGE_SCHEMA })
      if (!covRetry || !covRetry.sections.length) {
        openQuestions.push('origin coverage unverified (verifier failed)')
        log('Origin coverage retry failed or returned a vacuous walk — coverage unverified')
      } else if (covRetry.omissions.length) {
        return summary('halted', {
          haltStage: 'S5-origin-coverage',
          haltReason: `origin omissions remain after the gate-fix round: ${covRetry.omissions.map((o) => o.item).join('; ')}`,
          nextStep: `Address the listed origin omissions in ${planPath} (or defer them explicitly) (draft preserved at ${planPath}), then re-invoke nadia-plan`,
        })
      }
    }
    // The document mutated after the parse — the consumer's parser must bless
    // the FINAL bytes (total parse dispatches <= 4 per run worst case, bounded).
    parsed = await agent(parsePlanPrompt(), { label: 'parse-plan-final', phase: 'Gates', model: 'sonnet', schema: UNITS_SCHEMA })
    if (parsed) parsed = filterRiskSurfaces(parsed)
    const finalViolations = parsed ? parseViolations(parsed) : ['final parse returned null after the gate-fix round']
    if (finalViolations.length) {
      return summary('halted', {
        haltStage: 'S5-parse-gate',
        haltReason: `final parse after the gate-fix round failed: ${finalViolations.join('; ')}`,
        nextStep: `Fix the listed parse violations in ${planPath} (draft preserved at ${planPath}), then re-invoke nadia-plan`,
      })
    }
    unitCount = parsed.units.length
    requirementCount = parsed.requirements.length
    slug = parsed.slug
  }
}

// ============================================================
// S6 — Finalize (M16/M17): optional commit first (so the hygiene gate can
// verify it), then the read-only hygiene tail gate, then the run summary.
// ============================================================
phase('Finalize')
if (belowBudgetFloor()) {
  log('Hygiene gate skipped: token budget floor reached')
  log('Commit skipped: token budget floor reached')
  return summary('ready', {
    nextStep: `Token budget exhausted before finalize — the workspace is UNVERIFIED: run git status by hand, commit the plan (git add ${planPath} && git commit -m "docs(plans): add ${slug} plan"), re-derive planVersion with git hash-object ${planPath}, then run nadia-deliver with { plan: '${planPath}', planVersion: '<that hash>' }`,
  })
}

let commitDirty = false
if (COMMIT) {
  const commitRes = await agent(
    `git add ${planPath} (by name, nothing else) && git commit -m "docs(plans): add ${slug} plan".
Report the sha and the git show --name-only file list of the commit you made.
If the working tree contains other changes, do NOT stage them.`,
    { label: 'commit-plan', phase: 'Finalize', model: 'sonnet', schema: COMMIT_SCHEMA },
  )
  if (!commitRes || !commitRes.committed) {
    log(`Commit ${commitRes ? `reported failure: ${commitRes.detail}` : 'agent failed'} — the plan file exists but is uncommitted`)
  } else {
    committed = true
    if (!(commitRes.filesInCommit.length === 1 && commitRes.filesInCommit[0] === planPath)) {
      log('WARNING: commit contains more than the plan file')
      commitDirty = true
    }
  }
} else {
  log('Commit skipped: args.commit !== true — the run summary nextStep carries the commit command')
}

const hygiene = await agent(
  `Run git status --porcelain at the repo root. Report every tracked-file
change. onlyPlanChanged = true iff nothing outside ${planPath} changed
(untracked files outside docs/plans/ count as violations; when a commit was
just made, a clean tree also counts as true). Compute planVersion with
git hash-object ${planPath}. Read-only — change nothing, stage nothing.`,
  { label: 'hygiene', phase: 'Finalize', model: 'sonnet', schema: HYGIENE_SCHEMA },
)
if (!hygiene) {
  hygieneClean = null
  planVersion = null
  log('Hygiene gate failed — workspace state and planVersion unverified')
} else {
  planVersion = hygiene.planVersion
  if (hygiene.onlyPlanChanged === false) {
    hygieneClean = false
    log(`WARNING: files outside the plan changed during the run: ${hygiene.changedFiles.join(', ')} — inspect before committing`)
  } else {
    hygieneClean = true
  }
}
if (commitDirty) hygieneClean = false

const nextStep = committed
  ? (planVersion
    ? `Run nadia-deliver with { plan: '${planPath}', planVersion: '${planVersion}' }`
    : `Run nadia-deliver with { plan: '${planPath}' } — re-derive planVersion with git hash-object ${planPath} first (hygiene gate failed)`)
  : planVersion
    ? `Commit the plan file (git add ${planPath} && git commit -m "docs(plans): add ${slug} plan"), then run nadia-deliver with { plan: '${planPath}', planVersion: '${planVersion}' } — ce-work requires the plan committed`
    : `Commit the plan file (git add ${planPath} && git commit -m "docs(plans): add ${slug} plan"), then run nadia-deliver with { plan: '${planPath}' } — re-derive planVersion with git hash-object after committing; ce-work requires the plan committed`

return summary('ready', { nextStep })
