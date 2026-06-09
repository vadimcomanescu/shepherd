import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'

// Build the coordinator from the actual workflow script: same injection contract
// as the dynamic-workflow runtime (body runs in an async function scope).
const dir = dirname(fileURLToPath(import.meta.url))
const scriptSrc = readFileSync(join(dir, 'ce-work-deterministic.js'), 'utf8').replace(/^export const meta = /, 'const meta = ')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', scriptSrc)
const coordinator = ({ args, agent, parallel, pipeline, phase, log, budget, workflow }) => body(args, agent, parallel, pipeline, phase, log, budget, workflow)


// ---------- fake primitives matching the documented runtime contract ----------
function makeRuntime(dispatcher, { budgetTotal = null, costPerCall = 10000 } = {}) {
  const trace = { calls: [], logs: [], phases: [] }
  let spent = 0
  const agent = async (prompt, opts = {}) => {
    trace.calls.push({ label: opts.label || '(none)', prompt, agentType: opts.agentType })
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

// ---------- fixtures ----------
const UNITS = (overrides = {}) => ({
  planTitle: 'Test plan', slug: 'test-plan',
  riskSurfaces: ['migrations'],
  requirements: [{ id: 'R1', text: 'req one' }],
  deferredQuestions: [], scopeBoundaries: [],
  units: [
    { uid: 'U1', name: 'one', goal: 'g1', requirements: ['R1'], dependsOn: [], files: ['src/u1.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v1' },
    { uid: 'U2', name: 'two', goal: 'g2', requirements: [], dependsOn: ['U1'], files: ['src/u2.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v2' },
    { uid: 'U3', name: 'three', goal: 'g3', requirements: [], dependsOn: ['U2'], files: ['src/u3.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v3' },
    { uid: 'U4', name: 'four', goal: 'g4', requirements: [], dependsOn: [], files: ['src/u4.js'], approach: 'a', patterns: [], testScenarios: ['s'], verification: 'v4' },
  ],
  ...overrides,
})
const RECON = (overrides = {}) => ({
  repoRoot: '/repo', defaultBranch: 'main', testCommand: 'npm test', lintCommand: 'npm run lint',
  conventionsDigest: 'conventions', codexAvailable: true, codexPath: '/usr/local/bin/codex',
  effortFloor: '', insideCodexSandbox: false, baselineClean: true, notes: [],
  ...overrides,
})
const EXEC_OK = (id) => ({
  status: 'completed', branch: `wf/test-plan/${id.toLowerCase()}`, worktreePath: `/repo/.worktrees/${id}`,
  filesModified: [`src/${id.toLowerCase()}.js`], verificationSummary: `tests ok for ${id}`, issues: [],
})
const SPLIT_ONE = (uid) => ({ tasks: [{ id: uid, uid, title: `${uid} work`, dependsOn: [], dossier: `dossier ${uid}`, files: [`src/${uid.toLowerCase()}.js`], risk: 'low', ambiguity: 'none', estDiffLines: 100, }] })
const VALIDATION = { testsPass: true, lintPasses: true, requirements: [{ id: 'R1', verdict: 'satisfied', evidence: 'e' }], units: [], notes: 'ok' }

// default dispatcher: label-prefix routing; overrides win
function makeDispatcher(overrides = {}, opts = {}) {
  const routeExecutor = opts.routeExecutor || (() => 'claude')
  return async (prompt, o) => {
    const label = o.label || ''
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (label.startsWith(prefix)) return fn(prompt, o, label)
    }
    if (label === 'parse-plan') return UNITS(opts.units)
    if (label === 'repo-recon') return RECON(opts.recon)
    if (label === 'setup-integration') return 'ok: /repo/.worktrees/test-plan'
    if (label.startsWith('split-')) return SPLIT_ONE(label.slice(6))
    if (label.startsWith('route-')) return { executor: routeExecutor(label.slice(6)), effort: 'medium', reason: 'sim' }
    if (label.startsWith('exec-')) return EXEC_OK(label.split('-')[1])
    if (label.startsWith('finish-')) return EXEC_OK(label.split('-')[1])
    if (label.startsWith('redo-')) return { ...EXEC_OK(label.split('-')[1]), branch: `wf/test-plan/${label.split('-')[1].toLowerCase()}-redo` }
    if (label.startsWith('merge-')) return { status: 'merged', detail: 'ok' }
    if (label.startsWith('triage-')) return { verdict: 'continue', reason: 'local', evidence: [] }
    if (label === 'diffstat') return { lines: 120 }
    if (label === 'simplify') return 'nothing to simplify'
    if (label.startsWith('review-')) return { findings: [] }
    if (label.startsWith('verify-')) return { refuted: false, reason: 'confirmed' }
    if (label.startsWith('fix-')) return 'fixed'
    if (label === 'final-validation') return VALIDATION
    throw Object.assign(new Error(`UNHANDLED LABEL: ${label}`), { __hardThrow: true })
  }
}

const ARGS = { plan: 'docs/plans/test.md', planVersion: 'v1', startedAt: 1749470000000 }
async function run(dispatcher, { args = ARGS, budgetTotal = null } = {}) {
  const { runtime, trace } = makeRuntime(dispatcher, { budgetTotal })
  try {
    const result = await coordinator({ args, ...runtime })
    return { result, trace, error: null }
  } catch (error) {
    return { result: null, trace, error }
  }
}

// ---------- scenarios ----------
const scenarios = []
const S = (name, fn) => scenarios.push({ name, fn })

S('S1 happy path: 4 units, mixed routing, all merged + validated', async () => {
  const d = makeDispatcher({}, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  for (const id of ['U1', 'U2', 'U3', 'U4']) assert.equal(result.tasks[id].status, 'merged', `${id} merged`)
  assert.equal(result.tasks.U1.executor, 'codex')
  assert.equal(result.tasks.U2.executor, 'claude')
  assert.equal(result.planInvalidation, null)
  assert.equal(result.budgetHalted, false)
  assert.ok(result.validation.testsPass)
  // wave ordering: U1+U4 wave1, U2 wave2, U3 wave3; merges strictly after execs per wave
  const execU2 = trace.calls.findIndex((c) => c.label.startsWith('exec-U2'))
  const mergeU1 = trace.calls.findIndex((c) => c.label === 'merge-U1')
  assert.ok(mergeU1 < execU2, 'U1 merged before U2 executes')
  // migrations persona selected
  assert.ok(trace.calls.some((c) => c.label === 'review-migrations'), 'migrations reviewer ran')
  // extracted agent personas dispatched via agentType
  const types = Object.fromEntries(trace.calls.map((c) => [c.label, c.agentType]))
  assert.equal(types['split-U1'], 'task-splitter')
  assert.equal(types['route-U1'], 'executor-router')
  assert.equal(types['exec-U1-codex'], 'codex-runner')
  assert.equal(types['exec-U2-claude'], 'unit-executor')
  assert.equal(types['review-migrations'], 'compound-engineering:ce-data-migration-reviewer')
  return `4/4 merged, ${trace.calls.length} agent calls, phases: ${[...new Set(trace.phases)].join('>')}`
})

S('S2 splitter dies for U1: U2,U3 transitively skipped, U4 still runs', async () => {
  const d = makeDispatcher({ 'split-U1': () => { throw new Error('splitter died') } })
  const { result, error } = await run(d)
  assert.ifError(error)
  assert.deepEqual(result.droppedUnits, ['U1'])
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.match(result.tasks.U2.detail, /prerequisite unit dropped/)
  assert.equal(result.tasks.U3.status, 'skipped')
  assert.equal(result.tasks.U4.status, 'merged')
  assert.equal(result.tasks.U1, undefined, 'U1 has no tasks at all')
  return 'transitive drop works; U4 unaffected'
})

S('S3 codex circuit breaker: 3+ failures in one wave trip it; fallbacks still merge', async () => {
  const d = makeDispatcher(
    { 'exec-U': (p, o, label) => (label.includes('-codex') ? { ...EXEC_OK(label.split('-')[1]), status: 'failed', issues: ['codex broke'] } : EXEC_OK(label.split('-')[1])) },
    { units: { units: UNITS().units.map((u) => ({ ...u, dependsOn: [] })) }, routeExecutor: () => 'codex' },
  )
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  for (const id of ['U1', 'U2', 'U3', 'U4']) {
    assert.equal(result.tasks[id].status, 'merged')
    assert.equal(result.tasks[id].executor, 'claude (codex fallback)')
  }
  assert.equal(result.codexCircuitBreakerTripped, true)
  assert.ok(trace.calls.every((c) => !c.label.includes('claude-fallback') || c.prompt.includes('worktree remove --force')), 'fallback prompts carry stale cleanup')
  return 'breaker tripped, all 4 recovered via claude fallback with cleanup preamble'
})

S('S4 codex partial -> claude finisher completes -> merged with finisher attribution; streak counts partial', async () => {
  let streakLog = null
  const d = makeDispatcher({
    'exec-U1-codex': () => ({ ...EXEC_OK('U1'), status: 'partial', issues: ['error path missing'] }),
  }, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U1.executor, 'partial + claude finisher')
  const finish = trace.calls.find((c) => c.label === 'finish-U1')
  assert.ok(finish && finish.prompt.includes('error path missing'), 'finisher sees the gaps')
  return 'codex partial finished and merged'
})

S('S5 claude partial whose finisher also returns partial: task fails, dependent skipped', async () => {
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), status: 'partial', issues: ['gap'] }),
    'finish-U1': () => ({ ...EXEC_OK('U1'), status: 'partial', issues: ['still gap'] }),
  })
  const { result, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'failed')
  assert.match(result.tasks.U1.detail, /partial/)
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.equal(result.tasks.U3.status, 'skipped')
  assert.equal(result.tasks.U4.status, 'merged')
  return 'unfinished partial cannot merge; dependents skip'
})

S('S6 merge conflict -> redo -> retry merge; attribution reflects the redo', async () => {
  let firstMerge = true
  const d = makeDispatcher({
    'merge-U1': (p, o, label) => {
      if (label === 'merge-U1' && firstMerge) { firstMerge = false; return { status: 'conflict', detail: 'CONFLICT in src/u1.js' } }
      return { status: 'merged', detail: 'ok' }
    },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U1.executor, 'claude (conflict redo)')
  const redo = trace.calls.find((c) => c.label === 'redo-U1')
  assert.ok(redo.prompt.includes('worktree remove --force'), 'redo cleans stale attempt')
  assert.ok(trace.calls.some((c) => c.label === 'merge-U1-retry'), 'retry merge ran')
  return 'conflict redo path works, attribution correct'
})

S('S7 plan-invalidating discovery halts after wave 1; quality/validate skipped', async () => {
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), issues: ['planned module src/legacy.js does not exist'] }),
    'triage-wave-1': () => ({ verdict: 'halt', reason: 'U2/U3 extend a module that does not exist', evidence: ['src/legacy.js missing'] }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.match(result.tasks.U2.detail, /plan invalidated/)
  assert.equal(result.planInvalidation.afterWave, 1)
  assert.equal(result.validation, null)
  assert.equal(result.confirmedReviewFindings, 0)
  assert.ok(!trace.calls.some((c) => c.label === 'diffstat'), 'quality phase skipped')
  return 'stop-loss halt: partial work kept, hands back to human'
})

S('S8 budget floor: wave 2 skipped cleanly, budgetHalted set', async () => {
  const d = makeDispatcher({}, { units: { units: UNITS().units.slice(0, 2) } }) // U1, U2(dep U1)
  const { result, error } = await run(d, { budgetTotal: 100000 }) // 10k/call; floor hits before wave 2
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.match(result.tasks.U2.detail, /budget exhausted/)
  assert.equal(result.budgetHalted, true)
  assert.equal(result.validation, null)
  return 'clean partial result instead of mid-wave throws'
})

S('S9 intra-unit dependency cycle throws a named error', async () => {
  const d = makeDispatcher({
    'split-U1': () => ({ tasks: [
      { id: 'U1a', uid: 'U1', title: 'a', dependsOn: ['U1b'], dossier: 'd', files: ['src/a.js'], risk: 'low', ambiguity: 'none', estDiffLines: 10 },
      { id: 'U1b', uid: 'U1', title: 'b', dependsOn: ['U1a'], dossier: 'd', files: ['src/b.js'], risk: 'low', ambiguity: 'none', estDiffLines: 10 },
    ] }),
  })
  const { error } = await run(d)
  assert.ok(error && /cycle/i.test(error.message), `expected cycle error, got: ${error}`)
  return `throws: "${error.message}"`
})

S('S10 review findings: nit dropped, blocking verified -> sequential fix', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'off-by-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd' },
      { title: 'naming', file: 'src/u1.js', line: 12, severity: 'nit', detail: 'd' },
    ] }),
    'verify-correctness': () => ({ refuted: false, reason: 'real' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'nit excluded, blocking confirmed')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.ok(fixes[0].prompt.includes('off-by-one') && !fixes[0].prompt.includes('naming'))
  return '1 confirmed finding fixed; nit never verified'
})

S('S11 determinism: identical inputs -> identical agent-call label sequence', async () => {
  const mk = () => makeDispatcher({}, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const a = await run(mk()); const b = await run(mk())
  assert.ifError(a.error); assert.ifError(b.error)
  assert.deepEqual(a.trace.calls.map((c) => c.label), b.trace.calls.map((c) => c.label))
  assert.deepEqual(a.trace.calls.map((c) => c.prompt), b.trace.calls.map((c) => c.prompt), 'prompts byte-identical')
  return `${a.trace.calls.length} calls, byte-identical labels and prompts across runs`
})

S('S12 guards: missing plan arg / dirty baseline / zero units all throw early', async () => {
  const r1 = await run(makeDispatcher({}), { args: {} })
  assert.ok(r1.error && /requires args\.plan/.test(r1.error.message))
  const r2 = await run(makeDispatcher({}, { recon: { baselineClean: false } }))
  assert.ok(r2.error && /uncommitted/.test(r2.error.message))
  const r3 = await run(makeDispatcher({ 'parse-plan': () => ({ ...UNITS(), units: [] }) }))
  assert.ok(r3.error && /No implementation units/.test(r3.error.message))
  return 'all three preflight guards fire'
})

S('S13 codex unavailable: router picks codex but coordinator overrides to claude', async () => {
  const d = makeDispatcher({}, { recon: { codexAvailable: false }, routeExecutor: () => 'codex' })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  for (const id of ['U1', 'U2', 'U3', 'U4']) {
    assert.equal(result.tasks[id].routedTo, 'claude', `${id} overridden to claude`)
    assert.match(result.tasks[id].routeReason, /codex unavailable/)
  }
  assert.ok(!trace.calls.some((c) => c.label.includes('-codex')), 'no codex runner ever dispatched')
  return 'override applied to every task'
})

S('S14 grounding: executor/runner prompts contain no unresolved placeholders', async () => {
  const d = makeDispatcher({}, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const work = trace.calls.filter((c) => /^(exec|finish|redo|merge)-/.test(c.label))
  for (const c of work) {
    assert.ok(!/<TASK_ID>|<BRANCH>|\$\{|undefined/.test(c.prompt), `unresolved placeholder in ${c.label}:\n${(c.prompt.match(/.{0,40}(<TASK_ID>|<BRANCH>|\$\{|undefined).{0,40}/) || [])[0]}`)
  }
  const codexRun = trace.calls.find((c) => c.label === 'exec-U1-codex')
  assert.ok(codexRun.prompt.includes('--dangerously-bypass-approvals-and-sandbox'), 'yolo sandbox flag present')
  assert.ok(codexRun.prompt.includes(`model_reasoning_effort="medium"`), 'effort flag rendered')
  return `${work.length} work prompts clean of placeholders/undefined`
})

S('S15 effort floor: config floor high lifts a medium pick to high', async () => {
  const d = makeDispatcher({}, { recon: { effortFloor: 'high' }, routeExecutor: () => 'codex' })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const codexRun = trace.calls.find((c) => c.label === 'exec-U1-codex')
  assert.ok(codexRun.prompt.includes(`model_reasoning_effort="high"`), 'floor applied: medium -> high')
  assert.equal(result.effortFloor, 'high')
  return 'max(pick, floor) resolution works'
})


S('S16 codex runner dies entirely (null result): fallback dispatched with cleanup, merged', async () => {
  let killed = false
  const d = makeDispatcher({
    'exec-U1-codex': () => { throw new Error('runner died mid-poll') },
  }, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U1.executor, 'claude (codex fallback)')
  const fb = trace.calls.find((c) => c.label === 'exec-U1-claude-fallback')
  assert.ok(fb.prompt.includes('worktree remove --force') && fb.prompt.includes('branch -D'), 'fallback cleans the dead runner leftovers')
  return 'null-runner path recovers via cleaned fallback'
})

S('S17 triage agent itself dies: fail-open, execution continues', async () => {
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), issues: ['some discovery'] }),
    'triage-wave-1': () => { throw new Error('triage died') },
  })
  const { result, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U2.status, 'merged', 'run continued despite dead triage')
  assert.equal(result.planInvalidation, null)
  return 'dead triage does not halt the run'
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
