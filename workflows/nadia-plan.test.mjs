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
  assert.ok(result.nextStep.includes('git add') && result.nextStep.includes('ce-work-deterministic') && result.nextStep.includes('abc123'), 'nextStep carries commit hint + ce-work invocation + planVersion')
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
  return 'one re-fix allowed; persistent identity swap halts the round'
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
  // (b) retry still broken -> halt
  const b = await run(makeDispatcher({ 'parse-plan': () => badDep() }))
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S5-parse-gate')
  assert.ok(b.result.haltReason.includes('U3 dependsOn U9'))
  assert.ok(b.trace.logs.some((m) => /Parse gate still failing/.test(m)))
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

// __PART2__
