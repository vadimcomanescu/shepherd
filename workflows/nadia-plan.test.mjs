import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'

// Build the coordinator from the actual workflow script: same injection contract
// as the dynamic-workflow runtime (body runs in an async function scope).
const dir = dirname(fileURLToPath(import.meta.url))
const scriptSrc = readFileSync(join(dir, 'nadia-plan.js'), 'utf8').replace(/^export const meta = /, 'const meta = ')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', scriptSrc)
const coordinator = ({ args, agent, parallel, pipeline, phase, log, budget, workflow }) => body(args, agent, parallel, pipeline, phase, log, budget, workflow)

// ---------- fake primitives matching the documented runtime contract ----------
function makeRuntime(dispatcher, { budgetTotal = null, costPerCall = 10000 } = {}) {
  const trace = { calls: [], logs: [], phases: [] }
  let spent = 0
  const agent = async (prompt, opts = {}) => {
    trace.calls.push({ label: opts.label || '(none)', prompt, agentType: opts.agentType, model: opts.model })
    spent += costPerCall
    try {
      return await dispatcher(prompt, opts, trace.calls.length)
    } catch (err) {
      if (err && err.__hardThrow) throw err
      return null // agent() returns null on subagent death, never rejects to the caller
    }
  }
  // parallel: barrier; thunk errors resolve to null, call itself never rejects
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  // pipeline: per-item chain; a stage that throws drops the item to null and skips later stages
  const pipeline = async (items, ...stages) =>
    Promise.all(items.map(async (item, i) => {
      let v = item
      for (const stage of stages) {
        try { v = await stage(v, item, i) } catch { return null }
      }
      return v
    }))
  const budget = {
    total: budgetTotal,
    spent: () => spent,
    remaining: () => (budgetTotal === null ? Infinity : Math.max(0, budgetTotal - spent)),
  }
  return {
    runtime: {
      agent, parallel, pipeline, budget,
      phase: (t) => trace.phases.push(t),
      log: (m) => trace.logs.push(m),
      workflow: async () => { throw new Error('workflow() not expected in these scenarios') },
    },
    trace,
  }
}

// ---------- fixtures (NOTE: keep all titles / fixes / whyItMatters colon-free
// unless intentional — the echo parsers split on ': ') ----------
const PLAN_PATH = 'docs/plans/2026-06-10-001-feat-test-plan.md'
const UID_PAIRS = [
  { uid: 'U1', name: 'one' }, { uid: 'U2', name: 'two' },
  { uid: 'U3', name: 'three' }, { uid: 'U4', name: 'four' },
]
const R_IDS = ['R1', 'R2']
const SECTIONS = ['Summary', 'Problem Frame', 'Requirements', 'Key Technical Decisions', 'Implementation Units', 'Scope Boundaries', 'Assumptions', 'Deferred to Implementation']
const UNIT_FILES = [
  { uid: 'U1', files: ['src/u1.js'], dependsOn: [] },
  { uid: 'U2', files: ['src/u2.js'], dependsOn: ['U1'] },
  { uid: 'U3', files: ['src/u3.js'], dependsOn: ['U2'] },
  { uid: 'U4', files: ['src/u4.js'], dependsOn: [] },
]
const RELEASE_IDS = ['scope-boundaries-substantive', 'verification-observable', 'no-design-unknown-deferred', 'no-oversized-unit', 'unit-count-within-tier', 'scenarios-final-non-tautological', 'ktd-rationale-present']

const INTAKE = (o = {}) => ({
  confirmedIntent: {
    outcome: 'widget exporter ships', user: 'data analysts', whyNow: 'quarterly reporting needs it',
    success: 'exports complete in under a minute', constraint: 'no new services', outOfScope: ['import side'],
  },
  blockingUnknowns: [],
  decidableUnknowns: [{ question: 'export format', hypothesis: 'CSV is enough', invalidatedWhen: 'users request XLSX' }],
  split: { isMultiple: false, primary: '', excluded: [] },
  depthTier: 'standard', planType: 'feat',
  research: { bestPractices: false, web: false, reason: 'local patterns sufficient' },
  nonCodeDeliverable: false,
  ...o,
})
const REPO = (o = {}) => ({
  repoRoot: '/repo', stackDigest: 'node esm scripts', conventionsDigest: 'follow AGENTS.md',
  testingDigest: 'plain node test files', relevantFiles: ['src/widget.js', 'src/export.js'], contextMdPath: '',
  ...o,
})
const AUTHOR = (o = {}) => ({
  planPath: PLAN_PATH, planTitle: 'feat: Widget exporter', slug: 'test-plan', date: '2026-06-10', nnn: '001',
  unitCount: 4, requirementCount: 2, uidNamePairs: UID_PAIRS, rIds: R_IDS, sectionsPresent: SECTIONS,
  detail: 'AUTHOR-REASONING-SENTINEL',
  ...o,
})
const CLASSIFY = (o = {}) => ({
  documentType: 'plan',
  personas: { productLens: false, designLens: false, securityLens: false, scopeGuardian: false, adversarial: false },
  reasons: [], ktds: [], loadBearingAssumptions: [],
  ...o,
})
const CHECKER = (o = {}) => ({
  fixesVerified: [], staleFindings: [], uidNamePairs: UID_PAIRS, rIds: R_IDS, unitFiles: UNIT_FILES,
  unitCount: 4, requirementCount: 2, sectionsPresent: SECTIONS,
  ...o,
})
const EDITOR_READY = (o = {}) => ({
  verdict: 'READY', failureModesConsidered: ['scope creep', 'missing tests'], findings: [], blockingCount: 0,
  designUnknowns: [], units: UID_PAIRS.map((p) => ({ uid: p.uid, approachValidated: true, uphill: [] })),
  evidence: { planPath: PLAN_PATH, unitCount: 4, requirementCount: 2, sectionsPresent: SECTIONS },
  ...o,
})
const EDITOR_REVISED = (o = {}) => ({ ...EDITOR_READY(), verdict: 'REVISED', ...o })
const PARSED = (o = {}) => ({
  planTitle: 'feat: Widget exporter', slug: 'test-plan', riskSurfaces: [],
  requirements: [{ id: 'R1', text: 'r1' }, { id: 'R2', text: 'r2' }],
  deferredQuestions: [], scopeBoundaries: ['no import side'],
  units: [
    { uid: 'U1', name: 'one', goal: 'g1', requirements: ['R1'], dependsOn: [], files: ['src/u1.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v' },
    { uid: 'U2', name: 'two', goal: 'g2', requirements: ['R2'], dependsOn: ['U1'], files: ['src/u2.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v' },
    { uid: 'U3', name: 'three', goal: 'g3', requirements: [], dependsOn: ['U2'], files: ['src/u3.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v' },
    { uid: 'U4', name: 'four', goal: 'g4', requirements: [], dependsOn: [], files: ['src/u4.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v' },
  ],
  ...o,
})
const RELEASE_ALL_PASS = () => ({ items: RELEASE_IDS.map((id) => ({ id, pass: true, evidence: 'ok' })) })
const FINDING = (o = {}) => ({
  section: 'Implementation Units', title: 'missing dep', severity: 'P1', findingType: 'error',
  confidence: 100, autofixClass: 'manual', evidence: 'U2 has no dependsOn entry', whyItMatters: 'wave order breaks',
  suggestedFix: 'add the dependency edge',
  ...o,
})

// Echo helpers — derive the fixer/checker fixture from the dispatched prompt so
// "applied = echo of titles" and "fixesVerified all landed" hold generically.
const appliedTitlesFrom = (prompt) => {
  const head = prompt.split(/Still-pending findings|No pending findings/)[0]
  return [...head.matchAll(/^- \[[^\]]*\] (.+): /gm)].map((m) => m[1])
}
const FIX_ECHO = (prompt) => {
  const fixBlock = prompt.split('Document-as-known-cost entries')[0]
  const applied = [...fixBlock.matchAll(/^- \[[^\]]*\] \([^)]*\) (.+)$/gm)].map((m) => m[1])
  const docBlock = (prompt.split('Document-as-known-cost entries')[1] || '').split('Before applying anything')[0]
  const documented = [...docBlock.matchAll(/^- \[route to: ([^\]]+)\] (.+): /gm)].map((m) => ({ title: m[2], routedTo: m[1] }))
  return { applied, documented, unapplied: [], sectionsTouched: [], detail: 'ok' }
}
const CHECK_ECHO = (prompt, o = {}) => CHECKER({
  fixesVerified: appliedTitlesFrom(prompt).map((t) => ({ title: t, landed: true, matchesIntent: true, note: '' })),
  ...o,
})

// default dispatcher: label-prefix routing; overrides win
function makeDispatcher(overrides = {}, opts = {}) {
  return async (prompt, o) => {
    const label = o.label || ''
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (label.startsWith(prefix)) return fn(prompt, o, label)
    }
    if (label === 'intake') return INTAKE(opts.intake)
    if (label === 'research-repo') return REPO(opts.repo)
    if (label === 'research-learnings') return { digest: '', sources: [] }
    if (label === 'research-best-practices') return { digest: 'bp digest', sources: ['https://example.com/bp'] }
    if (label === 'research-web') return { digest: 'web digest', sources: ['https://example.com/web'] }
    if (label === 'research-flow') return { digest: 'flows ok', edgeCases: [] }
    if (label === 'research-cross-plan') return { activePlans: opts.activePlans || [] }
    if (label === 'strategy-gate') return { verdict: 'proceed', adjustedFraming: '', scopeDelta: '', loggedAssumptions: [], haltReason: '' }
    if (label === 'author-plan') return AUTHOR(opts.author)
    if (label === 'classify-personas') return CLASSIFY(opts.classify)
    if (label.startsWith('review-')) return { findings: [] }
    if (label.startsWith('ktd-refute-')) return { verdict: 'sustained', reason: 'holds against the code' }
    if (label.startsWith('refute-')) return { refuted: false, reason: 'confirmed' } // covers refute-halt- too
    if (label.startsWith('fix-round-')) return FIX_ECHO(prompt)
    if (label === 'revise-spike' || label === 'parse-fix' || label === 'gate-fix') return { applied: [], documented: [], unapplied: [], sectionsTouched: [], detail: 'ok' }
    if (label.startsWith('refix-uid-')) return 'identities restored'
    if (label.startsWith('check-')) return CHECK_ECHO(prompt, opts.checker)
    if (label.startsWith('editor-r')) return EDITOR_READY(opts.editor)
    if (label.startsWith('spike-')) return { unknown: 'investigated', resolution: 'resolved', evidence: 'read the code', recommendation: 'use approach X' }
    if (label.startsWith('parse-plan')) return PARSED(opts.parsed)
    if (label.startsWith('releasability')) return RELEASE_ALL_PASS()
    if (label.startsWith('origin-coverage')) return { sections: [{ heading: 'Goals', status: 'addressed', evidence: 'plan covers Goals' }], omissions: [] }
    if (label === 'commit-plan') return { committed: true, sha: 'deadbee', filesInCommit: [PLAN_PATH], detail: '' }
    if (label === 'hygiene') return { onlyPlanChanged: true, changedFiles: [], planVersion: 'abc123', detail: '' }
    throw Object.assign(new Error(`UNHANDLED LABEL: ${label}`), { __hardThrow: true })
  }
}

const ARGS = { request: 'add a widget exporter' }
async function run(dispatcher, { args = ARGS, budgetTotal = null } = {}) {
  const { runtime, trace } = makeRuntime(dispatcher, { budgetTotal })
  try {
    const result = await coordinator({ args, ...runtime })
    return { result, trace, error: null }
  } catch (error) {
    return { result: null, trace, error }
  }
}
const labels = (trace) => trace.calls.map((c) => c.label)
const idx = (trace, label) => trace.calls.findIndex((c) => c.label === label)
const idxPrefix = (trace, prefix) => trace.calls.findIndex((c) => c.label.startsWith(prefix))
const count = (trace, prefix) => trace.calls.filter((c) => c.label.startsWith(prefix)).length

// ---------- scenarios ----------
const scenarios = []
const S = (name, fn) => scenarios.push({ name, fn })

S('S1 happy path / anti-churn THRESHOLD', async () => {
  const { result, trace, error } = await run(makeDispatcher())
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.equal(result.roundsUsed, 1)
  assert.equal(result.personaRoundsUsed, 1)
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-round-')), 'no fixer on a clean round')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('check-')), 'no checker without a mutation')
  const byLabel = Object.fromEntries(trace.calls.map((c) => [c.label, c]))
  assert.equal(byLabel['review-r1-coherence'].agentType, 'compound-engineering:ce-coherence-reviewer')
  assert.equal(byLabel['review-r1-feasibility'].agentType, 'compound-engineering:ce-feasibility-reviewer')
  assert.equal(byLabel['editor-r1'].agentType, 'plan-editor')
  assert.equal(byLabel['author-plan'].agentType, 'plan-author')
  assert.equal(byLabel['parse-plan'].model, 'sonnet')
  assert.equal(result.planPath, PLAN_PATH)
  assert.equal(result.planVersion, 'abc123')
  assert.equal(result.depthTier, 'standard')
  assert.equal(result.unitCount, 4)
  assert.equal(result.requirementCount, 2)
  assert.ok(result.nextStep.includes('git add') && result.nextStep.includes('nadia-deliver') && result.nextStep.includes('abc123'), 'nextStep carries commit hint + ce-work invocation + planVersion')
  assert.deepEqual([...new Set(trace.phases)], ['Intake', 'Research', 'Gate', 'Draft', 'Review', 'Gates', 'Finalize'])
  assert.ok(trace.logs.some((m) => /ce-framework-docs-researcher/.test(m)), 'unconditional registry-gap log present')
  return `${trace.calls.length} agent calls, ready in round 1 with zero churn`
})

S('S2 preflight throws', async () => {
  const a = await run(makeDispatcher(), { args: {} })
  assert.ok(a.error && /requires args\.request/.test(a.error.message), `got: ${a.error && a.error.message}`)
  assert.equal(a.trace.calls.length, 0, 'no agent dispatched on missing request')
  const b = await run(makeDispatcher(), { args: { request: 'x', depth: 'huge' } })
  assert.ok(b.error && /depth must be one of/.test(b.error.message))
  assert.equal(b.trace.calls.length, 0)
  const c = await run(makeDispatcher(), { args: { request: 'x', date: 'June 10' } })
  assert.ok(c.error && /YYYY-MM-DD/.test(c.error.message))
  assert.equal(c.trace.calls.length, 0)
  return 'all three preflight guards throw before any agent'
})

S('S3 blocking unknowns -> structured halt', async () => {
  const d = makeDispatcher({
    intake: () => INTAKE({ blockingUnknowns: [
      { question: 'which auth provider', whyBlocking: 'changes the architecture' },
      { question: 'is PII involved', whyBlocking: 'changes compliance scope' },
    ] }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.status, 'halted')
  assert.equal(result.haltStage, 'S0-blocking-unknowns')
  assert.equal(result.openQuestions.length, 2)
  assert.equal(result.planPath, null)
  assert.ok(!trace.calls.some((c) => c.label.startsWith('research-')), 'no research after the intake halt')
  return 'classified blockers halt cleanly, never throw'
})

S('S4 strategy gate', async () => {
  // (a) adjust: framing + logged assumption reach the author
  const adjust = makeDispatcher({
    'strategy-gate': () => ({ verdict: 'adjust', adjustedFraming: 'Reframe as an export pipeline extension', scopeDelta: 'capability partially exists', loggedAssumptions: [{ assumption: 'extending the pipeline is enough', invalidatedWhen: 'users need a new surface' }], haltReason: '' }),
  })
  const a = await run(adjust)
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const author = a.trace.calls.find((c) => c.label === 'author-plan')
  assert.ok(author.prompt.includes('<adjusted-framing>') && author.prompt.includes('Reframe as an export pipeline extension'))
  assert.ok(author.prompt.includes('extending the pipeline is enough'), 'logged assumption reaches the author assumptions slot')
  assert.ok(a.trace.logs.some((m) => /adjusted framing/.test(m)))
  // (b) halt
  const halt = makeDispatcher({
    'strategy-gate': () => ({ verdict: 'halt', adjustedFraming: '', scopeDelta: '', loggedAssumptions: [], haltReason: 'the capability already exists in src/export.js' }),
  })
  const b = await run(halt)
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S2-strategy-gate')
  assert.ok(!b.trace.calls.some((c) => c.label === 'author-plan'), 'no draft after a gate halt')
  // (c) gate dies -> fail-open
  const dead = makeDispatcher({ 'strategy-gate': () => { throw new Error('gate died') } })
  const c = await run(dead)
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.ok(c.trace.logs.some((m) => /Strategy gate agent failed/.test(m)))
  return 'adjust threads framing; halt stops pre-draft; dead gate fails open'
})

S('S5 weak plan CONVERGES within cap', async () => {
  const carried = FINDING({ title: 'tighten verification wording', severity: 'P2', autofixClass: 'safe_auto', suggestedFix: 'reword the Verification line', evidence: 'verification says works fine' })
  const d = makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'editor-r1': () => EDITOR_REVISED({ findings: [carried] }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.equal(result.roundsUsed, 2)
  const fix2 = trace.calls.find((c) => c.label === 'fix-round-2')
  assert.ok(fix2.prompt.includes('tighten verification wording'), 'carried editor finding reaches the round-2 fixer')
  assert.ok(fix2.prompt.includes('refutationSurvived: false) tighten verification wording'), 'safe_auto@100 applies WITHOUT refutation per Q9')
  const order = ['review-r1-coherence', 'refute-r1-f0', 'fix-round-1', 'check-r1', 'editor-r1', 'review-r2-coherence', 'fix-round-2', 'check-r2', 'editor-r2']
  const positions = order.map((l) => idx(trace, l))
  assert.ok(positions.every((p) => p >= 0), `all stage labels present: ${JSON.stringify(positions)}`)
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i - 1] < positions[i], `label order: ${order[i - 1]} < ${order[i]}`)
  // (b) the carried P2 is gated_auto instead -> documented, never auto-applied
  const gated = makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ findings: [{ ...carried, autofixClass: 'gated_auto' }] }),
  })
  const b = await run(gated)
  assert.ifError(b.error)
  assert.equal(b.result.status, 'ready')
  const bFix2 = b.trace.calls.find((c) => c.label === 'fix-round-2')
  const fixNowBlock = bFix2.prompt.split('Document-as-known-cost entries')[0]
  assert.ok(!fixNowBlock.includes('tighten verification wording'), 'gated_auto never reaches the fix-now list')
  assert.ok(fixNowBlock.includes('- none'), 'fix-now batch empty')
  assert.ok(bFix2.prompt.split('Document-as-known-cost entries')[1].includes('tighten verification wording'), 'routed to the documentation batch')
  assert.ok(b.result.residualFindings.some((r) => r.class === 'documented' && r.title === 'tighten verification wording'))
  return 'fix round converges in 2 rounds; gated_auto documents instead of auto-applying'
})

S('S6 cap exhausted -> structured halt, never silent', async () => {
  const blocker = FINDING({ title: 'unresolved blocker', severity: 'P0', suggestedFix: 'do the thing' })
  const mk = () => makeDispatcher({ 'editor-r': () => EDITOR_REVISED({ findings: [blocker], blockingCount: 1 }) })
  const a = await run(mk(), { args: { ...ARGS, editorRounds: 3 } })
  assert.ifError(a.error)
  assert.equal(a.result.status, 'halted')
  assert.equal(a.result.haltStage, 'S4-editor-cap')
  assert.ok(a.result.haltReason.includes('unresolved blocker'))
  assert.equal(a.result.roundsUsed, 3)
  assert.ok(a.trace.logs.some((m) => /without READY/.test(m)))
  assert.equal(a.result.planPath, PLAN_PATH, 'draft preserved')
  const clamp99 = await run(mk(), { args: { ...ARGS, editorRounds: 99 } })
  assert.equal(clamp99.result.roundsUsed, 5, 'editorRounds clamps to 5')
  const zero = await run(mk(), { args: { ...ARGS, editorRounds: 0 } })
  assert.equal(zero.result.roundsUsed, 3, '0 is falsy -> default 3 (decisions Q5 form)')
  const neg = await run(mk(), { args: { ...ARGS, editorRounds: -2 } })
  assert.equal(neg.result.roundsUsed, 1, 'lower clamp via negative value')
  return 'cap halt carries the unresolved title; 99->5, 0->3, -2->1'
})

S('S7 refuter kills a finding (+fail-closed null) and R29 suppresses re-raise', async () => {
  const f0 = FINDING({ title: 'phantom coupling', evidence: 'units share src/u9.js' })
  const f1 = FINDING({ title: 'missing rollback', section: 'Key Technical Decisions', evidence: 'no rollback story' })
  const d = makeDispatcher({
    'review-r1-coherence': () => ({ findings: [f0, f1] }),
    'review-r2-coherence': () => ({ findings: [f0] }),
    'refute-r1-f0': () => ({ refuted: true, reason: 'the file is not shared' }),
    'refute-r1-f1': () => { throw new Error('refuter died') },
    'editor-r1': () => EDITOR_REVISED(),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-round-')), 'both findings dead -> no fixer in any round')
  assert.ok(trace.logs.some((m) => /"phantom coupling" refuted/.test(m)))
  assert.ok(trace.logs.some((m) => /fail-closed/.test(m) && /missing rollback/.test(m)), 'dead refuter drops the finding fail-closed')
  assert.ok(trace.logs.some((m) => /R29 suppression: "phantom coupling"/.test(m)), 'settled finding suppressed in round 2')
  return 'refuted + null both drop; primer suppression keeps round 2 quiet'
})

S('S8 halt-class majority', async () => {
  const hc = (title) => FINDING({ title, autofixClass: 'manual', severity: 'P0', suggestedFix: '', whyItMatters: 'no fix exists' })
  // (a) 2-of-3 sustain -> halt
  const a = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [hc('design contradiction')] }),
    'refute-halt-': (p, o, label) => ({ refuted: label.endsWith('-v2'), reason: 'vote' }),
  }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'halted')
  assert.equal(a.result.haltStage, 'S4-halt-class-finding')
  assert.equal(count(a.trace, 'refute-halt-r1-f0-v'), 3, 'exactly three majority votes')
  assert.ok(a.result.openQuestions.some((q) => q.includes('design contradiction')))
  // (b) 2-of-3 refute -> dropped, run completes ready
  const b = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [hc('design contradiction')] }),
    'refute-halt-': (p, o, label) => ({ refuted: !label.endsWith('-v2'), reason: 'vote' }),
  }))
  assert.ifError(b.error)
  assert.equal(b.result.status, 'ready')
  assert.ok(b.trace.logs.some((m) => /refuted by majority/.test(m)))
  // (c) 4 halt-class findings -> only 3 majority procedures, 4th dropped-cap
  const c = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [hc('hc one'), hc('hc two'), hc('hc three'), hc('hc four')] }),
    'refute-halt-': () => ({ refuted: true, reason: 'vote' }),
  }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(count(c.trace, 'refute-halt-r1-f'), 9, '3 findings x 3 votes')
  assert.equal(count(c.trace, 'refute-halt-r1-f3'), 0, 'no majority for the 4th')
  assert.ok(c.trace.logs.some((m) => /Halt-class cap/.test(m)))
  assert.ok(c.result.residualFindings.some((r) => r.class === 'dropped-cap' && /halt-class majority cap 3/.test(r.reason)))
  return 'sustained majority halts; refuted majority drops; cap of 3 enforced'
})

S('S9 uid-stability violation ROUND-FAILING', async () => {
  const RENAMED = UID_PAIRS.map((p) => (p.uid === 'U2' ? { uid: 'U2', name: 'TWO-renamed' } : p))
  const weak = {
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'check-r1': () => CHECKER({ fixesVerified: [{ title: 'missing dep', landed: true, matchesIntent: true, note: '' }], uidNamePairs: RENAMED }),
  }
  // (a) refix restores the identity -> run proceeds to ready
  const a = await run(makeDispatcher({ ...weak }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const refix = a.trace.calls.find((c) => c.label === 'refix-uid-r1')
  assert.ok(refix && refix.prompt.includes('U2') && refix.prompt.includes('identity swap'), 'refix prompt names the swapped pair')
  assert.ok(idx(a.trace, 'check-refix-r1') > idx(a.trace, 'refix-uid-r1'))
  // (b) re-check still swapped -> halt
  const b = await run(makeDispatcher({
    ...weak,
    'check-refix-r1': () => CHECKER({ uidNamePairs: RENAMED }),
  }))
  assert.ifError(b.error)
  assert.equal(b.result.status, 'halted')
  assert.equal(b.result.haltStage, 'S4-uid-stability')
  assert.ok(b.result.haltReason.includes('U2'))
  // (c) cosmetic reformat (backticks, whitespace) is NOT an identity swap — no refix, run ready
  const COSMETIC = UID_PAIRS.map((p) => (p.uid === 'U2' ? { uid: 'U2', name: '`' + p.name + '`  ' } : p))
  const c = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'check-r1': () => CHECKER({ fixesVerified: [{ title: 'missing dep', landed: true, matchesIntent: true, note: '' }], uidNamePairs: COSMETIC }),
  }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(count(c.trace, 'refix-uid'), 0, 'cosmetic typesetting never dispatches a refix')
  return 'one re-fix allowed; persistent identity swap halts the round; cosmetic reformat passes'
})

S('S10 parse-conformance gate failure + bounded fix', async () => {
  const badDep = () => PARSED({ units: PARSED().units.map((u) => (u.uid === 'U3' ? { ...u, dependsOn: ['U9'] } : u)) })
  // (a) retry clean -> ready
  const a = await run(makeDispatcher({ 'parse-plan': (p, o, label) => (label === 'parse-plan' ? badDep() : PARSED()) }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const fix = a.trace.calls.find((c) => c.label === 'parse-fix')
  assert.ok(fix.prompt.includes('U3 dependsOn U9, which does not exist'))
  assert.ok(a.trace.calls.some((c) => c.label === 'check-parse-fix'), 'post-fix checker ran')
  assert.ok(a.trace.calls.some((c) => c.label === 'parse-plan-retry'), 're-parsed after the fix')
  assert.equal(count(a.trace, 'parse-fix'), 1, 'exactly one bounded parse-fix round on the success path')
  // (b) retry still broken -> halt
  const b = await run(makeDispatcher({ 'parse-plan': () => badDep() }))
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S5-parse-gate')
  assert.ok(b.result.haltReason.includes('U3 dependsOn U9'))
  assert.ok(b.trace.logs.some((m) => /Parse gate still failing/.test(m)))
  assert.equal(count(b.trace, 'parse-fix'), 1, 'exactly one bounded parse-fix round before the halt')
  assert.equal(count(b.trace, 'parse-plan-retry'), 1, 'exactly one re-parse after the single fix round')
  // (c) cycle caught by Kahn
  const cyc = () => PARSED({ units: PARSED().units.map((u) => (u.uid === 'U1' ? { ...u, dependsOn: ['U2'] } : u.uid === 'U2' ? { ...u, dependsOn: ['U1'] } : { ...u, dependsOn: [] })) })
  const c = await run(makeDispatcher({ 'parse-plan': (p, o, label) => (label === 'parse-plan' ? cyc() : PARSED()) }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.ok(c.trace.calls.find((x) => x.label === 'parse-fix').prompt.includes('dependency cycle'))
  // (d) zero units -> same fix path
  const z = await run(makeDispatcher({ 'parse-plan': (p, o, label) => (label === 'parse-plan' ? PARSED({ units: [] }) : PARSED()) }))
  assert.ifError(z.error)
  assert.equal(z.result.status, 'ready')
  assert.ok(z.trace.calls.find((x) => x.label === 'parse-fix').prompt.includes('zero units'))
  return 'one bounded fix round per violation family; persistent breakage halts'
})

S('S11 budget-floor degradation', async () => {
  // floor at the round-2 head (editor REVISED keeps the loop alive)
  const a = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED() }), { budgetTotal: 140000 })
  assert.ifError(a.error)
  assert.equal(a.result.status, 'halted')
  assert.equal(a.result.haltStage, 'S4-budget-floor')
  assert.ok(a.trace.logs.some((m) => /Budget floor reached before review round 2/.test(m)))
  assert.equal(a.result.planPath, PLAN_PATH, 'draft path survives the halt')
  // floor entering S5 (strong plan exits round 1, then trips)
  const b = await run(makeDispatcher(), { budgetTotal: 140000 })
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S5-budget-floor')
  // floor entering S6 -> ready but UNVERIFIED tail
  const c = await run(makeDispatcher(), { budgetTotal: 160000 })
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(c.result.planVersion, null)
  assert.equal(c.result.hygieneClean, null)
  assert.ok(c.trace.logs.some((m) => /Hygiene gate skipped: token budget floor/.test(m)))
  assert.ok(c.trace.logs.some((m) => /Commit skipped: token budget floor/.test(m)))
  assert.ok(/UNVERIFIED/.test(c.result.nextStep))
  return 'S4/S5 floor halts; S6 floor degrades to ready+unverified'
})

S('S12 no-silent-caps logs', async () => {
  // (a) 20 gating findings -> exactly 16 refuters, 4 dropped-cap residuals
  const twenty = Array.from({ length: 20 }, (_, i) => FINDING({ title: `finding-${String(i + 1).padStart(2, '0')}`, evidence: `evidence ${i + 1}` }))
  const a = await run(makeDispatcher({ 'review-r1-coherence': () => ({ findings: twenty }) }))
  assert.ifError(a.error)
  assert.equal(count(a.trace, 'refute-r1-f'), 16, 'refuter cap at 16')
  assert.ok(a.trace.logs.some((m) => /beyond 16/.test(m)))
  assert.equal(a.result.residualFindings.filter((r) => r.class === 'dropped-cap').length, 4)
  // (b) the unconditional registry log fires on every run
  assert.ok(a.trace.logs.some((m) => /ce-framework-docs-researcher/.test(m)))
  // (c) externalResearch:false suppresses both researchers with a log
  const c = await run(
    makeDispatcher({}, { intake: { research: { bestPractices: true, web: true, reason: 'new domain' } } }),
    { args: { ...ARGS, externalResearch: false } },
  )
  assert.ifError(c.error)
  assert.ok(!c.trace.calls.some((x) => x.label === 'research-best-practices' || x.label === 'research-web'))
  assert.ok(c.trace.logs.some((m) => /externalResearch === false/.test(m)))
  // (d) 5 design unknowns -> 3 spikes, overflow logged
  const unknowns = Array.from({ length: 5 }, (_, i) => ({ unknown: `unknown ${i + 1}`, affectedUids: ['U1'], whyDesignLevel: 'architecture-level' }))
  const e = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED({ designUnknowns: unknowns }) }))
  assert.ifError(e.error)
  assert.equal(count(e.trace, 'spike-'), 3, 'spike cap at 3')
  assert.ok(e.trace.logs.some((m) => /beyond 3/.test(m)))
  return 'every cap drop is logged: refuters 16, spikes 3, research opt-outs'
})

S('S13 prompt hygiene + no-claim-passing', async () => {
  const d = makeDispatcher({}, {
    intake: { research: { bestPractices: true, web: true, reason: 'new domain with thin local patterns' } },
    classify: { ktds: ['use sqlite as the queue store because it avoids a new service'], loadBearingAssumptions: ['a single writer suffices'] },
  })
  const args = { ...ARGS, origin: 'docs/brainstorm.md', originVersion: 'ov-7' }
  const { result, trace, error } = await run(d, { args })
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  for (const c of trace.calls) {
    assert.ok(!/undefined|\[object Object\]|<PLACEHOLDER>|\$\{/.test(c.prompt),
      `unresolved interpolation in ${c.label}:\n${(c.prompt.match(/.{0,40}(undefined|\[object Object\]|<PLACEHOLDER>|\$\{).{0,40}/) || [])[0]}`)
  }
  // M6: the author's free-text detail never threads into reviewer/editor/refuter prompts
  for (const c of trace.calls.filter((x) => /^(review-|editor-|refute-|ktd-refute-)/.test(x.label))) {
    assert.ok(!c.prompt.includes('AUTHOR-REASONING-SENTINEL'), `author reasoning leaked into ${c.label}`)
  }
  for (const c of trace.calls.filter((x) => x.label.startsWith('review-r1-'))) {
    assert.ok(c.prompt.includes('<confirmed-intent>') && c.prompt.includes(PLAN_PATH))
    assert.ok(c.prompt.includes('<decision-primer>none — first round</decision-primer>'))
  }
  const cov = trace.calls.find((c) => c.label === 'origin-coverage')
  assert.ok(cov.prompt.includes('docs/brainstorm.md') && cov.prompt.includes('ov-7'), 'origin path + version reach the coverage gate')
  assert.ok(trace.calls.some((c) => c.label === 'research-best-practices') && trace.calls.some((c) => c.label === 'research-web'))
  return `${trace.calls.length} prompts clean; no author-claim threading`
})

S('S14 commit:false vs commit:true vs hygiene violation', async () => {
  // (a) default: no commit agent, nextStep carries the commit hint
  const a = await run(makeDispatcher())
  assert.ifError(a.error)
  assert.ok(!a.trace.calls.some((c) => c.label === 'commit-plan'))
  assert.equal(a.result.committed, false)
  assert.ok(a.result.nextStep.includes('git add ' + PLAN_PATH))
  // (b) commit:true -> commit before hygiene, bare ce-work nextStep
  const b = await run(makeDispatcher(), { args: { ...ARGS, commit: true } })
  assert.ifError(b.error)
  assert.equal(b.result.committed, true)
  assert.ok(idx(b.trace, 'commit-plan') >= 0 && idx(b.trace, 'commit-plan') < idx(b.trace, 'hygiene'), 'commit dispatched before the hygiene gate')
  assert.equal(b.result.nextStep, `Run nadia-deliver with { plan: '${PLAN_PATH}', planVersion: 'abc123' }`)
  // (c) hygiene violation degrades, never blocks ready
  const c = await run(makeDispatcher({
    hygiene: () => ({ onlyPlanChanged: false, changedFiles: ['src/oops.js'], planVersion: 'abc123', detail: '' }),
  }), { args: { ...ARGS, commit: true } })
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(c.result.hygieneClean, false)
  assert.ok(c.trace.logs.some((m) => /WARNING: files outside the plan changed/.test(m)))
  // (d) commit agent dies -> uncommitted but still ready
  const e = await run(makeDispatcher({ 'commit-plan': () => { throw new Error('commit died') } }), { args: { ...ARGS, commit: true } })
  assert.ifError(e.error)
  assert.equal(e.result.status, 'ready')
  assert.equal(e.result.committed, false)
  assert.ok(e.trace.logs.some((m) => /Commit agent failed/.test(m)))
  return 'consent-style commit; hygiene violations warn; dead commit stays honest'
})

S('S15 spike branch', async () => {
  const U = (unknown, uids = ['U2']) => ({ unknown, affectedUids: uids, whyDesignLevel: 'changes the architecture' })
  // (a) two unknowns -> two read-only spikes, one revision, one checker, round-2 READY
  const a = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: [U('cache layer choice'), U('queue persistence', ['U3'])] }),
  }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  assert.equal(a.result.roundsUsed, 2)
  assert.equal(count(a.trace, 'spike-'), 2)
  const sp0 = a.trace.calls.find((c) => c.label === 'spike-0')
  assert.equal(sp0.model, 'sonnet')
  assert.ok(sp0.prompt.includes('cache layer choice') && sp0.prompt.includes('U2'))
  assert.ok(/READING code and docs only/.test(sp0.prompt) && /may NOT run tests/.test(sp0.prompt))
  assert.ok(idx(a.trace, 'revise-spike') > idx(a.trace, 'spike-1'))
  assert.ok(idx(a.trace, 'check-spike') > idx(a.trace, 'revise-spike'))
  // (b) runtime-blocked spike -> Open Questions in both doc and summary
  const b = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: [U('cache layer choice'), U('queue persistence', ['U3'])] }),
    'spike-1': () => ({ unknown: 'queue persistence', resolution: 'runtime-blocked', evidence: 'cannot determine statically', recommendation: 'measure at runtime' }),
  }))
  assert.ifError(b.error)
  assert.ok(b.result.openQuestions.includes('queue persistence'))
  assert.ok(b.trace.calls.find((c) => c.label === 'revise-spike').prompt.includes('[runtime-blocked] queue persistence'))
  // (c) spikes:false -> no spikes, unknowns documented
  const c = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: [U('cache layer choice')] }),
  }), { args: { ...ARGS, spikes: false } })
  assert.ifError(c.error)
  assert.equal(count(c.trace, 'spike-'), 0)
  assert.ok(c.result.openQuestions.includes('cache layer choice'))
  assert.ok(c.trace.logs.some((m) => /Spikes disabled/.test(m)))
  // (d) spikeDone -> second batch never dispatches; unknowns ride to the cap halt
  const e = await run(makeDispatcher({
    'editor-r': () => EDITOR_REVISED({ designUnknowns: [U('second unknown')] }),
  }))
  assert.ifError(e.error)
  assert.equal(count(e.trace, 'spike-'), 1, 'only the round-1 batch')
  assert.ok(e.trace.logs.some((m) => /already used this run/.test(m)))
  assert.equal(e.result.haltStage, 'S4-editor-cap')
  assert.ok(e.result.haltReason.includes('second unknown'))
  // (e) final-round unknowns: never spike a document nobody re-verdicts
  const f = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: [U('late unknown')] }),
  }), { args: { ...ARGS, editorRounds: 1 } })
  assert.ifError(f.error)
  assert.equal(count(f.trace, 'spike-'), 0)
  assert.ok(!f.trace.calls.some((c) => c.label === 'revise-spike'))
  assert.ok(f.trace.logs.some((m) => /spike branch skipped/.test(m)))
  assert.ok(f.result.openQuestions.includes('late unknown'))
  assert.ok(f.result.haltReason.includes('late unknown'))
  // (f) READY with a design unknown is treated as REVISED, spike branch fires
  const g = await run(makeDispatcher({
    'editor-r1': () => EDITOR_READY({ designUnknowns: [U('cache layer choice')] }),
  }))
  assert.ifError(g.error)
  assert.equal(g.result.status, 'ready')
  assert.equal(g.result.roundsUsed, 2)
  assert.equal(count(g.trace, 'spike-'), 1)
  assert.ok(g.trace.logs.some((m) => /READY treated as REVISED/.test(m)))
  return 'spikes bounded to one batch of 3, read-only, never on the final round'
})

S('S16 releasability failure -> shared gate-fix -> retry', async () => {
  const failScope = () => ({ items: RELEASE_IDS.map((id) => ({ id, pass: id !== 'scope-boundaries-substantive', evidence: id === 'scope-boundaries-substantive' ? 'boilerplate only' : 'ok' })) })
  // (a) retry passes -> ready
  const a = await run(makeDispatcher({ releasability: (p, o, label) => (label === 'releasability' ? failScope() : RELEASE_ALL_PASS()) }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const gf = a.trace.calls.find((c) => c.label === 'gate-fix')
  assert.ok(gf.prompt.includes('scope-boundaries-substantive') && gf.prompt.includes('boilerplate only'))
  assert.ok(gf.prompt.includes('ARE the authorization'), 'gate-authority text present')
  assert.ok(!gf.prompt.includes('refutationSurvived'), 'gate fix does not carry the S4 fixer authority rule')
  assert.ok(a.trace.calls.some((c) => c.label === 'check-gate-fix'))
  assert.ok(a.trace.calls.some((c) => c.label === 'releasability-retry'))
  assert.ok(a.trace.calls.some((c) => c.label === 'parse-plan-final'), 'final bytes re-blessed by the parser')
  assert.equal(count(a.trace, 'gate-fix'), 1, 'exactly one shared gate-fix round on the retry-passes path')
  // (b) retry still failing -> halt with the item id
  const b = await run(makeDispatcher({ releasability: () => failScope() }))
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S5-releasability')
  assert.ok(b.result.haltReason.includes('scope-boundaries-substantive'))
  assert.equal(count(b.trace, 'gate-fix'), 1, 'gate-fix never loops: one round then halt')
  // (c) partial return: missing enum id synthesized as a failure
  const sixOnly = () => ({ items: RELEASE_IDS.filter((id) => id !== 'ktd-rationale-present').map((id) => ({ id, pass: true, evidence: 'ok' })) })
  const c = await run(makeDispatcher({ releasability: (p, o, label) => (label === 'releasability' ? sixOnly() : RELEASE_ALL_PASS()) }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.ok(c.trace.calls.find((x) => x.label === 'gate-fix').prompt.includes('ktd-rationale-present: not reported'), 'no vacuous pass on a partial return')
  return 'gate-fix carries violation authority; partial returns synthesize failures'
})

S('S17 origin coverage conditional', async () => {
  const originArgs = { ...ARGS, origin: 'docs/brainstorm.md', originVersion: 'ov-3' }
  // (a) omission found -> gate-fix -> retry clean
  const a = await run(makeDispatcher({
    'origin-coverage': (p, o, label) => (label === 'origin-coverage'
      ? { sections: [{ heading: 'Goals', status: 'omitted', evidence: 'not found in plan' }], omissions: [{ item: 'export retries', fromSection: 'Goals', detail: 'origin requires retry handling' }] }
      : { sections: [{ heading: 'Goals', status: 'addressed', evidence: 'now covered' }], omissions: [] }),
  }), { args: originArgs })
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const cov = a.trace.calls.find((c) => c.label === 'origin-coverage')
  assert.ok(cov.prompt.includes('docs/brainstorm.md') && cov.prompt.includes('ov-3'))
  assert.ok(a.trace.calls.find((c) => c.label === 'gate-fix').prompt.includes('export retries'))
  assert.ok(a.trace.calls.some((c) => c.label === 'origin-coverage-retry'))
  // (b) no origin -> never dispatched
  const b = await run(makeDispatcher())
  assert.ifError(b.error)
  assert.ok(!b.trace.calls.some((c) => c.label.startsWith('origin-coverage')))
  assert.ok(b.trace.logs.some((m) => /no origin doc/.test(m)))
  // (c) verifier dies -> ready with an open question, fail-open
  const c = await run(makeDispatcher({ 'origin-coverage': () => { throw new Error('verifier died') } }), { args: originArgs })
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.ok(c.result.openQuestions.some((q) => /origin coverage unverified/.test(q)))
  // (d) vacuous walk treated exactly like a dead verifier
  const e = await run(makeDispatcher({ 'origin-coverage': () => ({ sections: [], omissions: [] }) }), { args: originArgs })
  assert.ifError(e.error)
  assert.equal(e.result.status, 'ready')
  assert.ok(e.result.openQuestions.some((q) => /origin coverage unverified/.test(q)))
  assert.ok(!e.trace.calls.some((c) => c.label === 'gate-fix'), 'a vacuous walk never passes NOR triggers the gate-fix')
  return 'conditional gate; vacuous walk = verifier failure, surfaced not silent'
})

S('S18 cross-plan overlap', async () => {
  // (a) shared file with an active plan -> open question + gate-fix routing
  const a = await run(makeDispatcher({}, {
    activePlans: [{ path: 'docs/plans/old.md', title: 'Old plan', files: ['src/u1.js'], riskSurfaces: [] }],
  }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  const entry = 'overlaps active plan docs/plans/old.md on: src/u1.js'
  assert.ok(a.result.openQuestions.includes(entry))
  const gf = a.trace.calls.find((c) => c.label === 'gate-fix')
  assert.ok(gf && gf.prompt.includes(entry), 'overlap routed to Open Questions via the gate fixer')
  // (b) empty scan -> self-skipped with a log, no gate-fix
  const b = await run(makeDispatcher())
  assert.ifError(b.error)
  assert.ok(b.trace.logs.some((m) => /no other active plans/.test(m)))
  assert.ok(!b.trace.calls.some((c) => c.label === 'gate-fix'))
  return 'file overlap surfaces durably; empty scan logged'
})

S('S19 determinism: identical inputs -> identical labels and prompts', async () => {
  const mk = () => makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'editor-r1': () => EDITOR_REVISED(),
  })
  const a = await run(mk()); const b = await run(mk())
  assert.ifError(a.error); assert.ifError(b.error)
  assert.deepEqual(labels(a.trace), labels(b.trace))
  assert.deepEqual(a.trace.calls.map((c) => c.prompt), b.trace.calls.map((c) => c.prompt), 'prompts byte-identical')
  return `${a.trace.calls.length} calls, byte-identical labels and prompts across runs`
})

S('S20 persona roster + rounds', async () => {
  // (a) security lens only
  const a = await run(makeDispatcher({}, { classify: { personas: { productLens: false, designLens: false, securityLens: true, scopeGuardian: false, adversarial: false }, reasons: ['security: handles tokens'] } }))
  assert.ifError(a.error)
  const r1 = labels(a.trace).filter((l) => l.startsWith('review-r1-'))
  assert.deepEqual(r1, ['review-r1-coherence', 'review-r1-feasibility', 'review-r1-security'])
  assert.equal(a.trace.calls.find((c) => c.label === 'review-r1-security').agentType, 'compound-engineering:ce-security-lens-reviewer')
  // (b) classifier dies -> duo only, surfaced
  const b = await run(makeDispatcher({ 'classify-personas': () => { throw new Error('classifier died') } }))
  assert.ifError(b.error)
  assert.deepEqual(labels(b.trace).filter((l) => l.startsWith('review-r1-')), ['review-r1-coherence', 'review-r1-feasibility'])
  assert.ok(b.trace.logs.some((m) => /Persona classifier failed/.test(m)))
  assert.ok(b.result.openQuestions.some((q) => /persona classification failed/.test(q)))
  // (c) reviewRounds:1 -> round 2 is editor-convergence only
  const c = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED() }), { args: { ...ARGS, reviewRounds: 1 } })
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(count(c.trace, 'review-r2-'), 0)
  assert.ok(c.trace.logs.some((m) => /editor-convergence round/.test(m)))
  // reviewRounds:99 clamps to 3 -> personas still active in round 3
  const mkSlow = () => makeDispatcher({ 'editor-r1': () => EDITOR_REVISED(), 'editor-r2': () => EDITOR_REVISED() })
  const e = await run(mkSlow(), { args: { ...ARGS, reviewRounds: 99 } })
  assert.ifError(e.error)
  assert.ok(count(e.trace, 'review-r3-') > 0, 'clamped to 3, round 3 still has personas')
  // reviewRounds:0 falls back to the default 2 -> round 3 disabled
  const f = await run(mkSlow(), { args: { ...ARGS, reviewRounds: 0 } })
  assert.ifError(f.error)
  assert.ok(count(f.trace, 'review-r2-') > 0)
  assert.equal(count(f.trace, 'review-r3-'), 0, '0 is falsy -> default 2')
  return 'roster held from one classification; rounds clamp 99->3, 0->2'
})

S('S21 evidence-mismatch READY rejected (self-reports never gate alone)', async () => {
  // (a) arbitration sides with the standing count -> READY rejected, round 2 runs
  const a = await run(makeDispatcher({
    'editor-r1': () => EDITOR_READY({ evidence: { planPath: PLAN_PATH, unitCount: 7, requirementCount: 2, sectionsPresent: SECTIONS } }),
  }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  assert.equal(a.result.roundsUsed, 2)
  assert.ok(a.trace.calls.some((c) => c.label === 'check-evidence-r1'), 'arbitration dispatched')
  assert.ok(a.trace.logs.some((m) => /evidence mismatch/.test(m)))
  // (b) arbitration sides with the editor (author miscount) -> READY accepted round 1
  const b = await run(makeDispatcher({
    'check-evidence-r1': () => CHECKER({ unitCount: 5 }),
    'editor-r1': () => EDITOR_READY({ evidence: { planPath: PLAN_PATH, unitCount: 5, requirementCount: 2, sectionsPresent: SECTIONS } }),
  }))
  assert.ifError(b.error)
  assert.equal(b.result.status, 'ready')
  assert.equal(b.result.roundsUsed, 1, 'no deadlock on an author miscount')
  // (c) blockingCount lie: recount rejects, finding carried to round 2
  const lie = FINDING({ title: 'hidden blocker' })
  const c = await run(makeDispatcher({
    'editor-r1': () => EDITOR_READY({ findings: [lie], blockingCount: 0 }),
  }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.equal(c.result.roundsUsed, 2)
  assert.ok(c.trace.logs.some((m) => /blocking mismatch/.test(m)))
  assert.ok(c.trace.calls.find((x) => x.label === 'fix-round-2').prompt.includes('hidden blocker'), 'the lied-about P1 is carried, not dropped')
  // (d) every round rejected with empty title lists -> dedicated haltReason
  const e = await run(makeDispatcher({
    'editor-r': () => EDITOR_READY({ evidence: { planPath: PLAN_PATH, unitCount: 7, requirementCount: 2, sectionsPresent: SECTIONS } }),
  }))
  assert.ifError(e.error)
  assert.equal(e.result.haltStage, 'S4-editor-cap')
  assert.match(e.result.haltReason, /repeatedly rejected on evidence mismatch/)
  return 'checker owns the counts; READY lies rejected without churn or deadlock'
})

S('S22 KTD refutation', async () => {
  const ktds2 = { ktds: ['use sqlite as the queue store', 'use polling over websockets'], loadBearingAssumptions: ['a single writer suffices'] }
  // (b1) refuted KTD, majority sustains -> halt
  const b1 = await run(makeDispatcher({
    'ktd-refute-p1-0': () => ({ verdict: 'refuted', reason: 'the code already uses postgres' }),
    'refute-halt-ktd-': (p, o, label) => ({ refuted: label.endsWith('-v2'), reason: 'vote' }),
  }, { classify: ktds2 }))
  assert.ifError(b1.error)
  assert.equal(b1.result.status, 'halted')
  assert.equal(b1.result.haltStage, 'S4-halt-class-finding')
  assert.ok(b1.result.haltReason.includes('KTD refuted:'))
  assert.equal(count(b1.trace, 'refute-halt-ktd-p1-0-v'), 3)
  assert.ok(b1.result.openQuestions.some((q) => q.startsWith('KTD refuted:')))
  // (b2) majority refutes the refuter -> dropped, ready; no single verdict is ground truth
  const b2 = await run(makeDispatcher({
    'ktd-refute-p1-0': () => ({ verdict: 'refuted', reason: 'the code already uses postgres' }),
    'refute-halt-ktd-': (p, o, label) => ({ refuted: !label.endsWith('-v2'), reason: 'vote' }),
  }, { classify: ktds2 }))
  assert.ifError(b2.error)
  assert.equal(b2.result.status, 'ready')
  assert.ok(b2.trace.logs.some((m) => /Refuted-KTD finding .* refuted by majority/.test(m)))
  // (a)+(c)+(d) prompt contract, unverifiable routing, dirty-KTD re-refutation, pass cap
  const cd = await run(makeDispatcher({
    'ktd-refute-': (p, o, label) => (label.endsWith('-2') ? { verdict: 'unverifiable', reason: 'no evidence either way' } : { verdict: 'sustained', reason: 'holds' }),
    'fix-round-': (p) => ({ ...FIX_ECHO(p), sectionsTouched: ['Key Technical Decisions'] }),
    'editor-r1': () => EDITOR_REVISED(),
    'editor-r2': () => EDITOR_REVISED(),
  }, { classify: ktds2 }))
  assert.ifError(cd.error)
  assert.equal(cd.result.status, 'ready')
  assert.equal(count(cd.trace, 'ktd-refute-p1-'), 3)
  const k0 = cd.trace.calls.find((c) => c.label === 'ktd-refute-p1-0')
  assert.equal(k0.agentType, 'skeptical-refuter')
  assert.equal(k0.model, 'sonnet')
  assert.ok(/return verdict 'unverifiable', NOT 'refuted'/.test(k0.prompt))
  assert.ok(k0.prompt.includes(PLAN_PATH) && /CURRENT/.test(k0.prompt))
  assert.ok(cd.result.openQuestions.some((q) => q.startsWith('unverifiable KTD: a single writer suffices')))
  assert.ok(cd.trace.calls.find((c) => c.label === 'fix-round-1').prompt.includes('unverifiable KTD: a single writer suffices'), 'routed to the doc batch')
  assert.equal(count(cd.trace, 'ktd-refute-p2-'), 3, 'KTD-section edit triggers ONE re-refutation pass')
  assert.ok(/CURRENT/.test(cd.trace.calls.find((c) => c.label === 'ktd-refute-p2-0').prompt))
  assert.equal(count(cd.trace, 'ktd-refute-p3'), 0, 'KTD_PASSES_CAP = 2')
  // (e) 10 ktds -> only 8 refuted, overflow surfaced
  const ten = { ktds: Array.from({ length: 10 }, (_, i) => `decision number ${i + 1}`), loadBearingAssumptions: [] }
  const e = await run(makeDispatcher({}, { classify: ten }))
  assert.ifError(e.error)
  assert.equal(count(e.trace, 'ktd-refute-p1-'), 8)
  assert.ok(e.trace.logs.some((m) => /beyond 8/.test(m)))
  assert.equal(e.result.openQuestions.filter((q) => /unrefuted claim \(KTD cap\)/.test(q)).length, 2)
  // (f) 4 refuted claims, majorities refute the first 3 -> 4th overflows and VOIDS READY
  const four = { ktds: ['ktd alpha', 'ktd beta', 'ktd gamma', 'ktd delta'], loadBearingAssumptions: [] }
  const f = await run(makeDispatcher({
    'ktd-refute-': () => ({ verdict: 'refuted', reason: 'contradicted by the code' }),
    'refute-halt-ktd-': () => ({ refuted: true, reason: 'vote' }),
  }, { classify: four }))
  assert.ifError(f.error)
  assert.equal(count(f.trace, 'refute-halt-ktd-p1-0-v') + count(f.trace, 'refute-halt-ktd-p1-1-v') + count(f.trace, 'refute-halt-ktd-p1-2-v'), 9)
  assert.equal(count(f.trace, 'refute-halt-ktd-p1-3'), 0, 'KTD_HALT_CAP = 3 majority procedures')
  assert.ok(f.result.openQuestions.some((q) => q.includes('KTD refuted: ktd delta')))
  assert.ok(f.result.residualFindings.some((r) => r.class === 'dropped-cap' && /KTD halt-majority allowance/.test(r.reason)))
  assert.ok(f.trace.logs.some((m) => /READY voided/.test(m)))
  assert.equal(f.result.haltStage, 'S4-editor-cap')
  assert.ok(f.result.haltReason.includes('KTD refuted: ktd delta'))
  return 'KTD refutation is majority-arbitrated in both directions, capped and surfaced'
})

S('S23 research degradation', async () => {
  // (a) repo researcher dies -> fallback grounding everywhere, run completes
  const a = await run(makeDispatcher({ 'research-repo': () => { throw new Error('repo research died') } }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  assert.ok(a.trace.logs.some((m) => /repo research failed/.test(m)))
  assert.ok(/repo research unavailable|read the repo yourself/.test(a.trace.calls.find((c) => c.label === 'author-plan').prompt))
  assert.ok(/repo research unavailable|read the repo yourself/.test(a.trace.calls.find((c) => c.label === 'review-r1-coherence').prompt))
  // (b) intake dies -> S0 halt, nothing else dispatched
  const b = await run(makeDispatcher({ intake: () => { throw new Error('intake died') } }))
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S0-intake')
  assert.equal(b.trace.calls.length, 1, 'zero further labels')
  // (c) cross-plan scan dies -> fail-open with an open question
  const c = await run(makeDispatcher({ 'research-cross-plan': () => { throw new Error('scan died') } }))
  assert.ifError(c.error)
  assert.equal(c.result.status, 'ready')
  assert.ok(c.result.openQuestions.some((q) => /cross-plan overlap unverified/.test(q)))
  return 'each researcher degrades independently; only intake death halts'
})

S('S24 fixer accounting + reconciliation routing', async () => {
  // Run 1: routing + fixer-return accounting (scope-widening, omitted title, fyi fold)
  const fA = FINDING({ title: 'tighten wording', severity: 'P2', autofixClass: 'safe_auto', suggestedFix: 'reword it', evidence: 'loose phrasing' })
  const fB = FINDING({ title: 'fix dependency', suggestedFix: 'add the edge', evidence: 'U3 floats free' })
  const fD = FINDING({ title: 'document risk', severity: 'P2', confidence: 75, suggestedFix: '', evidence: 'risk unstated', whyItMatters: 'a known cost worth recording' })
  const fE = FINDING({ title: 'advisory note', severity: 'P3', confidence: 50, suggestedFix: '', evidence: 'nothing breaks but still' })
  const a = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [fA, fB, fD, fE] }),
    'fix-round-1': () => ({
      applied: [],
      documented: [{ title: 'document risk', routedTo: 'Open Questions' }],
      unapplied: [{ title: 'tighten wording', reason: 'scope-widening: expands the public API' }],
      sectionsTouched: [], detail: '',
    }),
  }))
  assert.ifError(a.error)
  assert.equal(a.result.status, 'ready')
  assert.ok(a.trace.logs.some((m) => /Round 1: 2 fix-now, 1 document-as-known-cost/.test(m)))
  const fix1 = a.trace.calls.find((c) => c.label === 'fix-round-1')
  assert.ok(fix1.prompt.includes('refutationSurvived: true) fix dependency'), 'P1 carries refutation-survived authority')
  assert.ok(fix1.prompt.includes('refutationSurvived: false) tighten wording'), 'safe_auto@100 never claims refutation')
  assert.ok(fix1.prompt.includes('[route to: Open Questions] document risk'), 'doc entry carries its routing target')
  assert.ok(a.result.residualFindings.some((r) => r.class === 'scope-widening-routed' && r.title === 'tighten wording'))
  assert.ok(a.result.openQuestions.includes('tighten wording'))
  assert.ok(a.result.residualFindings.some((r) => r.class === 'documented' && r.title === 'document risk'))
  assert.ok(a.result.residualFindings.some((r) => r.class === 'fixer-failed' && r.title === 'fix dependency'), 'unaccounted title surfaces')
  assert.ok(a.result.residualFindings.some((r) => r.class === 'fyi' && r.title === 'advisory note'), 'anchor-50 advisory folded by summary()')
  // Run 2: checker accounting against the EXPECTED set (landed:false + absent entry)
  const g1 = FINDING({ title: 'fix import order', suggestedFix: 'reorder imports', evidence: 'imports tangled' })
  const g2 = FINDING({ title: 'guard null input', suggestedFix: 'add a guard', evidence: 'no null check' })
  const b = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [g1, g2] }),
    'check-r1': () => CHECKER({ fixesVerified: [{ title: 'fix import order', landed: false, matchesIntent: true, note: 'hunk missing' }] }),
    'editor-r1': () => EDITOR_REVISED(),
  }))
  assert.ifError(b.error)
  assert.equal(b.result.status, 'ready')
  const fix2 = b.trace.calls.find((c) => c.label === 'fix-round-2')
  assert.ok(fix2.prompt.includes('fix import order [fix did not land faithfully]'), 'landed:false re-opened')
  assert.ok(fix2.prompt.includes('guard null input [fix did not land faithfully]'), 'absent-from-checker treated as landed:false')
  return 'two authority classes only; every unaccounted finding becomes a residual'
})

S('S25 halt-taxonomy completeness', async () => {
  // (a) author dies -> S3-draft, nothing after
  const a = await run(makeDispatcher({ 'author-plan': () => { throw new Error('author died') } }))
  assert.ifError(a.error)
  assert.equal(a.result.haltStage, 'S3-draft')
  assert.ok(!a.trace.calls.some((c) => c.label === 'classify-personas' || c.label.startsWith('review-')))
  // (b) checker + retry both die after a mutation -> fail-closed halt
  const b = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'check-r1': () => { throw new Error('checker died') },
  }))
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S4-post-mutation-check')
  assert.match(b.result.haltReason, /failed twice/)
  assert.ok(b.trace.calls.some((c) => c.label === 'check-r1-retry'), 'the one bounded retry was attempted')
  // (c) non-code deliverable -> S0-intake halt
  const c = await run(makeDispatcher({ intake: () => INTAKE({ nonCodeDeliverable: true }) }))
  assert.ifError(c.error)
  assert.equal(c.result.haltStage, 'S0-intake')
  assert.match(c.result.haltReason, /non-code deliverable/)
  assert.ok(!c.trace.calls.some((x) => x.label.startsWith('research-')))
  // (d) origin omission survives the gate-fix -> S5-origin-coverage
  const e = await run(makeDispatcher({
    'origin-coverage': () => ({ sections: [{ heading: 'Goals', status: 'omitted', evidence: 'missing' }], omissions: [{ item: 'export retries', fromSection: 'Goals', detail: 'still missing' }] }),
  }), { args: { ...ARGS, origin: 'docs/brainstorm.md' } })
  assert.ifError(e.error)
  assert.equal(e.result.haltStage, 'S5-origin-coverage')
  assert.ok(e.result.haltReason.includes('export retries'))
  // (e) budget floor before round 1 -> S4-budget-floor with roundsUsed 0
  const f = await run(makeDispatcher(), { budgetTotal: 110000 })
  assert.ifError(f.error)
  assert.equal(f.result.haltStage, 'S4-budget-floor')
  assert.equal(f.result.roundsUsed, 0)
  assert.equal(f.result.planPath, PLAN_PATH, 'draft preserved')
  return 'S3-draft, S4-post-mutation-check, S0-intake, S5-origin-coverage, pre-round floor all exercised'
})

// ---------- runner ----------
let pass = 0, fail = 0
for (const { name, fn } of scenarios) {
  try {
    const note = await fn()
    console.log(`PASS  ${name}${note ? `\n      ${note}` : ''}`)
    pass++
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').slice(0, 6).join('\n      ')}`)
    fail++
  }
}
console.log(`\n${pass} passed, ${fail} failed of ${scenarios.length}`)
process.exit(fail ? 1 : 0)
