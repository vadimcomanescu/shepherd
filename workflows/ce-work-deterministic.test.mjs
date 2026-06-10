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
  effortFloor: '', insideCodexSandbox: false, baselineClean: true,
  ceSkillsRoot: '/plugins/compound-engineering/skills', agentBrowserAvailable: true, ghAvailable: true,
  notes: [],
  ...overrides,
})
const EXEC_OK = (id) => ({
  status: 'completed', branch: `wf/test-plan/${id.toLowerCase()}`, worktreePath: `/repo/.worktrees/${id}`,
  filesModified: [`src/${id.toLowerCase()}.js`], verificationSummary: `tests ok for ${id}`, issues: [],
})
const SPLIT_ONE = (uid) => ({ tasks: [{ id: uid, uid, title: `${uid} work`, dependsOn: [], dossier: `dossier ${uid}`, files: [`src/${uid.toLowerCase()}.js`], risk: 'low', ambiguity: 'none', estDiffLines: 100, }] })
const VALIDATION = { testsPass: true, lintPasses: true, requirements: [{ id: 'R1', verdict: 'satisfied', evidence: 'e' }], units: [], deferredQuestions: [], postDeployChecks: ['watch error rates'], notes: 'ok' }

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
    if (label.startsWith('simplify-wave-')) return 'nothing to simplify'
    if (label === 'review-codex') return { ran: true, findings: [], detail: 'clean' }
    if (label.startsWith('review-')) return { findings: [] }
    if (label.startsWith('verify-')) return { refuted: false, reason: 'confirmed' }
    if (label.startsWith('fix-')) return { fixed: [], skipped: [], detail: 'fixed' }
    if (label === 'final-validation') return VALIDATION
    if (label === 'proof' || label === 'proof-retest') return { status: 'pass', routes: [{ route: '/', result: 'pass', detail: 'renders' }], detail: 'ok' }
    if (label === 'proof-fix') return { committed: true, detail: 'fixed and committed' }
    if (label === 'proof-revalidate') return { ...VALIDATION, notes: 're-validated after proof fix' }
    if (label === 'ship') return { pushed: true, prUrl: 'https://github.com/o/r/pull/7', prCreated: true, planStatusFlipped: true, detail: 'shipped' }
    if (label === 'ci-residual') return 'recorded in PR body'
    if (label.startsWith('ci-watch-')) return { checks: 'green', fixedAndPushed: false, detail: 'all checks green' }
    if (label === 'compound') return { documented: false, paths: [], detail: 'nothing qualifying' }
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
  assert.equal(types['review-standards'], 'compound-engineering:ce-project-standards-reviewer')
  assert.equal(types['review-adversarial'], 'compound-engineering:ce-adversarial-reviewer', 'adversarial persona on (120 lines >= 50)')
  assert.equal(types['review-codex'], 'codex-reviewer', 'codex second-model reviewer dispatched')
  assert.equal(types['ci-watch-1'], 'ci-watcher')
  // full lfg tail ran
  assert.equal(result.proof.status, 'pass')
  assert.equal(result.ship.pushed, true)
  assert.match(result.ship.prUrl, /pull\/7/)
  assert.equal(result.ci.status, 'green')
  assert.equal(result.compound.documented, false)
  assert.deepEqual(result.residualReviewFindings, [])
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('Post-Deploy Monitoring & Validation') && shipCall.prompt.includes('watch error rates'), 'PR body carries post-deploy plan')
  assert.ok(shipCall.prompt.includes('status: completed'), 'ship flips plan status')
  return `4/4 merged + shipped, ${trace.calls.length} agent calls, phases: ${[...new Set(trace.phases)].join('>')}`
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
  // single wave = final wave: 4 merges must NOT trigger simplify-as-you-go
  assert.ok(!trace.calls.some((c) => c.label.startsWith('simplify-wave-')), 'no mid-run simplify after the final wave')
  // tripped breaker also removes the codex second-model reviewer
  assert.ok(!trace.calls.some((c) => c.label === 'review-codex'), 'codex reviewer dropped when breaker tripped')
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
  assert.ok(!trace.calls.some((c) => ['proof', 'ship', 'compound'].includes(c.label) || c.label.startsWith('ci-')), 'tail phases skipped on halt')
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /halted/)
  return 'stop-loss halt: partial work kept, tail skipped, hands back to human'
})

S('S8 budget floor: wave 2 skipped cleanly, budgetHalted set', async () => {
  const d = makeDispatcher({}, { units: { units: UNITS().units.slice(0, 2) } }) // U1, U2(dep U1)
  // 10k/call: 7 calls before wave 1 (remaining 40k > floor), 9 before wave 2 (20k <= floor)
  const { result, error } = await run(d, { budgetTotal: 110000 })
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.match(result.tasks.U2.detail, /budget exhausted/)
  assert.equal(result.budgetHalted, true)
  assert.equal(result.validation, null)
  assert.equal(result.ship.pushed, false, 'budget halt does not ship')
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

S('S10 review findings: nit dropped, blocking verified -> sequential fix, no residual', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'off-by-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd' },
      { title: 'naming', file: 'src/u1.js', line: 12, severity: 'nit', detail: 'd' },
    ] }),
    'verify-correctness': () => ({ refuted: false, reason: 'real' }),
    'fix-': () => ({ fixed: ['off-by-one'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'nit excluded, blocking confirmed')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.ok(fixes[0].prompt.includes('off-by-one') && !fixes[0].prompt.includes('naming'))
  assert.deepEqual(result.residualReviewFindings, [], 'fixed finding leaves no residual')
  return '1 confirmed finding fixed; nit never verified; no residuals'
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

S('S14 grounding: NO dispatched prompt contains unresolved placeholders or "undefined"', async () => {
  const d = makeDispatcher({}, { routeExecutor: (id) => (id === 'U1' ? 'codex' : 'claude') })
  const { trace, error } = await run(d)
  assert.ifError(error)
  for (const c of trace.calls) {
    assert.ok(!/<TASK_ID>|<BRANCH>|\$\{|undefined/.test(c.prompt), `unresolved placeholder in ${c.label}:\n${(c.prompt.match(/.{0,40}(<TASK_ID>|<BRANCH>|\$\{|undefined).{0,40}/) || [])[0]}`)
  }
  const codexRun = trace.calls.find((c) => c.label === 'exec-U1-codex')
  assert.ok(codexRun.prompt.includes('--dangerously-bypass-approvals-and-sandbox'), 'yolo sandbox flag present')
  assert.ok(codexRun.prompt.includes(`model_reasoning_effort="medium"`), 'effort flag rendered')
  return `all ${trace.calls.length} prompts clean of placeholders/undefined`
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

S('S18 ship gate: failing tests OR failing lint blocks push; CI and compound never run', async () => {
  const d = makeDispatcher({
    'final-validation': () => ({ ...VALIDATION, testsPass: false }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /gate failed: tests failing/)
  assert.ok(!trace.calls.some((c) => c.label === 'ship'), 'ship agent never dispatched')
  assert.ok(!trace.calls.some((c) => c.label === 'proof'), 'red validation also skips browser proof')
  assert.equal(result.proof.status, 'skipped')
  assert.match(result.proof.detail, /validation gate red/)
  assert.ok(!trace.calls.some((c) => c.label.startsWith('ci-')), 'CI watch never runs without a PR')
  assert.ok(!trace.calls.some((c) => c.label === 'compound'), 'nothing verified, nothing compounded')
  assert.ok(trace.logs.some((m) => /Compound skipped: no verified work/.test(m)))
  // lint half of the gate: green tests, red lint must also block (and compound, gated on tests only, may still run)
  const lintRed = makeDispatcher({ 'final-validation': () => ({ ...VALIDATION, lintPasses: false }) })
  const b = await run(lintRed)
  assert.ifError(b.error)
  assert.equal(b.result.ship.pushed, false)
  assert.match(b.result.ship.detail, /gate failed: lint failing/)
  assert.ok(!b.trace.calls.some((c) => c.label === 'ship'), 'lint-red branch never shipped')
  assert.ok(!b.trace.calls.some((c) => c.label === 'proof'), 'lint-red also skips browser proof')
  // compound may still document verified-tests work, but must NOT push an unshipped branch
  const compoundB = b.trace.calls.find((c) => c.label === 'compound')
  assert.ok(compoundB && compoundB.prompt.includes('Do NOT push'), 'compound never pushes — Ship owns pushing')
  return 'red tests and red lint each keep the branch local'
})

S('S19 CI loop: red+fixed, red+fixed, green on third watch', async () => {
  let watch = 0
  const d = makeDispatcher({
    'ci-watch-': () => {
      watch++
      return watch < 3 ? { checks: 'red', fixedAndPushed: true, detail: `failure ${watch} repaired` } : { checks: 'green', fixedAndPushed: false, detail: 'all green' }
    },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ci.status, 'green')
  assert.equal(result.ci.attempts, 3)
  assert.equal(result.ci.residualRecorded, false)
  assert.ok(!trace.calls.some((c) => c.label === 'ci-residual'), 'no residual section when CI ends green')
  return 'bounded loop converges on green at attempt 3'
})

S('S30 CI rounds are grounded with prior-round history; round 1 is not', async () => {
  let watch = 0
  const d = makeDispatcher({
    'ci-watch-': () => {
      watch++
      return watch < 3 ? { checks: 'red', fixedAndPushed: true, detail: `failure ${watch} repaired` } : { checks: 'green', fixedAndPushed: false, detail: 'all green' }
    },
  })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const w = (n) => trace.calls.find((c) => c.label === `ci-watch-${n}`)
  assert.ok(!w(1).prompt.includes('Previous rounds'), 'round 1 has no history block')
  assert.ok(w(2).prompt.includes('Previous rounds') && w(2).prompt.includes('failure 1 repaired'), 'round 2 grounded with round 1 outcome')
  assert.ok(w(3).prompt.includes('failure 1 repaired') && w(3).prompt.includes('failure 2 repaired'), 'round 3 carries the full history')
  assert.ok(w(3).prompt.includes('do not repeat'), 'history block carries the no-repeat instruction')
  return 'contextless CI watchers are grounded with prior rounds'
})

S('S20 CI exhaustion and CI fix-impossible both end with durable PR residuals', async () => {
  // (a) 3 attempts, all red but each pushed a fix -> exhausted -> residual recorded
  const exhausted = makeDispatcher({
    'ci-watch-': () => ({ checks: 'red', fixedAndPushed: true, detail: 'still failing' }),
  })
  const a = await run(exhausted)
  assert.ifError(a.error)
  assert.equal(a.result.ci.status, 'red')
  assert.equal(a.result.ci.residualRecorded, true)
  assert.equal(a.result.ci.attempts, 3, 'capped at CI_ROUNDS')
  const residualCall = a.trace.calls.find((c) => c.label === 'ci-residual')
  assert.ok(residualCall && residualCall.prompt.includes('a fix WAS pushed after that last watch'), 'unwatched final push stated honestly')
  assert.ok(residualCall.prompt.includes('Round history') && residualCall.prompt.includes('- round 1:') && residualCall.prompt.includes('- round 3:'), 'durable note carries the full round history')
  // (b) red with nothing pushed (e.g. flaky, no fix path) -> stop after 1, residual recorded
  const stuck = makeDispatcher({
    'ci-watch-': () => ({ checks: 'red', fixedAndPushed: false, detail: 'flaky, no fix path' }),
  })
  const b = await run(stuck)
  assert.ifError(b.error)
  assert.equal(b.result.ci.attempts, 1, 'no pointless re-watch when nothing changed')
  assert.equal(b.result.ci.status, 'red')
  assert.equal(b.result.ci.residualRecorded, true)
  assert.ok(b.trace.calls.find((c) => c.label === 'ci-residual').prompt.includes('no fix path'))
  // (c) ciRounds arg is clamped: 99 cannot unbound the loop (same stateless dispatcher)
  const c = await run(exhausted, { args: { ...ARGS, ciRounds: 99 } })
  assert.ifError(c.error)
  assert.equal(c.result.ci.attempts, 10, 'hard ceiling of 10 enforced')
  // (d) the residual recorder itself dies -> reported as NOT recorded, never claimed durable
  const recorderDead = makeDispatcher({
    'ci-watch-': () => ({ checks: 'red', fixedAndPushed: false, detail: 'flaky' }),
    'ci-residual': () => { throw new Error('recorder died') },
  })
  const e = await run(recorderDead)
  assert.ifError(e.error)
  assert.equal(e.result.ci.residualRecorded, false, 'a dead recorder is not a recorded residual')
  assert.ok(e.trace.logs.some((m) => /recorder FAILED/.test(m)))
  // (f) ci-watch agent dies (null) -> 'unknown' state on a live PR still records a residual
  const watcherDead = makeDispatcher({
    'ci-watch-': () => null,
  })
  const f = await run(watcherDead)
  assert.ifError(f.error)
  assert.equal(f.result.ci.status, 'unknown')
  assert.equal(f.result.ci.residualRecorded, true, 'unknown CI state on a live PR is still recorded')
  assert.ok(f.trace.calls.find((c) => c.label === 'ci-residual').prompt.includes('UNVERIFIED'))
  return 'exhausted after 3; unfixable stops at 1; clamped at 10; dead recorder + dead watcher both honest'
})

S('S28 CI never watched (budget floor before first watch) still records a live-PR residual', async () => {
  // Single unit so the diff is small; budget tuned to survive through Ship but
  // hit the floor at the first CI watch. Ship pushed + PR exists -> unwatched
  // checks must not be silently dropped.
  const d = makeDispatcher({ diffstat: () => ({ lines: 10 }) }, { units: { units: [UNITS().units[0]] } })
  // Find the call index of the first ci-watch under unlimited budget, then set
  // the budget so the floor trips exactly at it.
  const probe = await run(d)
  assert.ifError(probe.error)
  const ciIdx = probe.trace.calls.findIndex((c) => c.label === 'ci-watch-1')
  assert.ok(ciIdx > 0, 'ci-watch-1 dispatched under unlimited budget')
  const { result, trace, error } = await run(d, { budgetTotal: 10000 * ciIdx + 25000 }) // remaining 25k <= 30k floor at the CI watch
  assert.ifError(error)
  assert.equal(result.ship.pushed, true, 'shipped before the floor')
  assert.equal(result.ci.status, 'skipped', 'CI never watched')
  assert.equal(result.ci.attempts, 0)
  assert.equal(result.ci.residualRecorded, true, 'unwatched live PR is recorded, not silently dropped')
  assert.ok(trace.calls.find((c) => c.label === 'ci-residual').prompt.includes('never watched'))
  return 'budget floor before first CI watch -> durable PR note, no silent drop'
})

S('S21 proof: missing agent-browser skips cleanly; failing route gets one fix round', async () => {
  const FAIL_PROOF = { status: 'fail', routes: [{ route: '/users', result: 'fail', detail: '500 on render' }], detail: 'broken' }
  // (a) no agent-browser -> proof never dispatched, ship still happens and says so
  const noBrowser = makeDispatcher({}, { recon: { agentBrowserAvailable: false } })
  const a = await run(noBrowser)
  assert.ifError(a.error)
  assert.equal(a.result.proof.status, 'skipped')
  assert.match(a.result.proof.detail, /agent-browser not installed/)
  assert.ok(!a.trace.calls.some((c) => c.label === 'proof'))
  assert.ok(a.trace.logs.some((m) => /Proof skipped: agent-browser/.test(m)))
  assert.ok(a.trace.calls.find((c) => c.label === 'ship').prompt.includes('skipped (agent-browser not installed)'))
  // (b) initial proof fails one route -> fix agent + retest, retest result wins
  const failing = makeDispatcher({
    'proof-retest': () => ({ status: 'pass', routes: [{ route: '/users', result: 'pass', detail: 'renders after fix' }], detail: 'ok' }),
    'proof-revalidate': () => ({ ...VALIDATION, requirements: [{ id: 'R1', verdict: 'partial', evidence: 'changed by proof fix' }], notes: 're-validated after proof fix' }),
    'proof-fix': () => ({ committed: true, detail: 'fixed and committed' }),
    proof: () => FAIL_PROOF,
  })
  const b = await run(failing)
  assert.ifError(b.error)
  const fix = b.trace.calls.find((c) => c.label === 'proof-fix')
  assert.ok(fix && fix.prompt.includes('/users') && fix.prompt.includes('500 on render'), 'fixer grounded with the failing route')
  assert.ok(b.trace.calls.some((c) => c.label === 'proof-retest'))
  assert.equal(b.result.proof.status, 'pass', 'retest verdict replaces the failed one')
  // the fix commit landed after validation: the FULL trace must be re-grounded,
  // not just tests+lint — the PR body must reflect the post-fix requirements.
  assert.ok(b.trace.calls.some((c) => c.label === 'proof-revalidate'), 'ship gate re-validated after proof fix')
  assert.match(b.result.validation.notes, /re-validated after proof fix/)
  assert.equal(b.result.validation.requirements[0].verdict, 'partial', 'requirements trace re-grounded, not stale')
  assert.ok(b.trace.calls.find((c) => c.label === 'ship').prompt.includes('R1: partial'), 'PR body carries the re-grounded requirement, not the pre-fix snapshot')
  // the successful fix round is compound material; an un-fixed one is not
  assert.ok(b.trace.calls.find((c) => c.label === 'compound').prompt.includes('browser-proof failures diagnosed and fixed'))
  // (c) retest STILL failing -> failure becomes a durable PR residual, not compound material
  const stillFailing = makeDispatcher({
    'proof-retest': () => ({ status: 'fail', routes: [{ route: '/users', result: 'fail', detail: 'still 500' }], detail: 'broken' }),
    'proof-revalidate': () => ({ ...VALIDATION, notes: 're-validated after proof fix' }),
    'proof-fix': () => ({ committed: true, detail: 'fixed and committed' }),
    proof: () => FAIL_PROOF,
  })
  const c = await run(stillFailing)
  assert.ifError(c.error)
  const shipC = c.trace.calls.find((x) => x.label === 'ship')
  assert.ok(shipC.prompt.includes('browser-proof failure: /users'), 'surviving proof failure lands in PR residuals')
  assert.ok(!c.trace.calls.find((x) => x.label === 'compound').prompt.includes('diagnosed and fixed'), 'failed fix round is not claimed as solved')
  // (d) fixer lands NO commit -> no retest of identical code, original failure kept
  const noCommit = makeDispatcher({
    'proof-fix': () => ({ committed: false, detail: 'could not reproduce locally' }),
    proof: () => FAIL_PROOF,
  })
  const e = await run(noCommit)
  assert.ifError(e.error)
  assert.ok(!e.trace.calls.some((x) => x.label === 'proof-retest'), 'no retest without a fix commit (flaky-pass guard)')
  assert.ok(!e.trace.calls.some((x) => x.label === 'proof-revalidate'), 'no re-gate without a fix commit')
  assert.equal(e.result.proof.status, 'fail', 'original honest failure kept')
  assert.ok(e.trace.logs.some((m) => /landed no commit/.test(m)))
  // (e) re-validation agent dies after a fix commit -> fail closed on BOTH tests AND lint
  const regateDead = makeDispatcher({
    'proof-retest': () => ({ status: 'pass', routes: [{ route: '/users', result: 'pass', detail: 'ok' }], detail: 'ok' }),
    'proof-fix': () => ({ committed: true, detail: 'fixed and committed' }),
    'proof-revalidate': () => { throw new Error('revalidate died') },
    proof: () => FAIL_PROOF,
  })
  const f = await run(regateDead)
  assert.ifError(f.error)
  assert.equal(f.result.validation.testsPass, false, 'fail closed on tests')
  assert.equal(f.result.validation.lintPasses, false, 'fail closed on lint too — not left stale-green')
  assert.equal(f.result.ship.pushed, false, 'dead re-validation blocks ship')
  return 'skip is honest; full trace re-grounded after fix; dead re-validation fails closed on both gates'
})

S('S22 codex second-model reviewer: findings verified by claude refuter; ran=false logged', async () => {
  // (a) codex finds a blocking issue -> skeptical-refuter verifies -> fixer dispatched
  const finds = makeDispatcher({
    'review-codex': () => ({ ran: true, findings: [{ title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd' }], detail: 'found 1' }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const a = await run(finds)
  assert.ifError(a.error)
  assert.equal(a.result.confirmedReviewFindings, 1)
  const verify = a.trace.calls.find((c) => c.label.startsWith('verify-codex-'))
  assert.equal(verify.agentType, 'skeptical-refuter', 'codex finding cross-verified by claude')
  // (b) codex review fails to run -> logged, zero findings, run unaffected
  const broken = makeDispatcher({ 'review-codex': () => ({ ran: false, findings: [], detail: 'codex binary crashed' }) })
  const b = await run(broken)
  assert.ifError(b.error)
  assert.ok(b.trace.logs.some((m) => /Codex second-model review did not run: codex binary crashed/.test(m)))
  // (c) codex unavailable -> reviewer roster has no codex entry at all
  const off = makeDispatcher({}, { recon: { codexAvailable: false } })
  const c = await run(off)
  assert.ifError(c.error)
  assert.ok(!c.trace.calls.some((x) => x.label === 'review-codex'))
  assert.ok(c.trace.logs.some((m) => /Codex second-model review skipped/.test(m)))
  return 'cross-model review verified, failure surfaced, absence logged'
})

S('S23 fixer-skipped finding becomes a residual and lands in the PR body', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'off-by-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd' }] }),
    'fix-': () => ({ fixed: [], skipped: [{ title: 'off-by-one', reason: 'needs design input' }], detail: '' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.residualReviewFindings.length, 1)
  assert.equal(result.residualReviewFindings[0].reason, 'needs design input')
  assert.equal(result.residualReviewFindings[0].severity, 'blocking')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('## Residuals') && shipCall.prompt.includes('off-by-one'), 'residual durable in PR body')
  return 'lfg residual contract: skipped fix -> PR body, never silently dropped'
})

S('S24 simplify-as-you-go: fires only after a multi-merge wave, never after the final wave', async () => {
  const d = makeDispatcher({}, { routeExecutor: () => 'claude' })
  const { trace, error } = await run(d) // waves: [U1,U4] -> [U2] -> [U3]
  assert.ifError(error)
  const waves = trace.calls.filter((c) => c.label.startsWith('simplify-wave-')).map((c) => c.label)
  assert.deepEqual(waves, ['simplify-wave-1'], 'only the 2-task non-final wave triggers it')
  const call = trace.calls.find((c) => c.label === 'simplify-wave-1')
  assert.ok(call.prompt.includes('U1, U4') || call.prompt.includes('U4, U1'), 'grounded with the merged task ids')
  assert.ok(call.prompt.includes('ce-simplify-code'), 'follows the installed skill')
  return 'mid-run simplify hook gated correctly'
})

S('S27 cross-reviewer dedup: same file+title from two reviewers is one finding, one fix line', async () => {
  const finding = { title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'suggested', detail: 'd' }
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [finding] }),
    'review-codex': () => ({ ran: true, findings: [{ ...finding, severity: 'blocking' }], detail: 'found 1' }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'merged into one finding')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.equal((fixes[0].prompt.match(/unchecked race/g) || []).length, 1, 'one line, not two')
  assert.ok(fixes[0].prompt.includes('blocking'), 'merged finding keeps the higher severity')
  assert.ok(fixes[0].prompt.includes('correctness+codex') || fixes[0].prompt.includes('codex+correctness'), 'both personas credited')
  assert.deepEqual(result.residualReviewFindings, [], 'single fixed title accounts for the merged finding exactly once')
  // Two DISTINCT problems sharing a title at different lines must NOT collapse —
  // the second would otherwise be silently dropped before any fixer saw it.
  const d2 = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'race at line 4' },
      { title: 'unchecked race', file: 'src/u1.js', line: 99, severity: 'blocking', detail: 'different race at line 99' },
    ] }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const r2 = await run(d2)
  assert.ifError(r2.error)
  assert.equal(r2.result.confirmedReviewFindings, 2, 'distinct lines stay two findings')
  const fix2 = r2.trace.calls.find((c) => c.label.startsWith('fix-'))
  assert.ok(fix2.prompt.includes('race at line 4') && fix2.prompt.includes('different race at line 99'), 'both distinct details reach the fixer')
  return 'fingerprint dedup merges true dups, keeps distinct same-title findings'
})

S('S26 tail budget floor: waves finish but Proof/Ship/Compound are skipped with logs', async () => {
  // Single unit; diffstat lowered so reviewer roster is fixed at 6 (no adversarial).
  // Call ledger at 10k/call: parse+recon(2) setup(3) split(4) route(5) exec(6) merge(7)
  // diffstat(8) reviews x6 (14) final-validation(15) = 150k spent entering the tail.
  // budgetTotal 175k -> remaining 25k <= 30k floor at Proof: tail must skip, not throw.
  const d = makeDispatcher({ diffstat: () => ({ lines: 10 }) }, { units: { units: [UNITS().units[0]] } })
  const { result, trace, error } = await run(d, { budgetTotal: 175000 })
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged', 'execution itself completed under budget')
  assert.equal(result.budgetHalted, false, 'wave-level floor never hit')
  assert.ok(!trace.calls.some((c) => ['proof', 'ship', 'compound'].includes(c.label) || c.label.startsWith('ci-')), 'tail agents never dispatched')
  assert.ok(trace.logs.some((m) => /Proof skipped: token budget floor reached/.test(m)))
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /token budget floor/)
  assert.match(result.proof.detail, /token budget floor/, 'budget skip recorded on proof, not re-derived at ship')
  assert.ok(trace.logs.some((m) => /Compound skipped: token budget floor reached/.test(m)))
  return 'no-silent-caps: every budget-skipped tail phase says so'
})

S('S25 args opt-outs: ship:false stays local, proof:false and compound:false skip phases', async () => {
  const d = makeDispatcher({})
  const { result, trace, error } = await run(d, { args: { ...ARGS, ship: false, proof: false, compound: false } })
  assert.ifError(error)
  assert.ok(!trace.calls.some((c) => ['proof', 'ship', 'compound'].includes(c.label) || c.label.startsWith('ci-')))
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /args\.ship/)
  assert.equal(result.proof.status, 'skipped')
  assert.match(result.proof.detail, /args\.proof/)
  assert.equal(result.compound, null)
  return 'every tail phase individually opt-out-able'
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
