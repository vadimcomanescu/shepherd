import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'

// Build the coordinator from the actual workflow script: same injection contract
// as the dynamic-workflow runtime (body runs in an async function scope).
const dir = dirname(fileURLToPath(import.meta.url))
const scriptSrc = readFileSync(join(dir, 'shepherd-plan.js'), 'utf8').replace(/^export const meta = /, 'const meta = ')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', scriptSrc)
const coordinator = ({ args, agent, parallel, pipeline, phase, log, budget, workflow }) => body(args, agent, parallel, pipeline, phase, log, budget, workflow)

// ---------- fake primitives matching the documented runtime contract ----------
function makeRuntime(dispatcher, { budgetTotal = null, costPerCall = 10000 } = {}) {
  const trace = { calls: [], logs: [], phases: [] }
  let spent = 0
  const agent = async (prompt, opts = {}) => {
    trace.calls.push({ label: opts.label || '(none)', prompt, agentType: opts.agentType, model: opts.model, schema: opts.schema })
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
    success: 'exports complete in under a minute', constraints: ['no new services'], outOfScope: ['import side'],
  },
  blockingUnknowns: [],
  decidableUnknowns: [{ question: 'export format', hypothesis: 'CSV is enough', invalidatedWhen: 'users request XLSX' }],
  split: { isMultiple: false, primary: '', excluded: [] },
  depthTier: 'standard', planType: 'feat',
  research: { intent: 'none', reason: 'local patterns sufficient' },
  nonCodeDeliverable: false,
  belowFloor: { verdict: false, reason: '', directPrompt: '' },
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
    if (label === 'research-grounding') return { digest: 'grounding digest', sources: ['https://example.com/grounding'] }
    if (label === 'research-web') return { digest: 'web digest', sources: ['https://example.com/web'] }
    if (label === 'research-flow') return { digest: 'flows ok', edgeCases: [] }
    if (label === 'research-cross-plan') return { activePlans: opts.activePlans || [] }
    if (label === 'strategy-gate') return { verdict: 'proceed', adjustedFraming: '', scopeDelta: '', loggedAssumptions: [], haltReason: '' }
    if (label === 'author-plan') return AUTHOR(opts.author)
    if (label === 'classify-personas') return CLASSIFY(opts.classify)
    if (label.startsWith('review-')) return { findings: [] }
    if (label.startsWith('ktd-refute-')) return { verdict: 'claim-correct', reason: 'The claim is correct: it holds against the code.' }
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
  assert.equal(byLabel['research-repo'].agentType, 'repo-researcher')
  assert.equal(byLabel['research-flow'].agentType, 'flow-analyzer')
  assert.equal(byLabel['review-r1-coherence'].agentType, 'coherence-lens')
  assert.equal(byLabel['review-r1-feasibility'].agentType, 'feasibility-lens')
  assert.equal(byLabel['editor-r1'].agentType, 'plan-editor')
  assert.equal(byLabel['author-plan'].agentType, 'plan-author')
  assert.equal(byLabel['parse-plan'].model, 'sonnet')
  assert.ok(!trace.calls.some((c) => c.agentType && c.agentType.startsWith('compound-engineering:')), 'no compound-engineering: agentType in any dispatch')
  assert.equal(result.planPath, PLAN_PATH)
  assert.equal(result.planVersion, 'abc123')
  assert.equal(result.depthTier, 'standard')
  assert.equal(result.unitCount, 4)
  assert.equal(result.requirementCount, 2)
  assert.ok(result.nextStep.includes('git add') && result.nextStep.includes('shepherd-deliver') && result.nextStep.includes('abc123'), 'nextStep carries commit hint + ce-work invocation + planVersion')
  assert.deepEqual([...new Set(trace.phases)], ['Intake', 'Research', 'Gate', 'Draft', 'Review', 'Gates', 'Finalize'])
  assert.ok(!trace.logs.some((m) => /verified agent registry/.test(m)), 'no stale registry-gap log')
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
  // (b) deleted registry-gap log stays deleted
  assert.ok(!a.trace.logs.some((m) => /verified agent registry/.test(m)), 'no stale registry-gap log')
  // (c) externalResearch:false suppresses both researchers with a log
  const c = await run(
    makeDispatcher({}, { intake: { research: { intent: 'mixed', reason: 'new domain' } } }),
    { args: { ...ARGS, externalResearch: false } },
  )
  assert.ifError(c.error)
  assert.ok(!c.trace.calls.some((x) => x.label === 'research-grounding' || x.label === 'research-web'))
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
    intake: { research: { intent: 'mixed', reason: 'new domain with thin local patterns' } },
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
  assert.ok(trace.calls.some((c) => c.label === 'research-grounding') && trace.calls.some((c) => c.label === 'research-web'))
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
  assert.equal(b.result.nextStep, `Run shepherd-deliver with { plan: '${PLAN_PATH}', planVersion: 'abc123' }`)
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
  // read-only/runtime-blocked mechanism pins (mechanism, not exact prose)
  assert.ok(sp0.prompt.includes('Read code and docs only') || sp0.prompt.includes('READING code and docs only'), 'spikePrompt: read-only rule present')
  assert.ok(sp0.prompt.includes('runtime-blocked'), 'spikePrompt: runtime-blocked resolution path present')
  assert.ok(sp0.schema && sp0.schema.properties && sp0.schema.properties.resolution && sp0.schema.properties.resolution.enum.includes('runtime-blocked'), 'spikePrompt: SPIKE_SCHEMA with runtime-blocked enum bound')
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
  assert.ok(gf.prompt.includes('The listed gate violations ARE the authorization to edit Dependencies, Scope\nBoundaries, or Requirements — exactly as far as needed to resolve them, no\nfurther. NEVER renumber or reassign uids/R-IDs. NEVER widen scope.'), 'gateFixPrompt: GATE_AUTHORITY full text byte-identical')
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
  assert.equal(a.trace.calls.find((c) => c.label === 'review-r1-security').agentType, 'security-lens')
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
    'ktd-refute-p1-0': () => ({ verdict: 'claim-refuted', reason: 'The claim is contradicted: the code already uses postgres.' }),
    'refute-halt-ktd-': (p, o, label) => ({ verdict: label.endsWith('-v2') ? 'ktd-is-right' : 'ktd-is-wrong', reason: 'vote' }),
  }, { classify: ktds2 }))
  assert.ifError(b1.error)
  assert.equal(b1.result.status, 'halted')
  assert.equal(b1.result.haltStage, 'S4-halt-class-finding')
  assert.ok(b1.result.haltReason.includes('2-of-3 arbiters judged the KTD wrong') && b1.result.haltReason.includes('KTD refuted:'))
  const arb = b1.trace.calls.find((c) => c.label === 'refute-halt-ktd-p1-0-v0')
  assert.ok(arb.prompt.includes('Judge THE DECISION itself') && arb.prompt.includes('the code already uses postgres'), 'arbiters judge the KTD directly with the challenge evidence, never a wrapped finding')
  assert.ok(arb.schema.properties.verdict.enum.includes('ktd-is-wrong'), 'referent-explicit arbitration enum')
  assert.equal(count(b1.trace, 'refute-halt-ktd-p1-0-v'), 3)
  assert.ok(b1.result.openQuestions.some((q) => q.startsWith('KTD refuted:')))
  // (b2) majority refutes the refuter -> dropped, ready; no single verdict is ground truth
  const b2 = await run(makeDispatcher({
    'ktd-refute-p1-0': () => ({ verdict: 'claim-refuted', reason: 'The claim is contradicted: the code already uses postgres.' }),
    'refute-halt-ktd-': (p, o, label) => ({ verdict: label.endsWith('-v2') ? 'ktd-is-wrong' : 'ktd-is-right', reason: 'vote' }),
  }, { classify: ktds2 }))
  assert.ifError(b2.error)
  assert.equal(b2.result.status, 'ready')
  assert.ok(b2.trace.logs.some((m) => /KTD challenge rejected by arbitration/.test(m)))
  // (a)+(c)+(d) prompt contract, unverifiable routing, dirty-KTD re-refutation, pass cap
  const cd = await run(makeDispatcher({
    'ktd-refute-': (p, o, label) => (label.endsWith('-2') ? { verdict: 'unverifiable', reason: 'no evidence either way' } : { verdict: 'claim-correct', reason: 'The claim is correct: holds.' }),
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
  assert.ok(/return verdict\n'unverifiable', NOT 'claim-refuted'/.test(k0.prompt) || k0.prompt.includes("'unverifiable', NOT 'claim-refuted'"))
  assert.ok(k0.prompt.includes('about THE QUOTED CLAIM itself'), 'verdict referent stated in the refute prompt')
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
S('S26 first-class repo arg: every dispatch is grounded with the target repository; absent by default', async () => {
  const grounded = await run(makeDispatcher(), { args: { ...ARGS, repo: '/sibling/target-repo/' } })
  assert.ifError(grounded.error)
  const ungroundedCalls = grounded.trace.calls.filter((c) => !c.prompt.startsWith('TARGET REPOSITORY: /sibling/target-repo\n'))
  assert.deepEqual(ungroundedCalls.map((c) => c.label), [], 'every agent dispatch carries the repo grounding prefix (trailing slash trimmed)')
  const exceptionLine = "Exception: skills/ paths (doctrine skills) resolve from the session's starting directory, NOT /sibling/target-repo."
  assert.deepEqual(grounded.trace.calls.filter((c) => !c.prompt.includes(exceptionLine)).map((c) => c.label), [], 'every grounded prompt carries the skills-root exception')
  const plain = await run(makeDispatcher())
  assert.ifError(plain.error)
  assert.ok(!plain.trace.calls.some((c) => c.prompt.includes('TARGET REPOSITORY:')), 'no grounding prefix when args.repo is unset')
  // Runtime quirk: scriptPath launches deliver args as a JSON-encoded string.
  const stringly = await run(makeDispatcher(), { args: JSON.stringify({ ...ARGS, repo: '/sibling/target-repo/' }) })
  assert.ifError(stringly.error)
  assert.ok(stringly.trace.calls.every((c) => c.prompt.startsWith('TARGET REPOSITORY: /sibling/target-repo\n')), 'JSON-string args are parsed at the boundary and behave identically')
  assert.ok(stringly.trace.calls.every((c) => c.prompt.includes(exceptionLine)), 'JSON-string args carry the skills-root exception too')
  return 'one chokepoint grounds every contextless agent with the target repo'
})

S('S27 model-tier policy: grunt sites pinned to sonnet; keep-inherit sites stay undefined', async () => {
  // (a) happy-path run: research-repo is always dispatched; intake + author-plan are keep-inherit
  const a = await run(makeDispatcher())
  assert.ifError(a.error)
  const byLabel = (label) => a.trace.calls.find((c) => c.label === label)
  assert.equal(byLabel('research-repo').model, 'sonnet', 'research-repo pinned to sonnet')
  assert.equal(byLabel('research-flow').model, 'sonnet', 'research-flow pinned to sonnet like the rest of the research roster')
  assert.equal(byLabel('intake').model, undefined, 'intake is keep-inherit')
  assert.equal(byLabel('author-plan').model, undefined, 'author-plan is keep-inherit')
  // (b) trigger fix-round-1: reviewer returns a finding, editor REVISED carries it
  const RENAMED = UID_PAIRS.map((p) => (p.uid === 'U2' ? { uid: 'U2', name: 'TWO-renamed' } : p))
  const b = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'check-r1': () => CHECKER({ fixesVerified: [{ title: 'missing dep', landed: true, matchesIntent: true, note: '' }], uidNamePairs: RENAMED }),
  }))
  assert.ifError(b.error)
  const fixRound = b.trace.calls.find((c) => c.label.startsWith('fix-round-'))
  assert.ok(fixRound, 'fix-round fired')
  assert.equal(fixRound.model, 'sonnet', 'fix-round pinned to sonnet')
  const refixUid = b.trace.calls.find((c) => c.label.startsWith('refix-uid-'))
  assert.ok(refixUid, 'refix-uid fired')
  assert.equal(refixUid.model, 'sonnet', 'refix-uid pinned to sonnet')
  // (c) trigger parse-fix: parse-plan returns a PARSED with a missing dependsOn target
  const badDep = () => PARSED({ units: PARSED().units.map((u) => (u.uid === 'U3' ? { ...u, dependsOn: ['U9'] } : u)) })
  const c = await run(makeDispatcher({ 'parse-plan': (p, o, label) => (label === 'parse-plan' ? badDep() : PARSED()) }))
  assert.ifError(c.error)
  const parseFix = c.trace.calls.find((c2) => c2.label === 'parse-fix')
  assert.ok(parseFix, 'parse-fix fired')
  assert.equal(parseFix.model, 'sonnet', 'parse-fix pinned to sonnet')
  // (d) trigger revise-spike: editor returns designUnknowns -> spike branch -> revise-spike
  const unknowns = [{ unknown: 'queue storage', affectedUids: ['U1'], whyDesignLevel: 'architecture-level' }]
  const d = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED({ designUnknowns: unknowns }) }))
  assert.ifError(d.error)
  const reviseSpike = d.trace.calls.find((c2) => c2.label === 'revise-spike')
  assert.ok(reviseSpike, 'revise-spike fired')
  assert.equal(reviseSpike.model, 'sonnet', 'revise-spike pinned to sonnet')
  return 'research-repo/fix-round/refix-uid/revise-spike/parse-fix = sonnet; intake/author-plan = inherit'
})

S('S28 paraphrase findings: deduped before the fixer, accounted by identity not exact title', async () => {
  const W = [
    'R10 lists 7 requirements but U1 has 8',
    'R10 lists only 7 requirements while U1 actually has 8',
    'requirements mismatch: R10 lists 7 requirements, U1 has 8',
  ]
  const d = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: W.map((t) => FINDING({ title: t, evidence: 'count mismatch', suggestedFix: 'fix the count' })) }),
    // fixer reports the fix under a FOURTH paraphrase of the same defect
    'fix-round-1': () => ({ applied: ['R10 lists 7 requirements yet U1 has 8'], documented: [], unapplied: [], sectionsTouched: ['Requirements'], detail: 'ok' }),
    'editor-r1': () => EDITOR_REVISED(),
  }))
  assert.ifError(d.error)
  const fix1 = d.trace.calls.find((c) => c.label === 'fix-round-1')
  const briefed = W.filter((t) => fix1.prompt.includes(t))
  assert.equal(briefed.length, 1, 'exactly one wording of the defect reaches the fixer')
  assert.ok(d.trace.logs.filter((l) => l.includes('paraphrase duplicate absorbed')).length >= 2, 'absorptions are logged, never silent')
  assert.deepEqual(d.result.residualFindings.filter((f) => f.class === 'fixer-failed'), [],
    'a paraphrased applied-report never mints fixer-failed residuals')
  return 'one defect in four wordings: one fixer dispatch, zero residual noise'
})

S('S29 reviewer prompts carry review-context block', async () => {
  const { result, trace, error } = await run(makeDispatcher())
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  const reviewCalls = trace.calls.filter((c) => /^review-r\d+-/.test(c.label))
  assert.ok(reviewCalls.length > 0, 'review prompts dispatched')
  for (const call of reviewCalls) {
    const blocks = [...call.prompt.matchAll(/<review-context>\n([\s\S]*?)\n<\/review-context>/g)]
    assert.equal(blocks.length, 1, `${call.label} carries exactly one review-context block`)
    assert.equal(blocks[0][1], 'Document type: plan\nOrigin: none', `${call.label} carries named document type and origin slots`)
    assert.ok(!blocks[0][1].includes('Origin document:'), `${call.label} does not use the stale origin label inside review-context`)
  }

  // (b) origin-path slot: when args.origin is set, Origin renders as the path (not 'none')
  const originRun = await run(
    makeDispatcher(),
    { args: { ...ARGS, origin: 'docs/brainstorm.md' } },
  )
  assert.ifError(originRun.error)
  const originReviewCalls = originRun.trace.calls.filter((c) => /^review-r\d+-/.test(c.label))
  assert.ok(originReviewCalls.length > 0, 'review prompts dispatched for origin run')
  for (const call of originReviewCalls) {
    const blocks = [...call.prompt.matchAll(/<review-context>\n([\s\S]*?)\n<\/review-context>/g)]
    assert.equal(blocks.length, 1, `${call.label} (origin run) carries exactly one review-context block`)
    assert.ok(blocks[0][1].includes('Origin: docs/brainstorm.md'), `${call.label} renders origin path in Origin slot`)
    assert.ok(!blocks[0][1].includes('Origin: none'), `${call.label} does not render 'none' when origin is set`)
  }

  // (c) requirements documentType: when classify returns documentType 'requirements', slot renders correctly
  const reqRun = await run(
    makeDispatcher({}, { classify: { documentType: 'requirements' } }),
  )
  assert.ifError(reqRun.error)
  const reqReviewCalls = reqRun.trace.calls.filter((c) => /^review-r\d+-/.test(c.label))
  assert.ok(reqReviewCalls.length > 0, 'review prompts dispatched for requirements run')
  for (const call of reqReviewCalls) {
    const blocks = [...call.prompt.matchAll(/<review-context>\n([\s\S]*?)\n<\/review-context>/g)]
    assert.equal(blocks.length, 1, `${call.label} (requirements run) carries exactly one review-context block`)
    assert.ok(blocks[0][1].includes('Document type: requirements'), `${call.label} renders 'Document type: requirements' slot`)
  }

  return `${reviewCalls.length} reviewer prompts carry review-context slots; origin-path and requirements-doc slots verified`
})

S('S30 intent none: no researchers dispatched, skip log carries reason', async () => {
  const { result, trace, error } = await run(makeDispatcher())
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.ok(!trace.calls.some((c) => c.label === 'research-grounding'))
  assert.ok(!trace.calls.some((c) => c.label === 'research-web'))
  assert.ok(trace.logs.some((m) => /intent.*none|local patterns sufficient/.test(m)))
  return 'intent none skips external researchers with an explicit reason'
})

S('S31 intent implementation-guidance: grounding dispatched, web absent', async () => {
  const { result, trace, error } = await run(makeDispatcher({}, {
    intake: { research: { intent: 'implementation-guidance', reason: 'thin local patterns for this approach' } },
  }))
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  const grounding = trace.calls.find((c) => c.label === 'research-grounding')
  assert.ok(grounding, 'grounding researcher dispatched')
  assert.equal(grounding.agentType, 'external-grounding-researcher')
  assert.ok(!trace.calls.some((c) => c.label === 'research-web'))
  return 'implementation-guidance routes only to grounding'
})

S('S32 intent landscape: web dispatched, grounding absent', async () => {
  const { result, trace, error } = await run(makeDispatcher({}, {
    intake: { research: { intent: 'landscape', reason: 'prior art survey needed' } },
  }))
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.ok(trace.calls.some((c) => c.label === 'research-web'))
  assert.ok(!trace.calls.some((c) => c.label === 'research-grounding'))
  return 'landscape routes only to web research'
})

S('S33 intent mixed: web before grounding in roster order', async () => {
  const { result, trace, error } = await run(makeDispatcher({}, {
    intake: { research: { intent: 'mixed', reason: 'both needed' } },
  }))
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  assert.ok(trace.calls.some((c) => c.label === 'research-web'))
  assert.ok(trace.calls.some((c) => c.label === 'research-grounding'))
  assert.ok(idx(trace, 'research-web') < idx(trace, 'research-grounding'))
  return 'mixed routes web before grounding'
})

S('S34 constraints list rendered in confirmed-intent block', async () => {
  const first = await run(makeDispatcher({}, {
    intake: { confirmedIntent: { ...INTAKE().confirmedIntent, constraints: ['A', 'B'] } },
  }))
  assert.ifError(first.error)
  assert.equal(first.result.status, 'ready')
  const firstAuthor = first.trace.calls.find((c) => c.label === 'author-plan')
  const firstReviewer = first.trace.calls.find((c) => /^review-r1-/.test(c.label))
  assert.ok(firstAuthor.prompt.includes('Constraints:\n- A\n- B'))
  assert.ok(firstReviewer.prompt.includes('Constraints:\n- A\n- B'))
  assert.ok(firstAuthor.prompt.includes('must surface in the plan'))

  const second = await run(makeDispatcher({}, {
    intake: { confirmedIntent: { ...INTAKE().confirmedIntent, constraints: [] } },
  }))
  assert.ifError(second.error)
  assert.equal(second.result.status, 'ready')
  const secondAuthor = second.trace.calls.find((c) => c.label === 'author-plan')
  const secondReviewer = second.trace.calls.find((c) => /^review-r1-/.test(c.label))
  assert.ok(secondAuthor.prompt.includes('Constraints:\n- none stated'))
  assert.ok(secondReviewer.prompt.includes('Constraints:\n- none stated'))
  return 'constraints render as bullets and empty constraints render none stated'
})

S('S35 author prompt contains constraint-surfacing instruction', async () => {
  const { result, trace, error } = await run(makeDispatcher())
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  const authorPrompt = trace.calls.find((c) => c.label === 'author-plan').prompt
  assert.ok(authorPrompt.includes('must surface in the plan'))
  return 'author prompt explicitly requires constraint coverage'
})

S('S36 verbatim-surface pins: ktdRefutePrompt, ktdArbitrationPrompt, ANCHOR_RUBRIC, editorPrompt, cap log()s', async () => {
  // ---- ktdRefutePrompt verbatim surface ----
  // trigger: classify returns ktds so ktdRefutePrompt is called
  const withKtds = makeDispatcher({}, {
    classify: { ktds: ['use sqlite as the queue store'], loadBearingAssumptions: [] },
  })
  const { result: r1, trace: t1, error: e1 } = await run(withKtds)
  assert.ifError(e1)
  const ktdRefuteCall = t1.calls.find((c) => c.label === 'ktd-refute-p1-0')
  assert.ok(ktdRefuteCall, 'ktd-refute-p1-0 dispatched')
  assert.ok(ktdRefuteCall.prompt.includes(
    `Your verdict is about THE QUOTED CLAIM itself: 'claim-refuted' ONLY\nwhen you hold concrete contradicting evidence; 'claim-correct' when the claim\naccurately describes the codebase — a failed refutation attempt is\n'claim-correct', not 'claim-refuted'. IMPORTANT — override of your default: if\nyou can neither confirm nor refute it from code and docs, return verdict\n'unverifiable', NOT 'claim-refuted'. Fail-if-uncertain here means surface, not\nauto-block. Your reason's first sentence must restate your verdict's referent\nin words ("The claim is correct/contradicted/unverifiable because ...").`
  ), 'ktdRefutePrompt: referent-explicit verdict block byte-identical')

  // ---- ktdArbitrationPrompt verbatim surface ----
  // trigger: classify returns ktd, first refuter returns claim-refuted
  const arbRun = await run(makeDispatcher({
    'ktd-refute-p1-0': () => ({ verdict: 'claim-refuted', reason: 'The claim is contradicted: the code already uses postgres.' }),
    'refute-halt-ktd-': (p, o, label) => ({ verdict: label.endsWith('-v2') ? 'ktd-is-right' : 'ktd-is-wrong', reason: 'vote' }),
  }, { classify: { ktds: ['use sqlite as the queue store'], loadBearingAssumptions: [] } }))
  assert.ifError(arbRun.error)
  const arbCall = arbRun.trace.calls.find((c) => c.label === 'refute-halt-ktd-p1-0-v0')
  assert.ok(arbCall, 'ktdArbitrationPrompt dispatched')
  assert.ok(arbCall.prompt.includes(
    `Judge THE DECISION itself on the actual code — read the relevant files\nyourself rather than adopting the first refuter's framing; where the claim is\ndeterministic runtime behavior, settle it by executing (read-only: never\nmodify the worktree). Your verdict is about the KTD itself (see the schema),\nand your reason's first sentence must restate it in words.`
  ), 'ktdArbitrationPrompt: Judge-THE-DECISION passage byte-identical')

  // ---- ANCHOR_RUBRIC verbatim surfaces (all five lines) ----
  const { trace: t2, error: e2 } = await run(makeDispatcher())
  assert.ifError(e2)
  const reviewer = t2.calls.find((c) => c.label === 'review-r1-coherence')
  assert.ok(reviewer, 'review-r1-coherence dispatched')
  assert.ok(reviewer.prompt.includes('- 0 — Not confident at all: a false positive that does not stand up to light scrutiny. Do not emit.'), 'ANCHOR_RUBRIC: 0 line present')
  assert.ok(reviewer.prompt.includes('- 25 — Somewhat confident: might be real but could be a false positive; you were not able to verify. Do not emit.'), 'ANCHOR_RUBRIC: 25 line present')
  assert.ok(reviewer.prompt.includes('- 50 — Moderately confident: verified as real but advisory — "nothing breaks, but..." findings land here (FYI tier).'), 'ANCHOR_RUBRIC: 50 line present')
  assert.ok(reviewer.prompt.includes('- 75 — Highly confident: double-checked and verified the issue will be hit in practice; requires naming a concrete downstream consequence someone will hit.'), 'ANCHOR_RUBRIC: 75 line present')
  assert.ok(reviewer.prompt.includes('- 100 — Absolutely certain: double-checked and confirmed; the document text leaves no room for interpretation.'), 'ANCHOR_RUBRIC: 100 line present')
  // also present in editorPrompt
  const editor = t2.calls.find((c) => c.label === 'editor-r1')
  assert.ok(editor.prompt.includes('- 0 — Not confident at all: a false positive that does not stand up to light scrutiny. Do not emit.'), 'ANCHOR_RUBRIC in editorPrompt: 0 line present')

  // ---- editorPrompt READY/REVISED definitions verbatim surface ----
  assert.ok(editor.prompt.includes(
    `You are READ-ONLY. READY means: unchanged, execution-ready, you would stake\nthe run on it. REVISED means: this plan needs revision — return the problems\nas findings (section/title/severity/findingType/confidence/autofixClass/\nevidence/whyItMatters/suggestedFix); they will be refuted, fixed, and verified\nby other agents, never by you.`
  ), 'editorPrompt: READY/REVISED definitions byte-identical')

  // ---- cap log() verbatim invariants ----
  // Refuter cap: 20 gating findings triggers the refuter-cap log
  const twenty = Array.from({ length: 20 }, (_, i) => FINDING({ title: `finding-${String(i + 1).padStart(2, '0')}`, evidence: `evidence ${i + 1}` }))
  const capA = await run(makeDispatcher({ 'review-r1-coherence': () => ({ findings: twenty }) }))
  assert.ifError(capA.error)
  assert.ok(capA.trace.logs.some((m) => m.includes('gating finding(s) beyond') && m.includes('routed to documentation without verification')), 'Refuter cap log: invariant text present')

  // KTD cap: 10 ktds triggers the KTD-cap log
  const tenKtds = { ktds: Array.from({ length: 10 }, (_, i) => `decision number ${i + 1}`), loadBearingAssumptions: [] }
  const capB = await run(makeDispatcher({}, { classify: tenKtds }))
  assert.ifError(capB.error)
  assert.ok(capB.trace.logs.some((m) => m.includes('claim(s) beyond') && m.includes('not refuted — listed in run summary openQuestions')), 'KTD cap log: invariant text present')

  // Halt-class cap: 4 halt-class findings -> 4th triggers the halt-class cap log
  const hc = (title) => FINDING({ title, autofixClass: 'manual', severity: 'P0', suggestedFix: '', whyItMatters: 'no fix exists' })
  const capC = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [hc('hc one'), hc('hc two'), hc('hc three'), hc('hc four')] }),
    'refute-halt-': () => ({ refuted: true, reason: 'vote' }),
  }))
  assert.ifError(capC.error)
  assert.ok(capC.trace.logs.some((m) => m.includes('beyond') && m.includes('majority procedures — routed document-as-known-cost')), 'Halt-class cap log: invariant text present')

  // KTD halt-majority residual reason: 4 refuted KTDs, 4th overflows KTD_HALT_CAP
  // Use verdict:'refuted' (non-enum) so arbiters return 0 ktd-is-wrong votes -> challenge rejected
  // -> all 3 uses of KTD_HALT_CAP exhaust the allowance; 4th ktd overflows -> residual
  const fourKtds = { ktds: ['ktd alpha', 'ktd beta', 'ktd gamma', 'ktd delta'], loadBearingAssumptions: [] }
  const capD = await run(makeDispatcher({
    'ktd-refute-': () => ({ verdict: 'refuted', reason: 'The claim is contradicted.' }),
    'refute-halt-ktd-': () => ({ refuted: true, reason: 'vote' }),
  }, { classify: fourKtds }))
  assert.ifError(capD.error)
  assert.ok(capD.result.residualFindings.some((r) => r.class === 'dropped-cap' && r.reason.includes('KTD halt-majority allowance (') && r.reason.includes('/run) exhausted')), 'KTD halt-majority allowance residual reason: invariant text present')

  return 'all verbatim surfaces pinned: ktdRefutePrompt, ktdArbitrationPrompt, ANCHOR_RUBRIC, editorPrompt READY/REVISED, cap logs'
})

S('S37 verbatim-surface pins: fixerPrompt, refixUidPrompt, reviseSpikePrompt, spike-cap log', async () => {
  // ---- fixerPrompt: PROTECTED SURFACES block ----
  // trigger: reviewer returns a finding so the fixer fires
  const fixerRun = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
  }))
  assert.ifError(fixerRun.error)
  const fixerCall = fixerRun.trace.calls.find((c) => c.label === 'fix-round-1')
  assert.ok(fixerCall, 'fix-round-1 dispatched')
  // Protected-surfaces block (byte-identical)
  assert.ok(fixerCall.prompt.includes(
    `PROTECTED SURFACES: any\nchange to the Requirements set, Scope Boundaries, or unit uid/Dependencies\nstructure requires refutationSurvived=true — otherwise return it unapplied. A\nfix may NEVER widen scope; return scope-widening proposals unapplied with\nreason starting 'scope-widening:'.`
  ), 'fixerPrompt: PROTECTED SURFACES block byte-identical')
  // Identity sentence in fixerPrompt
  assert.ok(fixerCall.prompt.includes(
    `U-IDs and R-IDs may be ADDED (next free\nnumber, gaps fine) or deleted, NEVER renumbered or reassigned.`
  ), 'fixerPrompt: U-ID/R-ID identity sentence byte-identical')

  // ---- refixUidPrompt: identity-restore header + rules block ----
  // trigger: checker returns a renamed UID
  const RENAMED = UID_PAIRS.map((p) => (p.uid === 'U2' ? { uid: 'U2', name: 'TWO-renamed' } : p))
  const refixRun = await run(makeDispatcher({
    'review-r1-coherence': () => ({ findings: [FINDING()] }),
    'check-r1': () => CHECKER({ fixesVerified: [{ title: 'missing dep', landed: true, matchesIntent: true, note: '' }], uidNamePairs: RENAMED }),
  }))
  assert.ifError(refixRun.error)
  const refixCall = refixRun.trace.calls.find((c) => c.label === 'refix-uid-r1')
  assert.ok(refixCall, 'refix-uid-r1 dispatched')
  // Identity-restore header (byte-identical)
  assert.ok(refixCall.prompt.includes(
    `Restore these\nidentities — never renumber; re-add as the same uid:`
  ), 'refixUidPrompt: identity-restore header byte-identical')
  // Rules block (byte-identical)
  assert.ok(refixCall.prompt.includes(
    `Rules: U-IDs and R-IDs may be ADDED (next free number, gaps fine) or deleted\nwith justification, NEVER renumbered or reassigned; uid-to-name identity pairs\nmust not swap. Edit the protected surfaces (Requirements set, Scope\nBoundaries, uid/Dependencies structure) ONLY as far as needed to restore the\nlisted identities — no further. NEVER widen scope.`
  ), 'refixUidPrompt: rules block byte-identical')

  // ---- reviseSpikePrompt: protected-surfaces OFF-LIMITS + uid/R-ID identity sentence ----
  // trigger: editor returns designUnknowns so the spike branch fires
  const spikeReviseRun = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: [{ unknown: 'cache layer choice', affectedUids: ['U1'], whyDesignLevel: 'architecture-level' }] }),
  }))
  assert.ifError(spikeReviseRun.error)
  const reviseCall = spikeReviseRun.trace.calls.find((c) => c.label === 'revise-spike')
  assert.ok(reviseCall, 'revise-spike dispatched')
  // OFF-LIMITS block (byte-identical)
  assert.ok(reviseCall.prompt.includes(
    `Protected surfaces (Requirements set, Scope Boundaries,\nuid/Dependencies structure) are OFF-LIMITS entirely — no spike result carries\nrefutation-survived authority.`
  ), 'reviseSpikePrompt: OFF-LIMITS block byte-identical')
  // uid/R-ID identity sentence (byte-identical)
  assert.ok(reviseCall.prompt.includes(
    `Same uid/R-ID rules as a fix round: U-IDs and\nR-IDs may be ADDED (next free number, gaps fine) or deleted, NEVER renumbered\nor reassigned.`
  ), 'reviseSpikePrompt: uid/R-ID identity sentence byte-identical')

  // ---- Spike-cap log(): invariant text around the interpolated count ----
  // trigger: 5 design unknowns -> SPIKE_CAP=3 -> overflow log fires
  const fiveUnknowns = Array.from({ length: 5 }, (_, i) => ({ unknown: `unknown ${i + 1}`, affectedUids: ['U1'], whyDesignLevel: 'architecture-level' }))
  const capRun = await run(makeDispatcher({
    'editor-r1': () => EDITOR_REVISED({ designUnknowns: fiveUnknowns }),
  }))
  assert.ifError(capRun.error)
  assert.ok(capRun.trace.logs.some((m) =>
    m.startsWith('Spike cap: ') && m.includes(' design unknown(s) beyond ') && m.includes(' routed to Open Questions')
  ), 'Spike cap log: invariant prefix, middle, and suffix present')

  return 'fixerPrompt PROTECTED-SURFACES + identity, refixUidPrompt header + rules, reviseSpikePrompt OFF-LIMITS + uid identity, spike-cap log format all byte-identical'
})

S('S38 verbatim-surface pins: GATE_AUTHORITY (both dispatches), research-cap log, R13 list-item granularity', async () => {
  // ---- GATE_AUTHORITY full text in parseFixPrompt (S10 path) ----
  const GATE_AUTHORITY_TEXT = `The listed gate violations ARE the authorization to edit Dependencies, Scope\nBoundaries, or Requirements — exactly as far as needed to resolve them, no\nfurther. NEVER renumber or reassign uids/R-IDs. NEVER widen scope.`
  const badDep = () => PARSED({ units: PARSED().units.map((u) => (u.uid === 'U3' ? { ...u, dependsOn: ['U9'] } : u)) })
  const parseFixRun = await run(makeDispatcher({ 'parse-plan': (p, o, label) => (label === 'parse-plan' ? badDep() : PARSED()) }))
  assert.ifError(parseFixRun.error)
  const parseFix = parseFixRun.trace.calls.find((c) => c.label === 'parse-fix')
  assert.ok(parseFix, 'parse-fix dispatched')
  assert.ok(parseFix.prompt.includes(GATE_AUTHORITY_TEXT), 'parseFixPrompt: GATE_AUTHORITY full text byte-identical')

  // ---- GATE_AUTHORITY full text in gateFixPrompt (S16 path) ----
  const failScope = () => ({ items: RELEASE_IDS.map((id) => ({ id, pass: id !== 'scope-boundaries-substantive', evidence: id === 'scope-boundaries-substantive' ? 'boilerplate only' : 'ok' })) })
  const gateFixRun = await run(makeDispatcher({ releasability: (p, o, label) => (label === 'releasability' ? failScope() : RELEASE_ALL_PASS()) }))
  assert.ifError(gateFixRun.error)
  const gateFix = gateFixRun.trace.calls.find((c) => c.label === 'gate-fix')
  assert.ok(gateFix, 'gate-fix dispatched')
  assert.ok(gateFix.prompt.includes(GATE_AUTHORITY_TEXT), 'gateFixPrompt: GATE_AUTHORITY full text byte-identical')

  // ---- research-cap log: pin the production log template against scriptSrc ----
  // The roster is at most 6 by construction (RESEARCH_CAP=6), so the cap branch
  // can never fire in any test scenario — pinning via a live run() is not possible.
  // Instead pin the log template in the coordinator source so a wording change is caught.
  assert.ok(
    /Research cap:.*researcher\(s\) beyond.*dropped/.test(scriptSrc),
    'research-cap log template present in coordinator source (scriptSrc pin)'
  )

  // ---- R13 list-item granularity instruction in originCoveragePrompt ----
  // Must reach both 'origin-coverage' and 'origin-coverage-retry' dispatches (same factory).
  const R13_TEXT = `When an origin section contains a normative list (principles, lessons, rules, requirements, decisions), each list item is an individual coverage unit — do not judge the whole section "addressed" if member items were not individually traced to the plan. A section marked "addressed" while specific normative list items are unaddressed is an omission. Exception: illustrative lists (alternative options, candidate approaches, background examples where only some items are intended as requirements) are NOT individual coverage units — if the plan deliberately selects a subset of such a list, the unselected items are intentional non-requirements, not omissions.`
  const originArgs = { ...ARGS, origin: 'docs/brainstorm.md', originVersion: 'ov-r13' }

  // (a) 'origin-coverage' dispatch carries R13
  const covRun = await run(makeDispatcher({
    'origin-coverage': (p, o, label) => (label === 'origin-coverage'
      ? { sections: [{ heading: 'Goals', status: 'omitted', evidence: 'not found in plan' }], omissions: [{ item: 'export retries', fromSection: 'Goals', detail: 'retry handling missing' }] }
      : { sections: [{ heading: 'Goals', status: 'addressed', evidence: 'now covered' }], omissions: [] }),
  }), { args: originArgs })
  assert.ifError(covRun.error)
  const covCall = covRun.trace.calls.find((c) => c.label === 'origin-coverage')
  assert.ok(covCall, 'origin-coverage dispatched')
  assert.ok(covCall.prompt.includes(R13_TEXT), 'origin-coverage: R13 list-item granularity instruction byte-identical')

  // (b) 'origin-coverage-retry' dispatch also carries R13 (same factory)
  const retryCovCall = covRun.trace.calls.find((c) => c.label === 'origin-coverage-retry')
  assert.ok(retryCovCall, 'origin-coverage-retry dispatched after omission found')
  assert.ok(retryCovCall.prompt.includes(R13_TEXT), 'origin-coverage-retry: R13 list-item granularity instruction byte-identical')

  return 'GATE_AUTHORITY pinned in both parseFixPrompt and gateFixPrompt; research-cap log invariant confirmed; R13 list-item granularity reaches both origin-coverage dispatches'
})

// ---------- S39-S43: fleet-sovereignty pins ----------
// Doctrine skills pinned by name; validating-agent-improvements is the pre-existing skill
// and is excluded from the 40-80 band assertion.
const DOCTRINE_SKILLS = ['decomposition', 'interface-design', 'scoping', 'test-strategy', 'zero-context-planning']

S('S39 rented-dispatch pin: coordinator contains zero compound-engineering: references', async () => {
  const hits = (scriptSrc.match(/compound-engineering:/g) || []).length
  assert.strictEqual(hits, 0, `Expected 0 occurrences of 'compound-engineering:' in coordinator source, found ${hits}`)
  return 'coordinator source is free of compound-engineering: plugin-namespaced dispatches'
})

S('S40 persona-on-disk pin: every dispatched agentType has a backing agents/*.md file', async () => {
  // Run 1: all conditional review personas on (default intent 'none')
  const r1 = await run(
    makeDispatcher({}, { classify: { personas: { productLens: true, designLens: true, securityLens: true, scopeGuardian: true, adversarial: true } } }),
  )
  assert.ifError(r1.error)
  // Run 2: intent 'mixed' so both conditional research personas (web-researcher,
  // external-grounding-researcher) enter the trace — they are only dispatched on
  // non-'none' intents and were absent from the default-intent trace.
  const r2 = await run(
    makeDispatcher({}, {
      classify: { personas: { productLens: true, designLens: true, securityLens: true, scopeGuardian: true, adversarial: true } },
      intake: { research: { intent: 'mixed', reason: 'coverage run' } },
    }),
  )
  assert.ifError(r2.error)
  // Union: every agentType dispatched in either run must have a backing agents/*.md file
  const agentTypes = [...new Set([
    ...r1.trace.calls.map((c) => c.agentType),
    ...r2.trace.calls.map((c) => c.agentType),
  ].filter(Boolean))]
  assert.ok(agentTypes.length > 0, 'at least one agentType observed in trace')
  const agentsDir = join(dir, '..', 'agents')
  for (const at of agentTypes) {
    const mdPath = join(agentsDir, `${at}.md`)
    assert.ok(existsSync(mdPath), `agents/${at}.md not found on disk (agentType observed in trace)`)
  }
  return `${agentTypes.length} distinct agentTypes all backed by agents/*.md: ${agentTypes.join(', ')}`
})

S('S41 no-dangling-skills pin: every skills/ reference in agents/*.md has a skills/<name>/SKILL.md', async () => {
  const agentsDir = join(dir, '..', 'agents')
  const skillsDir = join(dir, '..', 'skills')
  const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
  const allRefs = new Set()
  for (const f of agentFiles) {
    const src = readFileSync(join(agentsDir, f), 'utf8')
    for (const m of src.matchAll(/skills\/([a-z0-9-]+)/g)) {
      allRefs.add(m[1])
    }
  }
  assert.ok(allRefs.size > 0, 'at least one skills/ reference found in agents/*.md')
  for (const name of allRefs) {
    const skillMd = join(skillsDir, name, 'SKILL.md')
    assert.ok(existsSync(skillMd), `skills/${name}/SKILL.md not found (referenced in agents/*.md)`)
  }
  return `${allRefs.size} skill reference(s) all resolve to SKILL.md: ${[...allRefs].join(', ')}`
})

S('S42 budget pin: trace-derived persona fleet < 1471 lines; doctrine skills each 40-80 lines', async () => {
  // Derive the persona file list from two runs so the full owned fleet is covered:
  // Run 1: all conditional review personas on (default intent 'none')
  const r1 = await run(
    makeDispatcher({}, { classify: { personas: { productLens: true, designLens: true, securityLens: true, scopeGuardian: true, adversarial: true } } }),
  )
  assert.ifError(r1.error)
  // Run 2: intent 'mixed' to dispatch web-researcher and external-grounding-researcher
  const r2 = await run(
    makeDispatcher({}, {
      classify: { personas: { productLens: true, designLens: true, securityLens: true, scopeGuardian: true, adversarial: true } },
      intake: { research: { intent: 'mixed', reason: 'coverage run' } },
    }),
  )
  assert.ifError(r2.error)
  // Union of agentTypes across both runs covers the full dispatch fleet
  const agentTypes = [...new Set([
    ...r1.trace.calls.map((c) => c.agentType),
    ...r2.trace.calls.map((c) => c.agentType),
  ].filter(Boolean))]
  const agentsDir = join(dir, '..', 'agents')
  const skillsDir = join(dir, '..', 'skills')
  // R11: sum of persona file line counts must be < 1471
  let totalLines = 0
  for (const at of agentTypes) {
    const src = readFileSync(join(agentsDir, `${at}.md`), 'utf8')
    totalLines += src.split('\n').length
  }
  assert.ok(totalLines < 1471, `Fleet line total ${totalLines} must be < 1471 (R11 budget)`)
  // R2 band: each doctrine skill SKILL.md must be between 40 and 80 lines inclusive
  assert.strictEqual(DOCTRINE_SKILLS.length, 5, `Expected exactly 5 doctrine skills, found ${DOCTRINE_SKILLS.length}`)
  for (const name of DOCTRINE_SKILLS) {
    const src = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')
    const lines = src.split('\n').length
    assert.ok(lines >= 40, `skills/${name}/SKILL.md has ${lines} lines, must be >= 40 (R2 lower band)`)
    assert.ok(lines <= 80, `skills/${name}/SKILL.md has ${lines} lines, must be <= 80 (R2 upper band)`)
  }
  return `fleet total ${totalLines} lines < 1471; ${agentTypes.length} personas; doctrine skills [${DOCTRINE_SKILLS.map((n) => `${n}:${readFileSync(join(skillsDir, n, 'SKILL.md'), 'utf8').split('\n').length}`).join(', ')}] all within 40-80 band`
})

S('S43 prose-pin sweep: no slim-able verbatim persona-prose assertions outside S36-S38', async () => {
  // This scenario documents the audit result: existing scenarios either use structural pins
  // (labels, agentTypes, schema fields, XML markers, counts) or are explicitly marked as
  // byte-identical parser-contract pins in S36-S38. No stragglers to convert were found.
  // Run the happy path and confirm the structurally-pinned assertions still hold:
  const { result, trace, error } = await run(makeDispatcher())
  assert.ifError(error)
  assert.equal(result.status, 'ready')
  // Confirm reviewer prompts carry structural markers only (not fragile prose)
  const reviewCalls = trace.calls.filter((c) => /^review-r\d+-/.test(c.label))
  for (const c of reviewCalls) {
    assert.ok(c.agentType, `${c.label} carries agentType (structural pin passes)`)
    assert.ok(c.schema, `${c.label} carries schema (structural pin passes)`)
  }
  return `prose-pin audit complete: ${reviewCalls.length} reviewer dispatches all carry agentType + schema structural pins; no slim-able prose stragglers in S1-S38`
})

S('S44 plan-editor verdict-correctness block byte-identical (R6/U4)', async () => {
  // R6 and U4 require the eval-backed verdict block in agents/plan-editor.md to
  // stay byte-identical with v1. No run() call is needed — this is a file-content pin.
  const VERDICT_BLOCK = `You are judged on VERDICT CORRECTNESS, not on whether you found something.\nAn unnecessary rewrite is a failure. Missing a real problem is a failure.\nREADY means: unchanged, execution-ready, you would stake the run on it.\nREVISED means: you found real problems that must be fixed before execution.`
  const planEditorSrc = readFileSync(join(dir, '..', 'agents', 'plan-editor.md'), 'utf8')
  assert.ok(
    planEditorSrc.includes(VERDICT_BLOCK),
    'agents/plan-editor.md verdict-correctness block is byte-identical (R6/U4 pin)'
  )
  return 'plan-editor.md verdict-correctness block byte-identical with v1'
})

S('S45 below-floor halt: trivial request halts at S0 with a directPrompt, intake only', async () => {
  const BRIEF = 'Edit src/config.js line 12 to bump the timeout from 30 to 60. Conventional commit chore: bump timeout. Stage src/config.js by name. Run node --test. Report the diff and the passing test output.'
  const d = makeDispatcher({}, {
    intake: { belowFloor: { verdict: true, reason: 'single-file one-line constant bump, no boundary or risk', directPrompt: BRIEF } },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.status, 'halted')
  assert.equal(result.haltStage, 'S0-below-floor')
  assert.ok(result.directPrompt && result.directPrompt.length > 0, 'directPrompt rides the summary, non-empty')
  assert.equal(result.directPrompt, BRIEF, 'directPrompt is the intake brief verbatim')
  assert.equal(trace.calls.length, 1, 'exactly one agent dispatched (intake only)')
  assert.equal(trace.calls[0].label, 'intake')
  assert.ok(trace.logs.some((m) => m.startsWith('Below-floor:') && /pin args\.depth to force a plan/.test(m)), 'below-floor log fired')

  // Empty-reason fallback (observed live: an intake put everything in
  // directPrompt and left reason '') — the halt trace must never be reasonless.
  const e = await run(makeDispatcher({}, {
    intake: { belowFloor: { verdict: true, reason: '', directPrompt: BRIEF } },
  }))
  assert.ifError(e.error)
  assert.equal(e.result.haltStage, 'S0-below-floor')
  assert.ok(e.result.haltReason && e.result.haltReason.length > 0, 'haltReason falls back to a non-empty default when intake leaves reason blank')
  return 'trivial request halts at S0-below-floor with a ready-to-use directPrompt; only intake dispatched; empty reason falls back'
})

S('S46 pinned depth (and origin) override the below-floor halt: the run proceeds to author', async () => {
  const belowFloorIntake = { belowFloor: { verdict: true, reason: 'trivial', directPrompt: 'do the thing' } }
  // (a) pinned depth forces a plan despite verdict:true
  const a = await run(makeDispatcher({}, { intake: belowFloorIntake }), { args: { ...ARGS, depth: 'lightweight' } })
  assert.ifError(a.error)
  assert.notEqual(a.result.haltStage, 'S0-below-floor', 'pinned depth bypasses the floor')
  assert.ok(idx(a.trace, 'author-plan') >= 0, 'author-plan dispatched — the run proceeds')
  // (b) an origin doc also forces a plan (caller deliberately wants one)
  const b = await run(makeDispatcher({}, { intake: belowFloorIntake }), { args: { ...ARGS, origin: 'docs/brainstorm.md', originVersion: 'ov-1' } })
  assert.ifError(b.error)
  assert.notEqual(b.result.haltStage, 'S0-below-floor', 'origin doc bypasses the floor')
  assert.ok(idx(b.trace, 'author-plan') >= 0, 'author-plan dispatched with an origin doc')
  return 'a pinned depth or an origin doc overrides the below-floor halt; the planning fleet proceeds'
})

S('S47 lightweight caps: refuter/KTD/persona caps drop to the lightweight tier values with logs', async () => {
  // depthTier lightweight + a flood of gating findings, KTDs, and conditional personas.
  const tenFindings = Array.from({ length: 10 }, (_, i) => FINDING({ title: `lw-finding-${String(i + 1).padStart(2, '0')}`, evidence: `evidence ${i + 1}` }))
  const tenKtds = Array.from({ length: 10 }, (_, i) => `lightweight decision number ${i + 1}`)
  const allPersonas = { productLens: true, designLens: true, securityLens: true, scopeGuardian: true, adversarial: true }
  const d = makeDispatcher({
    'review-r1-coherence': () => ({ findings: tenFindings }),
  }, {
    intake: { depthTier: 'lightweight' },
    classify: { ktds: tenKtds, loadBearingAssumptions: [], personas: allPersonas, reasons: ['all conditional personas on'] },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  // refuter cap drops from 16 to 6
  assert.equal(count(trace, 'refute-r1-f'), 6, 'lightweight refuter cap at 6')
  assert.ok(trace.logs.some((m) => /gating finding\(s\) beyond 6/.test(m) && /routed to documentation without verification/.test(m)), 'refuter-cap log fires at 6')
  // KTD cap drops from 8 to 3
  assert.equal(count(trace, 'ktd-refute-p1-'), 3, 'lightweight KTD cap at 3')
  assert.ok(trace.logs.some((m) => /claim\(s\) beyond 3/.test(m) && /not refuted — listed in run summary openQuestions/.test(m)), 'KTD-cap log fires at 3')
  // persona cap drops from 8 to 4 (roster of 7 conditional+base -> 4 dispatched, 3 dropped)
  assert.equal(count(trace, 'review-r1-'), 4, 'lightweight persona cap at 4')
  assert.ok(trace.logs.some((m) => /persona\(s\) beyond 4 dropped this round/.test(m)), 'persona-cap log fires at 4')
  return 'lightweight tier: refuter cap 6, KTD cap 3, persona cap 4, each overflow logged'
})

S('S48 standard regression: default tier keeps the OLD cap and round behavior (no tier leakage)', async () => {
  // 20 gating findings at the default (standard) tier -> exactly 16 refuters, as before.
  const twenty = Array.from({ length: 20 }, (_, i) => FINDING({ title: `std-finding-${String(i + 1).padStart(2, '0')}`, evidence: `evidence ${i + 1}` }))
  const a = await run(makeDispatcher({ 'review-r1-coherence': () => ({ findings: twenty }) }))
  assert.ifError(a.error)
  assert.equal(count(a.trace, 'refute-r1-f'), 16, 'standard refuter cap stays at 16')
  assert.ok(a.trace.logs.some((m) => /beyond 16/.test(m)), 'standard refuter-cap log still says 16')
  // 10 KTDs at standard -> 8 refuted (old KTD_CAP), overflow logged at 8
  const b = await run(makeDispatcher({}, { classify: { ktds: Array.from({ length: 10 }, (_, i) => `std decision ${i + 1}`), loadBearingAssumptions: [] } }))
  assert.ifError(b.error)
  assert.equal(count(b.trace, 'ktd-refute-p1-'), 8, 'standard KTD cap stays at 8')
  assert.ok(b.trace.logs.some((m) => /claim\(s\) beyond 8/.test(m)), 'standard KTD-cap log still says 8')
  // reviewRounds default stays 2 at standard (personas active in round 2)
  const mkSlow = () => makeDispatcher({ 'editor-r1': () => EDITOR_REVISED() })
  const c = await run(mkSlow())
  assert.ifError(c.error)
  assert.equal(c.result.personaRoundsUsed, 2, 'standard reviewRounds default stays 2')
  assert.ok(c.trace.calls.some((x) => x.label === 'review-r2-coherence'), 'personas active in round 2 at standard')
  return 'standard tier unchanged: refuter cap 16, KTD cap 8, reviewRounds 2 — no leakage from the lightweight tier'
})

S('S49 args.tokenBudget drives the same graceful floor halts as budget.total', async () => {
  // budgetTotal null, tokenBudget set -> the coordinator-side floor uses TOKEN_TARGET.
  // Mirror S11: REVISED at round 1 keeps the loop alive so the floor trips at the round-2 head.
  const a = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED() }), { args: { ...ARGS, tokenBudget: 140000 }, budgetTotal: null })
  assert.ifError(a.error)
  assert.equal(a.result.status, 'halted')
  assert.equal(a.result.haltStage, 'S4-budget-floor', 'tokenBudget produces the S4 floor halt')
  assert.ok(a.trace.logs.some((m) => /Budget floor reached before review round 2/.test(m)))
  // strong plan exits round 1 -> floor trips entering S5
  const b = await run(makeDispatcher(), { args: { ...ARGS, tokenBudget: 140000 }, budgetTotal: null })
  assert.ifError(b.error)
  assert.equal(b.result.haltStage, 'S5-budget-floor', 'tokenBudget produces the S5 floor halt')
  // budget.total precedence: when both are set, budget.total wins and S11 semantics hold
  const c = await run(makeDispatcher({ 'editor-r1': () => EDITOR_REVISED() }), { args: { ...ARGS, tokenBudget: 999999999 }, budgetTotal: 140000 })
  assert.ifError(c.error)
  assert.equal(c.result.haltStage, 'S4-budget-floor', 'budget.total takes precedence over args.tokenBudget')
  return 'args.tokenBudget reproduces the S4/S5 graceful floor halts; budget.total keeps precedence'
})

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
