import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'

// Build the coordinator from the actual workflow script: same injection contract
// as the dynamic-workflow runtime (body runs in an async function scope).
const dir = dirname(fileURLToPath(import.meta.url))
const scriptSrc = readFileSync(join(dir, 'shepherd-deliver.js'), 'utf8').replace(/^export const meta = /, 'const meta = ')
const codexReviewerSrc = readFileSync(join(dir, '..', 'agents', 'codex-reviewer.md'), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const body = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', scriptSrc)
const coordinator = ({ args, agent, parallel, pipeline, phase, log, budget, workflow }) => body(args, agent, parallel, pipeline, phase, log, budget, workflow)


// ---------- fake primitives matching the documented runtime contract ----------
function makeRuntime(dispatcher, { budgetTotal = null, costPerCall = 10000 } = {}) {
  const trace = { calls: [], logs: [], phases: [] }
  let spent = 0
  const agent = async (prompt, opts = {}) => {
    trace.calls.push({ label: opts.label || '(none)', prompt, agentType: opts.agentType, schema: opts.schema, model: opts.model })
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
    if (label === 'simplify') return { changed: false, detail: 'nothing to simplify', kept: [] }
    if (label.startsWith('simplify-wave-')) return { changed: false, detail: 'nothing to simplify', kept: [] }
    if (label === 'review-codex') return { ran: true, findings: [], detail: 'clean' }
    if (label.startsWith('review-')) return { findings: [] }
    if (label === 'sweep') return { findings: [] }
    if (label.startsWith('verify-')) return { verdict: 'CONFIRMED', evidence: 'e' }
    if (label.startsWith('fix-')) return { fixed: [], skipped: [], detail: 'fixed' }
    if (label === 'final-validation') return VALIDATION
    if (label === 'proof' || label === 'proof-retest') return { status: 'pass', routes: [{ route: '/', result: 'pass', detail: 'renders' }], detail: 'ok' }
    if (label === 'proof-fix') return { committed: true, detail: 'fixed and committed' }
    if (label === 'proof-revalidate') return { ...VALIDATION, notes: 're-validated after proof fix' }
    if (label === 'audit-fixes') return { unsupported: [], detail: 'every claim backed by a commit' }
    if (label === 'gate-recheck') return { testsPass: true, lintPasses: true, evidence: 'npm test exit 0; npm run lint exit 0' }
    if (label === 'ship-verify') return { pushed: true, prUrl: 'https://github.com/o/r/pull/7', evidence: 'ahead 0; PR open' }
    if (label === 'audit-compound') return { failures: [], detail: 'all paths committed' }
    if (label === 'ship') return { pushed: true, prUrl: 'https://github.com/o/r/pull/7', prCreated: true, planStatusFlipped: true, detail: 'shipped' }
    if (label.startsWith('ci-residual')) return 'recorded in PR body'
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
  assert.ok(trace.calls.some((c) => c.label === 'review-removed-behavior'), 'removed-behavior inline reviewer ran')
  assert.ok(trace.calls.some((c) => c.label === 'review-cross-file'), 'cross-file inline reviewer ran')
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
  assert.equal(types['review-removed-behavior'], undefined, 'removed-behavior reviewer is inline, no agentType')
  assert.equal(types['review-cross-file'], undefined, 'cross-file reviewer is inline, no agentType')
  // inline angle reviewers: base review prompt + grounding + angle text + FINDINGS_SCHEMA
  const removedBehavior = trace.calls.find((c) => c.label === 'review-removed-behavior')
  assert.ok(removedBehavior.prompt.includes('invariant or behavior it enforced'), 'removed-behavior angle text appended')
  assert.ok(removedBehavior.prompt.includes('/repo/.worktrees/test-plan') && removedBehavior.prompt.includes('docs/plans/test.md'), 'removed-behavior prompt carries worktree + plan grounding')
  assert.ok(removedBehavior.prompt.includes('failure_scenario'), 'removed-behavior carries the base review prompt')
  assert.ok(removedBehavior.schema && removedBehavior.schema.properties.findings, 'removed-behavior uses FINDINGS_SCHEMA')
  const crossFile = trace.calls.find((c) => c.label === 'review-cross-file')
  assert.ok(crossFile.prompt.includes('find its callers'), 'cross-file angle text appended')
  assert.ok(crossFile.prompt.includes('/repo/.worktrees/test-plan') && crossFile.prompt.includes('docs/plans/test.md'), 'cross-file prompt carries worktree + plan grounding')
  assert.ok(crossFile.schema && crossFile.schema.properties.findings, 'cross-file uses FINDINGS_SCHEMA')
  assert.equal(types['ci-watch-1'], 'ci-watcher')
  // full lfg tail ran
  assert.equal(result.proof.status, 'pass')
  assert.equal(result.ship.pushed, true)
  assert.match(result.ship.prUrl, /pull\/7/)
  assert.equal(result.ci.status, 'green')
  assert.equal(result.compound.documented, false)
  assert.deepEqual(result.residualReviewFindings, [])
  assert.deepEqual(result.reviewStats, { candidates: 0, verified: 0, refuted: 0, dupes: 0, budgetDropped: 0, verifierFailed: 0 }, 'reviewStats present with clean-review zeros')
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
  assert.ok(trace.calls.some((c) => c.label === 'review-removed-behavior'), 'removed-behavior reviewer still runs when codex is unavailable')
  assert.ok(trace.calls.some((c) => c.label === 'review-cross-file'), 'cross-file reviewer still runs when codex is unavailable')
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
  assert.equal(finish.model, 'sonnet', 'finisher runs at the routed tier (stub route carries no model, so the sonnet fallback applies)')
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

S('S7 plan-invalidating discovery halts after wave 1 when independently confirmed; quality/validate skipped', async () => {
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), issues: ['planned module src/legacy.js does not exist'] }),
    'triage-wave-1': () => ({ verdict: 'halt', reason: 'U2/U3 extend a module that does not exist', evidence: ['src/legacy.js missing'] }),
    'triage-confirm-wave-1': () => ({ verdict: 'halt', reason: 'confirmed: U2/U3 extend src/legacy.js which is absent', evidence: ['src/legacy.js missing'] }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.tasks.U1.status, 'merged')
  assert.equal(result.tasks.U2.status, 'skipped')
  assert.match(result.tasks.U2.detail, /plan invalidated/)
  assert.equal(result.planInvalidation.afterWave, 1)
  const confirmCall = trace.calls.find((c) => c.label === 'triage-confirm-wave-1')
  assert.ok(confirmCall, 'a genuine halt is independently confirmed before acting')
  assert.ok(confirmCall.prompt.includes('planned module src/legacy.js does not exist'), 'confirmer is grounded with the RAW discovery issue text, not just the gate summary')
  assert.equal(result.validation, null)
  assert.equal(result.confirmedReviewFindings, 0)
  assert.equal(result.reviewStats, null, 'halted run never reviews — stats stay null')
  assert.ok(!trace.calls.some((c) => c.label === 'diffstat'), 'quality phase skipped')
  assert.ok(!trace.calls.some((c) => ['proof', 'ship', 'compound'].includes(c.label) || c.label.startsWith('ci-')), 'tail phases skipped on halt')
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /halted/)
  return 'stop-loss halt: partial work kept, tail skipped, hands back to human'
})

S('S7b triage proposes halt but independent confirmation overturns it; run continues', async () => {
  // Regression for the verdict/reasoning divergence observed live: a triage agent set
  // verdict:'halt' while its own reason prose argued for continue. The independent
  // confirmation must override the spurious halt so the remaining sound tasks still run.
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), issues: ['agents/codex-executor.md already exists on the branch'] }),
    'triage-wave-1': () => ({ verdict: 'halt', reason: 'Wait — re-reading my evidence this is a clear CONTINUE, not a halt; the file pre-existing is intended dependsOn sequencing. Correcting my verdict to continue.', evidence: ['intended dependsOn sequencing'] }),
    // triage-confirm-wave-1 intentionally NOT overridden — it falls through to the
    // default 'triage-' continue, modelling an independent confirmer that disagrees.
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.calls.some((c) => c.label === 'triage-confirm-wave-1'), 'a proposed halt is independently confirmed before acting')
  assert.equal(result.planInvalidation, null, 'overturned halt does not invalidate the plan')
  for (const id of ['U1', 'U2', 'U3', 'U4']) assert.equal(result.tasks[id].status, 'merged', `${id} merged — run continued past the spurious halt`)
  assert.ok(result.validation, 'quality/validate ran because the run continued')
  assert.equal(result.ship.pushed, true, 'continued run reaches ship')
  return 'spurious halt (enum/prose divergence) overturned by independent confirmation; run completes'
})

S('S7c triage proposes halt but confirmer dies (null); fail-open, run continues', async () => {
  // Dead-confirmer path: the coordinator guard is `if (confirm && confirm.verdict === 'halt')`.
  // When the confirmer returns null, the condition is falsy and the run must continue.
  const d = makeDispatcher({
    'exec-U1': () => ({ ...EXEC_OK('U1'), issues: ['planned module src/legacy.js does not exist'] }),
    'triage-wave-1': () => ({ verdict: 'halt', reason: 'U2/U3 extend a module that does not exist', evidence: ['src/legacy.js missing'] }),
    'triage-confirm-wave-1': () => { throw new Error('confirmer died') },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.calls.some((c) => c.label === 'triage-confirm-wave-1'), 'confirmer was dispatched before acting on halt')
  assert.equal(result.planInvalidation, null, 'dead confirmer does not invalidate the plan')
  for (const id of ['U1', 'U2', 'U3', 'U4']) assert.equal(result.tasks[id].status, 'merged', `${id} merged — run continued past the unconfirmed halt`)
  return 'dead confirmer (null) falls through; run completes fail-open'
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
      { title: 'off-by-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'index exceeds array length when input is empty' },
      { title: 'naming', file: 'src/u1.js', line: 12, severity: 'nit', detail: 'd', failure_scenario: 'cleanup cost: inconsistent naming hides duplicate helper intent' },
    ] }),
    'verify-correctness': () => ({ verdict: 'CONFIRMED', evidence: 'real' }),
    'fix-': () => ({ fixed: ['off-by-one'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'nit excluded, blocking confirmed')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.ok(fixes[0].prompt.includes('off-by-one') && !fixes[0].prompt.includes('naming'))
  const reviewCall = trace.calls.find((c) => c.label === 'review-correctness')
  assert.ok(reviewCall.prompt.includes('failure_scenario'), 'review prompt defines failure_scenario field')
  assert.ok(reviewCall.prompt.includes('independent verifier judges them next'), 'review prompt has pass-through instruction')
  const reviewFindingSchema = reviewCall.schema.properties.findings.items
  assert.ok(reviewFindingSchema.properties.failure_scenario, 'FINDINGS_SCHEMA includes failure_scenario property')
  assert.ok(reviewFindingSchema.required.includes('failure_scenario'), 'FINDINGS_SCHEMA requires failure_scenario')
  const verifyCall = trace.calls.find((c) => c.label.startsWith('verify-correctness'))
  assert.ok(verifyCall.prompt.includes('Failure scenario: index exceeds array length when input is empty'), 'verifier prompt includes finding failure_scenario')
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

S('S22 codex second-model reviewer: findings verified by claude verifier; ran=false logged', async () => {
  // (a) codex finds a blocking issue -> finding-verifier verifies -> fixer dispatched
  const finds = makeDispatcher({
    'review-codex': () => ({ ran: true, findings: [{ title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd', failure_scenario: 'concurrent writes without lock -> data corruption' }], detail: 'found 1' }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const a = await run(finds)
  assert.ifError(a.error)
  assert.equal(a.result.confirmedReviewFindings, 1)
  const verify = a.trace.calls.find((c) => c.label.startsWith('verify-codex-'))
  assert.equal(verify.agentType, 'finding-verifier', 'codex finding cross-verified by claude')
  assert.ok(verify.prompt.includes('concurrent writes without lock -> data corruption'), 'codex finding failure_scenario reaches verification')
  const codexSchema = a.trace.calls.find((c) => c.label === 'review-codex').schema
  assert.ok(codexSchema.properties.findings.items.properties.failure_scenario, 'CODEX_REVIEW_SCHEMA findings include failure_scenario through FINDINGS_SCHEMA')
  assert.ok(codexSchema.properties.findings.items.required.includes('failure_scenario'), 'CODEX_REVIEW_SCHEMA findings require failure_scenario through FINDINGS_SCHEMA')
  // (b) codex review fails to run -> logged with detail AND recorded as a
  // missing perspective: zero findings, surviving reviewers unaffected, but
  // the run is no longer pretending the codex perspective was covered
  const broken = makeDispatcher({ 'review-codex': () => ({ ran: false, findings: [], detail: 'codex binary crashed' }) })
  const b = await run(broken)
  assert.ifError(b.error)
  assert.ok(b.trace.logs.some((m) => /Codex second-model review did not run: codex binary crashed/.test(m)))
  assert.deepEqual(b.result.reviewDrops.reviewerDied, ['codex'], 'ran=false is a recorded coverage gap')
  assert.ok(b.trace.calls.find((c) => c.label === 'ship').prompt.includes('(COVERAGE GAP) reviewer codex'), 'and durable in the PR body')
  // (c) codex unavailable -> reviewer roster has no codex entry at all; an
  // excluded reviewer is NOT a dead one
  const off = makeDispatcher({}, { recon: { codexAvailable: false } })
  const c = await run(off)
  assert.ifError(c.error)
  assert.ok(!c.trace.calls.some((x) => x.label === 'review-codex'))
  assert.ok(c.trace.logs.some((m) => /Codex second-model review skipped/.test(m)))
  assert.deepEqual(c.result.reviewDrops.reviewerDied, [], 'roster exclusion never reports MISSING')
  return 'cross-model review verified, failure surfaced, absence logged'
})

S('S23 fixer-skipped finding becomes a residual and lands in the PR body', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'off-by-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'index exceeds array length when input is empty' }] }),
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
  assert.ok(call.prompt.includes('Dead code'), 'dead-code grep gate present in the prompt')
  const quality = trace.calls.find((c) => c.label === 'simplify')
  assert.ok(quality.prompt.includes('Dead code'), 'dead-code grep gate present in the quality pass too')
  return 'mid-run simplify hook gated correctly'
})

S('S29 simplify kept-dead-code candidates are durable: logged, in the ship PR body, and in the result', async () => {
  const d = makeDispatcher({
    'simplify-wave-': () => ({ changed: false, detail: 'nothing to simplify', kept: [] }),
    'simplify': () => ({ changed: true, detail: 'removed one helper', kept: ['lib/format.js:formatCents — still imported by bin/report.js'] }),
  }, { routeExecutor: () => 'claude' })
  const { trace, result, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.logs.some((l) => l.includes('dead-code candidate')), 'kept candidates are logged, never silent')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('formatCents'), 'kept candidate durable in the PR body residuals')
  assert.deepEqual(result.simplifyKept, ['quality: lib/format.js:formatCents — still imported by bin/report.js'])
  return 'kept dead-code candidates flow to logs, PR body, and result'
})

S('S27 cross-reviewer dedup: same file+title from two reviewers is one finding, one fix line', async () => {
  const finding = { title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'suggested', detail: 'd', failure_scenario: 'concurrent writes without lock -> data corruption' }
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [finding] }),
    'review-codex': () => ({ ran: true, findings: [{ ...finding, severity: 'blocking' }], detail: 'found 1' }),
    'verify-correctness': () => ({ verdict: 'PLAUSIBLE', evidence: 'consistent but unproven' }),
    'verify-codex': () => ({ verdict: 'CONFIRMED', evidence: 'quoted the offending line' }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'merged into one finding')
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 1, 'dedup precedes verification — one verifier for the merged pair')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.equal((fixes[0].prompt.match(/unchecked race/g) || []).length, 1, 'one line, not two')
  assert.ok(fixes[0].prompt.includes('blocking'), 'merged finding keeps the higher severity')
  assert.ok(fixes[0].prompt.includes('(blocking, PLAUSIBLE,'), 'verdict comes from the single verifier of the first-kept entry')
  assert.ok(fixes[0].prompt.includes('Verifier evidence: consistent but unproven'), 'verifier evidence reaches the fixer')
  assert.ok(fixes[0].prompt.includes('Failure scenario: concurrent writes without lock -> data corruption'), 'failure_scenario reaches the fixer')
  assert.ok(fixes[0].prompt.includes('correctness+codex') || fixes[0].prompt.includes('codex+correctness'), 'both personas credited')
  assert.deepEqual(result.residualReviewFindings, [], 'single fixed title accounts for the merged finding exactly once')
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 1, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 })
  // Two DISTINCT problems sharing a title at different lines must NOT collapse —
  // the second would otherwise be silently dropped before any fixer saw it.
  const d2 = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'unchecked race', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'race at line 4', failure_scenario: 'request A and B both increment counter from the same stale value' },
      { title: 'unchecked race', file: 'src/u1.js', line: 99, severity: 'blocking', detail: 'different race at line 99', failure_scenario: 'parallel cleanup runs both delete the same pending job' },
    ] }),
    'fix-': () => ({ fixed: ['unchecked race'], skipped: [], detail: 'ok' }),
  })
  const r2 = await run(d2)
  assert.ifError(r2.error)
  assert.equal(r2.result.confirmedReviewFindings, 2, 'distinct lines stay two findings')
  const fix2 = r2.trace.calls.find((c) => c.label.startsWith('fix-'))
  assert.ok(fix2.prompt.includes('race at line 4') && fix2.prompt.includes('different race at line 99'), 'both distinct details reach the fixer')
  return 'proximity dedup merges true dups, keeps distinct same-title findings'
})

S('S34 proximity dedup: same file lines 101/103 with different titles merge before verification', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'stale cache read', file: 'src/u1.js', line: 101, severity: 'blocking', detail: 'reads stale entry', failure_scenario: 'read after invalidation window returns stale row' }] }),
    'review-testing': () => ({ findings: [{ title: 'cache invalidation missing', file: 'src/u1.js', line: 103, severity: 'suggested', detail: 'no invalidation on update', failure_scenario: 'update skips invalidation so the next read is stale' }] }),
    'fix-': () => ({ fixed: ['stale cache read'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 1, 'one verifier for the proximity-merged pair')
  assert.equal(result.confirmedReviewFindings, 1, 'lines 101/103 in the same file are one defect')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.ok(fixes[0].prompt.includes('(blocking,'), 'merged finding keeps the blocking severity')
  assert.ok(fixes[0].prompt.includes('correctness+testing'), 'both personas credited')
  assert.deepEqual(result.residualReviewFindings, [])
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 1, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 })
  return 'different titles 2 lines apart merged; one verify; blocking kept'
})

S('S35 no over-merge: same title at lines 10 and 400 stays two findings', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'unchecked error', file: 'src/u1.js', line: 10, severity: 'suggested', detail: 'first site swallows the error', failure_scenario: 'io error swallowed at read' }] }),
    'review-testing': () => ({ findings: [{ title: 'unchecked error', file: 'src/u1.js', line: 400, severity: 'suggested', detail: 'second site swallows the error', failure_scenario: 'io error swallowed at write' }] }),
    'fix-': () => ({ fixed: ['unchecked error'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 2, 'distinct defects each get a verifier')
  assert.equal(result.confirmedReviewFindings, 2, '|10-400| > 5 keeps them distinct despite the shared title')
  const fix = trace.calls.find((c) => c.label.startsWith('fix-'))
  assert.ok(fix.prompt.includes('first site swallows the error') && fix.prompt.includes('second site swallows the error'), 'both details reach the fixer')
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 2, refuted: 0, dupes: 0, budgetDropped: 0, verifierFailed: 0 })
  return 'titles are irrelevant when both lines are positive and far apart'
})

S('S36 line-less dedup: 30-char normalized-title prefix merges; different title stays distinct', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'Missing input validation on user payload!!', file: 'src/u1.js', line: 0, severity: 'suggested', detail: 'no validation', failure_scenario: 'malformed payload reaches the handler' }] }),
    'review-testing': () => ({ findings: [
      { title: 'missing   input validation on user payload causes crash', file: 'src/u1.js', line: 12, severity: 'suggested', detail: 'same defect, located', failure_scenario: 'malformed payload crashes the handler' },
      { title: 'unrelated schema drift', file: 'src/u1.js', line: 0, severity: 'suggested', detail: 'different defect', failure_scenario: 'old column still referenced' },
    ] }),
    'fix-': () => ({ fixed: ['Missing input validation on user payload!!', 'unrelated schema drift'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 2, 'merged pair verified once; distinct title verified separately')
  assert.equal(result.confirmedReviewFindings, 2)
  assert.deepEqual(result.reviewStats, { candidates: 3, verified: 2, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 })
  return 'line-0 finding merges on normalized title prefix, not with a different-title one'
})

S('S37 verify budget: 30 suggested findings -> 25 verified, 5 dropped with logged identities', async () => {
  const findings = Array.from({ length: 30 }, (_, i) => ({ title: `finding-${i + 1}`, file: `src/f${i + 1}.js`, line: 10, severity: 'suggested', detail: `detail ${i + 1}`, failure_scenario: `bad input ${i + 1} produces wrong output` }))
  const d = makeDispatcher({
    'review-correctness': () => ({ findings }),
    'fix-': () => ({ fixed: findings.map((f) => f.title), skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 25, 'verifier spawns capped at MAX_VERIFY')
  assert.equal(result.confirmedReviewFindings, 25, 'budget-dropped findings are not confirmed')
  assert.equal(result.reviewStats.budgetDropped, 5)
  assert.deepEqual(result.reviewStats, { candidates: 30, verified: 25, refuted: 0, dupes: 0, budgetDropped: 5, verifierFailed: 0 })
  for (let i = 26; i <= 30; i++) {
    assert.ok(trace.logs.some((m) => m.includes(`src/f${i}.js:10 — finding-${i}`)), `dropped finding-${i} identity logged`)
  }
  // Scoped to the findings-to-fix section: the fix-batch grounding history may
  // legitimately echo prior batches' self-reported titles above it.
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-') && c.prompt.split('The findings to fix now:').pop().includes('finding-26')), 'dropped finding never reaches a fixer')
  assert.deepEqual(result.residualReviewFindings, [], 'dropped findings are not residuals — logs and stats only')
  return 'cap enforced with per-drop identity logs; no silent truncation'
})

S('S38 blocking exemption: slots exhausted, later blocking finding still gets a verifier', async () => {
  const suggested = Array.from({ length: 25 }, (_, i) => ({ title: `finding-${i + 1}`, file: `src/f${i + 1}.js`, line: 10, severity: 'suggested', detail: `detail ${i + 1}`, failure_scenario: `bad input ${i + 1} produces wrong output` }))
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: suggested }),
    'review-testing': () => ({ findings: [{ title: 'corrupted write path', file: 'src/blocker.js', line: 5, severity: 'blocking', detail: 'writes garbage', failure_scenario: 'concurrent flush corrupts the row' }] }),
    'fix-': () => ({ fixed: [...suggested.map((f) => f.title), 'corrupted write path'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 26, 'blocking finding bypasses the exhausted suggested-severity budget')
  assert.equal(result.confirmedReviewFindings, 26)
  assert.deepEqual(result.reviewStats, { candidates: 26, verified: 26, refuted: 0, dupes: 0, budgetDropped: 0, verifierFailed: 0 })
  return '25 suggested fill the slots; the blocking finding still verifies (26 spawns)'
})

S('S39 budget-dropped finding escalated to blocking by a later duplicate gets verified late', async () => {
  const suggested = Array.from({ length: 26 }, (_, i) => ({ title: `finding-${i + 1}`, file: `src/f${i + 1}.js`, line: 10, severity: 'suggested', detail: `detail ${i + 1}`, failure_scenario: `bad input ${i + 1} produces wrong output` }))
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: suggested }),
    'review-testing': () => ({ findings: [{ title: 'same defect, different words', file: 'src/f26.js', line: 12, severity: 'blocking', detail: 'escalates the dropped one', failure_scenario: 'bad input 26 corrupts state' }] }),
    'fix-': () => ({ fixed: suggested.map((f) => f.title), skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.equal(verifies.length, 26, '25 budget spawns + 1 late spawn for the escalated entry')
  assert.equal(result.confirmedReviewFindings, 26, 'escalated entry rejoins the confirmed set')
  assert.deepEqual(result.reviewStats, { candidates: 27, verified: 26, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 }, 'late-verified entry leaves the budgetDropped bucket')
  // Scoped to the findings-to-fix section — the batch grounding history echoes
  // prior batches' self-reported titles, so the whole prompt is ambiguous.
  const fix26 = trace.calls.find((c) => c.label.startsWith('fix-') && c.prompt.split('The findings to fix now:').pop().includes('finding-26'))
  assert.ok(fix26 && fix26.prompt.includes('(blocking,') && fix26.prompt.includes('correctness+testing'), 'escalated entry reaches the fixer as blocking with both personas')
  return 'blocking duplicate revives a budget-dropped entry: verifier spawned, stats rebalanced'
})

S('S40 sweep gate: diff under 50 lines skips the sweep with a log', async () => {
  const d = makeDispatcher({ diffstat: () => ({ lines: 40 }) })
  const { trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(!trace.calls.some((c) => c.label === 'sweep'), 'no sweep call under the 50-line gate')
  assert.ok(trace.logs.some((m) => /Sweep skipped: diff is 40 lines \(<50\)/.test(m)), 'gate skip logged — no silent cap')
  return '40-line diff: simplify still runs, sweep skipped with a log'
})

S('S41 sweep candidate at a new location is verified and joins the fix set, after reviewer verification and before fixes', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'reviewer-found', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'empty input indexes past the array end' }] }),
    sweep: () => ({ findings: [{ title: 'dropped guard in extracted helper', file: 'src/u2.js', line: 30, severity: 'blocking', detail: 'extracted helper lost the null check', failure_scenario: 'null payload reaches the helper and crashes the handler' }] }),
    'fix-': () => ({ fixed: ['reviewer-found', 'dropped guard in extracted helper'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const sweepIdx = trace.calls.findIndex((c) => c.label === 'sweep')
  assert.ok(sweepIdx >= 0, 'sweep dispatched (120-line diff opens the gate)')
  const reviewerVerifyIdxs = trace.calls.map((c, i) => (c.label.startsWith('verify-') && !c.label.startsWith('verify-sweep') ? i : -1)).filter((i) => i >= 0)
  assert.ok(reviewerVerifyIdxs.length >= 1 && reviewerVerifyIdxs.every((i) => i < sweepIdx), 'sweep runs after reviewer verification settles')
  const firstFixIdx = trace.calls.findIndex((c) => c.label.startsWith('fix-'))
  assert.ok(firstFixIdx > sweepIdx, 'sweep runs before fix batching')
  const verifySweep = trace.calls.find((c) => c.label.startsWith('verify-sweep-'))
  assert.ok(verifySweep, 'sweep survivor verified')
  assert.equal(verifySweep.agentType, 'finding-verifier', 'sweep candidates face the same verifier')
  assert.ok(verifySweep.prompt.includes('null payload reaches the helper'), 'sweep failure_scenario reaches verification')
  const fixU2 = trace.calls.find((c) => c.label === 'fix-u2.js')
  assert.ok(fixU2 && fixU2.prompt.includes('dropped guard in extracted helper'), 'confirmed sweep candidate joins the fix set')
  assert.ok(fixU2.prompt.includes('CONFIRMED'), 'sweep survivor carries its verdict into the fix prompt')
  assert.equal(result.confirmedReviewFindings, 2, 'reviewer finding + sweep survivor both confirmed')
  assert.ok(trace.logs.some((m) => /Sweep: 1 new candidate\(s\), 1 survived verification/.test(m)), 'sweep outcome logged')
  return 'sweep ordered after verification, before fixes; survivor fixed in the same pass'
})

S('S42 sweep candidate in the same proximity bucket as a verified finding merges, no verifier spawned', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'reviewer-found', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'empty input indexes past the array end' }] }),
    sweep: () => ({ findings: [{ title: 'same defect re-spotted', file: 'src/u1.js', line: 12, severity: 'suggested', detail: 'd', failure_scenario: 'empty input still indexes past the end' }] }),
    'fix-': () => ({ fixed: ['reviewer-found'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(!trace.calls.some((c) => c.label.startsWith('verify-sweep-')), 'duplicate sweep candidate spawns NO verifier')
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 1, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 }, 'sweep duplicate counted in dupes')
  const fix = trace.calls.find((c) => c.label.startsWith('fix-'))
  assert.ok(fix.prompt.includes('correctness+sweep'), 'sweep credited on the merged finding')
  assert.ok(trace.logs.some((m) => /Sweep: 0 new candidate\(s\), 0 survived verification/.test(m)), 'dupe-only sweep yields zero new candidates')
  return 'proximity dedup absorbs the sweep duplicate; one finding, one verifier total'
})

S('S43 sweep prompt grounding: verified-findings list, gap-focus text, cap, no agentType', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'reviewer-found', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'empty input indexes past the array end' }] }),
    'fix-': () => ({ fixed: ['reviewer-found'], skipped: [], detail: 'ok' }),
  })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const sweepCall = trace.calls.find((c) => c.label === 'sweep')
  assert.ok(sweepCall, 'sweep dispatched')
  assert.equal(sweepCall.agentType, undefined, 'sweep is an inline-prompt agent, no agentType')
  assert.ok(sweepCall.prompt.includes('src/u1.js:10 — reviewer-found'), 'verified findings rendered as file:line — title')
  assert.ok(sweepCall.prompt.includes('do NOT re-derive or re-confirm these'), 'verified list carries the exclusion instruction')
  assert.ok(sweepCall.prompt.includes('setup/teardown asymmetry'), 'gap-focus list present')
  assert.ok(sweepCall.prompt.includes('config defaults flipped'), 'gap-focus list complete')
  assert.ok(sweepCall.prompt.includes('at most 8'), 'candidate cap stated')
  assert.ok(sweepCall.prompt.includes('return an empty list — do not pad'), 'no-padding instruction present')
  assert.ok(sweepCall.prompt.includes('failure_scenario'), 'failure_scenario requirement stated')
  assert.ok(sweepCall.prompt.includes('/repo/.worktrees/test-plan') && sweepCall.prompt.includes('docs/plans/test.md'), 'worktree and plan paths grounded')
  assert.ok(sweepCall.schema && sweepCall.schema.properties.findings, 'sweep uses FINDINGS_SCHEMA')
  return 'sweep prompt fully grounded; inline persona'
})

S('S44 exhausted verify budget: suggested sweep candidate lands in budgetDropped, no verifier', async () => {
  const findings = Array.from({ length: 25 }, (_, i) => ({ title: `finding-${i + 1}`, file: `src/f${i + 1}.js`, line: 10, severity: 'suggested', detail: `detail ${i + 1}`, failure_scenario: `bad input ${i + 1} produces wrong output` }))
  const d = makeDispatcher({
    'review-correctness': () => ({ findings }),
    sweep: () => ({ findings: [{ title: 'late sweep find', file: 'src/sweep.js', line: 7, severity: 'suggested', detail: 'd', failure_scenario: 'stale config default flips behavior on restart' }] }),
    'fix-': () => ({ fixed: findings.map((f) => f.title), skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(!trace.calls.some((c) => c.label.startsWith('verify-sweep-')), 'budget-dropped sweep candidate spawns no verifier')
  assert.deepEqual(result.reviewStats, { candidates: 26, verified: 25, refuted: 0, dupes: 0, budgetDropped: 1, verifierFailed: 0 }, 'sweep drop visible in reviewStats')
  assert.ok(trace.logs.some((m) => m.includes('src/sweep.js:7 — late sweep find')), 'dropped sweep candidate identity logged')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-') && c.prompt.includes('late sweep find')), 'dropped candidate never reaches a fixer')
  return 'sweep respects the shared verify budget; drop is logged, never silent'
})

S('S45 sweep over-cap: 10 candidates -> first 8 processed, the 2 dropped logged with identities', async () => {
  const sweepFindings = Array.from({ length: 10 }, (_, i) => ({ title: `gap-${i + 1}`, file: `src/g${i + 1}.js`, line: 5, severity: 'suggested', detail: `d${i + 1}`, failure_scenario: `gap ${i + 1} trigger` }))
  const d = makeDispatcher({
    sweep: () => ({ findings: sweepFindings }),
    'fix-': (p, o, label) => ({ fixed: sweepFindings.map((f) => f.title).filter((t) => p.includes(t)), skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const sweepVerifies = trace.calls.filter((c) => c.label.startsWith('verify-sweep-'))
  assert.equal(sweepVerifies.length, 8, 'only the first 8 sweep candidates reach verification')
  assert.equal(result.reviewStats.candidates, 8, 'over-cap candidates never enter processFindings')
  assert.ok(trace.logs.some((m) => m.includes('src/g9.js:5 — gap-9') && m.includes('src/g10.js:5 — gap-10')), 'dropped candidates logged with file:line — title identities')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-') && c.prompt.includes('gap-9')), 'dropped candidate never reaches a fixer')
  return '10 sweep candidates -> 8 kept, 2 dropped with logged identities'
})

S('S46 sweep agent dies: failure logged, confirmed findings and stats unaffected', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'reviewer-found', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'empty input indexes past the array end' }] }),
    sweep: () => { throw new Error('sweep died') },
    'fix-': () => ({ fixed: ['reviewer-found'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.logs.some((m) => /Sweep agent failed — no gap candidates collected/.test(m)), 'dead sweep logged')
  assert.equal(result.confirmedReviewFindings, 1, 'reviewer finding unaffected by the dead sweep')
  assert.deepEqual(result.reviewStats, { candidates: 1, verified: 1, refuted: 0, dupes: 0, budgetDropped: 0, verifierFailed: 0 })
  assert.ok(result.validation.testsPass, 'run continues to validation')
  return 'dead sweep does not crash Quality; fixes and validation proceed'
})

S('S47 fixer-skipped title matching no finding -> residual with sentinel verdict UNKNOWN', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'real-finding', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'null input crashes the handler' }] }),
    'fix-': () => ({ fixed: ['real-finding'], skipped: [{ title: 'never-reported', reason: 'phantom skip' }], detail: 'ok' }),
  })
  const { result, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.residualReviewFindings.length, 1)
  const r = result.residualReviewFindings[0]
  assert.equal(r.title, 'never-reported')
  assert.equal(r.verdict, 'UNKNOWN', 'no verifier graded this title — sentinel, not a fabricated PLAUSIBLE')
  assert.equal(r.file, 'src/u1.js')
  assert.equal(r.reason, 'phantom skip')
  return 'unmatched skip title -> UNKNOWN-verdict residual; no invented verifier grade'
})

S('S48 blocking sweep duplicate of a REFUTED finding revives it: re-verified with the merged write-up', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'weak write-up of the defect', file: 'src/u1.js', line: 10, severity: 'suggested', detail: 'vague claim', failure_scenario: 'vague trigger' }] }),
    'verify-correctness': () => ({ verdict: 'REFUTED', evidence: 'could not reproduce from the weak wording' }),
    sweep: () => ({ findings: [{ title: 'same defect, sharper', file: 'src/u1.js', line: 12, severity: 'blocking', detail: 'sharp claim', failure_scenario: 'concrete trigger: empty queue double-pop' }] }),
    'verify-sweep': () => ({ verdict: 'CONFIRMED', evidence: 'quoted the offending line' }),
    'fix-': () => ({ fixed: ['weak write-up of the defect'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  // the refuted first-pass finding appears labeled in the sweep exclusion list
  const sweepCall = trace.calls.find((c) => c.label === 'sweep')
  assert.ok(sweepCall.prompt.includes('src/u1.js:10 — weak write-up of the defect') && sweepCall.prompt.includes('refuted'), 'refuted finding excluded-with-label in the sweep prompt')
  // absorption is logged, and the blocking duplicate revives the refuted entry
  assert.ok(trace.logs.some((m) => m.includes('Duplicate finding absorbed') && m.includes('same defect, sharper')), 'absorbed duplicate identity logged')
  const reverify = trace.calls.find((c) => c.label.startsWith('verify-sweep-'))
  assert.ok(reverify, 'refuted entry re-verified on blocking escalation')
  assert.ok(reverify.prompt.includes('concrete trigger: empty queue double-pop'), 'duplicate failure_scenario reaches the re-verifier')
  assert.equal(result.confirmedReviewFindings, 1, 'revived entry rejoins the confirmed set')
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 1, refuted: 0, dupes: 1, budgetDropped: 0, verifierFailed: 0 }, 'revived entry leaves the refuted bucket')
  const fix = trace.calls.find((c) => c.label.startsWith('fix-'))
  assert.ok(fix.prompt.includes('sharp claim'), 'absorbed detail reaches the fixer')
  assert.deepEqual(result.residualReviewFindings, [])
  return 'REFUTED + blocking duplicate -> logged, re-verified with merged evidence, fixed'
})

S('S29 verdict ladder: REFUTED filtered out, PLAUSIBLE reaches fixer with verdict-conditional policy', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'plausible-leak', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'connection may leak', failure_scenario: 'connection opened before validation remains open after validation fails' },
      { title: 'refuted-race', file: 'src/u1.js', line: 20, severity: 'blocking', detail: 'race on init', failure_scenario: 'two initializers run concurrently and both mutate global state' },
    ] }),
    'verify-correctness': (prompt) => (prompt.includes('plausible-leak')
      ? { verdict: 'PLAUSIBLE', evidence: 'consistent with the code, trigger not constructed' }
      : { verdict: 'REFUTED', evidence: 'guard on line 18 prevents it' }),
    'fix-': () => ({ fixed: ['plausible-leak'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'only the non-REFUTED finding survives')
  const fixes = trace.calls.filter((c) => c.label.startsWith('fix-'))
  assert.equal(fixes.length, 1)
  assert.ok(fixes[0].prompt.includes('plausible-leak'), 'PLAUSIBLE finding reaches the fixer')
  assert.ok(fixes[0].prompt.includes('(blocking, PLAUSIBLE,'), 'fix prompt carries the finding verdict')
  assert.ok(fixes[0].prompt.includes('local and behavior-preserving'), 'verdict-conditional fix policy present')
  assert.ok(!fixes[0].prompt.includes('refuted-race'), 'REFUTED finding never reaches a fixer')
  assert.deepEqual(result.residualReviewFindings, [], 'REFUTED finding leaves no residual either')
  assert.deepEqual(result.reviewStats, { candidates: 2, verified: 1, refuted: 1, dupes: 0, budgetDropped: 0, verifierFailed: 0 }, 'refuted finding counted in stats')
  // a dead verifier still drops the finding (fail if uncertain) but is counted
  // as an infra failure, never as a code-based refutation
  const dead = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'unverifiable', file: 'src/u1.js', line: 10, severity: 'suggested', detail: 'd', failure_scenario: 'claimed leak on early return' }] }),
    'verify-correctness': () => { throw new Error('verifier died') },
  })
  const b = await run(dead)
  assert.ifError(b.error)
  assert.equal(b.result.confirmedReviewFindings, 0, 'dead verifier confirms nothing')
  assert.equal(b.result.reviewStats.refuted, 0, 'a crashed verifier is NOT a refutation')
  assert.equal(b.result.reviewStats.verifierFailed, 1, 'crash counted in its own bucket')
  assert.ok(b.trace.logs.some((m) => m.includes('Verifier agent died for src/u1.js:10 — unverifiable')), 'dead verifier logged with the finding identity')
  return 'three-state ladder filters REFUTED only; fixer sees verdicts and the conditional policy'
})

S('S30 REFUTED finding never becomes a residual, even when the fixer dies', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'real-issue', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'null user input reaches required field access' },
      { title: 'phantom-issue', file: 'src/u1.js', line: 20, severity: 'blocking', detail: 'd', failure_scenario: 'claimed invariant violation when cached config is missing' },
    ] }),
    'verify-correctness': (prompt) => (prompt.includes('phantom-issue')
      ? { verdict: 'REFUTED', evidence: 'invariant prevents it' }
      : { verdict: 'CONFIRMED', evidence: 'quoted the offending line' }),
    'fix-': () => { throw new Error('fixer died') },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.residualReviewFindings.length, 1, 'only the confirmed finding becomes a residual')
  assert.equal(result.residualReviewFindings[0].title, 'real-issue')
  assert.equal(result.residualReviewFindings[0].verdict, 'CONFIRMED', 'residual carries the verdict')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('fix-') && c.prompt.includes('phantom-issue')), 'REFUTED finding in no fix prompt')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('(blocking, CONFIRMED) src/u1.js'), 'PR-body residual line carries the verdict')
  assert.ok(!shipCall.prompt.includes('phantom-issue'), 'REFUTED finding never reaches the PR body')
  return 'REFUTED findings are dropped before fixers and residuals; residual lines carry verdicts'
})

S('S31 skipped PLAUSIBLE finding produces a residual carrying verdict PLAUSIBLE', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'maybe-leak', file: 'src/u1.js', line: 10, severity: 'suggested', detail: 'd', failure_scenario: 'connection opened before early return is never closed' }] }),
    'verify-correctness': () => ({ verdict: 'PLAUSIBLE', evidence: 'could not construct the trigger' }),
    'fix-': () => ({ fixed: [], skipped: [{ title: 'maybe-leak', reason: 'fix is not local' }], detail: '' }),
  })
  const { result, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.residualReviewFindings.length, 1)
  assert.equal(result.residualReviewFindings[0].verdict, 'PLAUSIBLE', 'skipped residual keeps its verdict')
  assert.equal(result.residualReviewFindings[0].reason, 'fix is not local')
  return 'skipped PLAUSIBLE finding -> residual with verdict PLAUSIBLE'
})

S('S32 verify- calls dispatch the finding-verifier persona', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 't1', file: 'src/u1.js', line: 1, severity: 'blocking', detail: 'd', failure_scenario: 'missing required input produces undefined output' }] }),
    'fix-': () => ({ fixed: ['t1'], skipped: [], detail: 'ok' }),
  })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-'))
  assert.ok(verifies.length >= 1, 'at least one verification dispatched')
  for (const v of verifies) assert.equal(v.agentType, 'finding-verifier', `${v.label} uses finding-verifier`)
  return `${verifies.length} verify call(s), all finding-verifier`
})

S('S33 codex-reviewer doc requires and prompts for failure_scenario', async () => {
  assert.ok(codexReviewerSrc.includes('"failure_scenario":{"type":"string"}'), 'codex reviewer schema defines failure_scenario')
  assert.ok(codexReviewerSrc.includes('"required":["title","file","line","severity","detail","failure_scenario"]'), 'codex reviewer schema requires failure_scenario')
  assert.ok(codexReviewerSrc.includes('failure_scenario (the concrete inputs/state that produce the wrong outcome'), 'codex reviewer prompt defines failure_scenario')
  assert.ok(codexReviewerSrc.includes('independent verifier judges them next'), 'codex reviewer prompt has pass-through instruction')
  return 'codex-reviewer schema and prompt mention failure_scenario'
})

S('S31 nit cap is loud: deferred nits are logged, listed in the result, and never verified', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'real bug', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd' },
      { title: 'rename for clarity', file: 'src/u1.js', line: 9, severity: 'nit', detail: 'd' },
      { title: 'comment typo', file: 'src/u2.js', line: 2, severity: 'nit', detail: 'd' },
    ] }),
    'fix-': () => ({ fixed: ['real bug'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.logs.some((l) => l.includes('2 nit finding(s) not sent to verification')), 'cap is logged with the dropped count')
  assert.deepEqual(result.nitsDeferred, [
    '(correctness) src/u1.js:9 — rename for clarity',
    '(correctness) src/u2.js:2 — comment typo',
  ])
  const verifies = trace.calls.filter((c) => c.label.startsWith('verify-correctness'))
  assert.equal(verifies.length, 1, 'only the non-nit finding is verified')
  assert.ok(!verifies[0].prompt.includes('rename for clarity'), 'a nit never reaches a refuter')
  assert.equal(result.confirmedReviewFindings, 1, 'nits never enter confirmed accounting')
  assert.deepEqual(result.residualReviewFindings, [], 'nits never become residuals')
  return 'nit cost cap is explicit: logged + result, zero refuter spawns for nits'
})

S('S32 verification drops are loud and distinguishable: refuted-with-evidence vs refuter death', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'real bug', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd', failure_scenario: 'empty input crashes the handler' },
      // line 30: outside the ±5 proximity-dedup window of line 4, so it stays a distinct finding
      { title: 'phantom bug', file: 'src/u1.js', line: 30, severity: 'suggested', detail: 'd', failure_scenario: 'claimed overflow on large input' },
      { title: 'unverifiable bug', file: 'src/u2.js', line: 2, severity: 'blocking', detail: 'd', failure_scenario: 'stale cache read on cold start' },
    ] }),
    'verify-correctness-u1.js': (p) => p.includes('phantom bug')
      ? { verdict: 'REFUTED', evidence: 'cannot occur: the guard on line 8\nprevents it' }
      : { verdict: 'CONFIRMED', evidence: 'confirmed' },
    'verify-correctness-u2.js': () => { throw new Error('refuter died') },
    'fix-': () => ({ fixed: ['real bug'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.confirmedReviewFindings, 1, 'only the confirmed finding survives')
  assert.deepEqual(result.reviewDrops.refuted,
    ['(correctness) src/u1.js:30 — phantom bug: cannot occur: the guard on line 8 prevents it'],
    'refuted drop carries the refuter evidence, newline-flattened')
  assert.deepEqual(result.reviewDrops.verifierDied,
    ['(correctness, blocking) src/u2.js:2 — unverifiable bug'],
    'a dead refuter drops the finding fail-closed but distinguishably, with severity')
  assert.ok(trace.logs.some((l) => l.includes('1 refuted with evidence') && l.includes('1 dropped UNVERIFIED — refuter produced no verdict (died or skipped)')),
    'both drop classes appear in the confirmed-count log line')
  assert.deepEqual(result.residualReviewFindings, [], 'drops never leak into residual accounting')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('(UNVERIFIED) (correctness, blocking) src/u2.js:2 — unverifiable bug'),
    'UNVERIFIED drops are durable in the PR-body residuals')
  assert.ok(!shipCall.prompt.includes('phantom bug'),
    'refuted-with-evidence drops stay out of the PR body — they were judged not real')
  return 'verification stage cannot drop a finding silently in either direction'
})

S('S33 a dead reviewer is a loud coverage gap, never a clean review', async () => {
  const d = makeDispatcher({
    'review-standards': () => { throw new Error('reviewer died') },
    'review-correctness': () => ({ findings: [
      { title: 'real bug', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd' },
    ] }),
    'fix-': () => ({ fixed: ['real bug'], skipped: [], detail: 'ok' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.deepEqual(result.reviewDrops.reviewerDied, ['standards'], 'the dead reviewer is named in the result')
  assert.ok(trace.logs.some((l) => l.includes('Reviewer standards produced no result')), 'death is logged when it happens')
  assert.ok(trace.logs.some((l) => l.includes("1 reviewer perspective(s) MISSING (standards)")), 'and counted in the summary log')
  assert.equal(result.confirmedReviewFindings, 1, 'surviving reviewers still flow through verification to fixing')
  assert.deepEqual(result.residualReviewFindings, [], 'a dead reviewer never leaks into finding-style residuals')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('(COVERAGE GAP) reviewer standards produced no result'),
    'the missing perspective is durable in the PR-body residuals')
  return 'a lost reviewer perspective is logged, returned, and durable in the PR body'
})

S('S34 sequential fixers are grounded with prior batch outcomes; the first is not', async () => {
  const findings = () => ({ findings: [
    { title: 'bug one', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd' },
    { title: 'bug two', file: 'src/u2.js', line: 8, severity: 'suggested', detail: 'd' },
  ] })
  const d = makeDispatcher({
    'review-correctness': findings,
    'fix-u1.js': () => ({ fixed: ['bug one'], skipped: [], detail: 'ok' }),
    'fix-u2.js': () => ({ fixed: ['bug two'], skipped: [], detail: 'ok' }),
  })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const fix1 = trace.calls.find((c) => c.label === 'fix-u1.js')
  const fix2 = trace.calls.find((c) => c.label === 'fix-u2.js')
  assert.ok(!fix1.prompt.includes('Outcomes of earlier fix batches'), 'first batch has no history block')
  assert.ok(fix1.prompt.includes('The findings to fix now:'), 'findings list is headed in both branches')
  assert.ok(fix2.prompt.includes('Outcomes of earlier fix batches') && fix2.prompt.includes('src/u1.js: fixed [bug one]'),
    'second batch grounded with the first batch outcome')
  assert.ok(fix2.prompt.includes('verify\nagainst git log') && fix2.prompt.includes('Do not undo or\nrework'),
    'history is framed as fixer self-report to verify, with the no-undo instruction')
  assert.ok(fix2.prompt.indexOf('The findings to fix now:') > fix2.prompt.indexOf('src/u1.js: fixed'),
    'history list and findings list are separated by the header')
  // A dead fixer is named honestly in the next batch's brief, not papered over.
  const d2 = makeDispatcher({
    'review-correctness': findings,
    'fix-u1.js': () => { throw new Error('fixer died') },
    'fix-u2.js': () => ({ fixed: ['bug two'], skipped: [], detail: 'ok' }),
  })
  const r2 = await run(d2)
  assert.ifError(r2.error)
  const fix2b = r2.trace.calls.find((c) => c.label === 'fix-u2.js')
  assert.ok(fix2b.prompt.includes('src/u1.js: fixer agent died — findings became residuals; whether it committed is unverified, check git log'),
    'a dead prior batch is reported as dead with honest commit-state uncertainty')
  return 'contextless sequential fixers are grounded with prior batch outcomes'
})

S('S26 tail budget floor: waves finish but Proof/Ship/Compound are skipped with logs', async () => {
  // Single unit; diffstat lowered so reviewer roster is fixed at 8 (no adversarial).
  // Call ledger at 10k/call: parse+recon(2) setup(3) split(4) route(5) exec(6) merge(7)
  // diffstat(8) reviews x8 (16) final-validation(17) = 170k spent entering the tail.
  // budgetTotal 195k -> remaining 25k <= 30k floor at Proof: tail must skip, not throw.
  const d = makeDispatcher({ diffstat: () => ({ lines: 10 }) }, { units: { units: [UNITS().units[0]] } })
  const { result, trace, error } = await run(d, { budgetTotal: 195000 })
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

S('S57 fix-claim audit: unsupported "fixed" claim demoted to a residual; supported claim stays fixed', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [
      { title: 'bug-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd1', failure_scenario: 'empty input crashes the handler' },
      { title: 'bug-two', file: 'src/u1.js', line: 40, severity: 'blocking', detail: 'd2', failure_scenario: 'overflow on large input' },
    ] }),
    'fix-': () => ({ fixed: ['bug-one', 'bug-two'], skipped: [], detail: 'ok' }),
    'audit-fixes': () => ({ unsupported: [{ title: 'bug-two', file: 'src/u1.js', evidence: 'no commit touches the overflow path' }], detail: 'checked both claims' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  const audit = trace.calls.find((c) => c.label === 'audit-fixes')
  assert.ok(audit, 'audit dispatched when fixers claim fixes')
  assert.ok(audit.prompt.includes('bug-one') && audit.prompt.includes('bug-two'), 'audit grounded with every claim')
  assert.ok(audit.prompt.includes('THIS session'), 'audit judges only from session-observed commits')
  assert.equal(result.residualReviewFindings.length, 1)
  const r = result.residualReviewFindings[0]
  assert.equal(r.title, 'bug-two')
  assert.equal(r.verdict, 'CONFIRMED', 'demoted claim keeps its verifier verdict')
  assert.match(r.reason, /audit found no supporting commit/)
  assert.deepEqual(result.fixAudit, { claimed: 2, unsupported: ['src/u1.js — bug-two'], unaudited: [] })
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('bug-two') && shipCall.prompt.includes('audit found no supporting commit'), 'demoted claim durable in the PR body')
  assert.ok(!shipCall.prompt.includes('(UNAUDITED)'), 'a completed audit leaves no UNAUDITED line')
  return 'fixer self-report audited against commits; unbacked claim becomes a residual'
})

S('S58 fix-claim audit agent dies: claims stand UNAUDITED and durable, never fabricated as residuals', async () => {
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'bug-one', file: 'src/u1.js', line: 10, severity: 'blocking', detail: 'd', failure_scenario: 'empty input crashes the handler' }] }),
    'fix-': () => ({ fixed: ['bug-one'], skipped: [], detail: 'ok' }),
    'audit-fixes': () => { throw new Error('auditor died') },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.deepEqual(result.residualReviewFindings, [], 'a dead auditor does not fabricate per-finding residuals')
  assert.deepEqual(result.fixAudit, { claimed: 1, unsupported: [], unaudited: ['src/u1.js — bug-one'] })
  assert.ok(trace.logs.some((m) => /UNAUDITED/.test(m)), 'death logged loudly')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('(UNAUDITED) 1 review-fix claim'), 'unaudited claims durable in the PR body')
  return 'dead audit -> aggregate UNAUDITED residual line; claims not silently trusted'
})

S('S59 independent ship gate: recheck contradicting green validation blocks the push', async () => {
  const d = makeDispatcher({
    'gate-recheck': () => ({ testsPass: false, lintPasses: true, evidence: 'npm test exit 1: 2 failing' }),
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /recheck contradicted validation \(tests failing\)/)
  assert.ok(!trace.calls.some((c) => c.label === 'ship'), 'ship agent never dispatched on a contradicted gate')
  assert.ok(!trace.calls.some((c) => c.label.startsWith('ci-')), 'no CI watch without a push')
  assert.deepEqual(result.shipGate, { testsPass: false, lintPasses: true, evidence: 'npm test exit 1: 2 failing' })
  const gate = trace.calls.find((c) => c.label === 'gate-recheck')
  assert.ok(gate.prompt.includes('npm test') && gate.prompt.includes('npm run lint'), 'recheck grounded with both commands')
  assert.ok(gate.prompt.includes('THIS session'), 'recheck reports only session-observed exit codes')
  return 'self-reported green is not enough: a fresh-context recheck gates the irreversible push'
})

S('S60 ship gate recheck agent dies: fail closed, branch left unpushed', async () => {
  const d = makeDispatcher({ 'gate-recheck': () => { throw new Error('recheck died') } })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ship.pushed, false)
  assert.match(result.ship.detail, /failing closed/)
  assert.ok(!trace.calls.some((c) => c.label === 'ship'), 'no push on an unobserved gate')
  assert.equal(result.shipGate, null)
  return 'a dead recheck cannot ship'
})

S('S61 ship-verify: observed git/gh state overrides the ship self-report in both directions', async () => {
  // (a) claimed pushed+PR, observed unpushed -> CI never watches a phantom PR
  const a = await run(makeDispatcher({
    'ship-verify': () => ({ pushed: false, prUrl: '', evidence: 'ahead 1; no PR exists' }),
  }))
  assert.ifError(a.error)
  assert.equal(a.result.ship.pushed, false, 'observed unpushed wins over claimed pushed')
  assert.equal(a.result.ship.prUrl, '')
  assert.equal(a.result.ship.verified, true)
  assert.match(a.result.ship.detail, /corrected by ship-verify/)
  assert.ok(a.trace.logs.some((m) => /Ship-verify contradicted/.test(m)))
  assert.ok(!a.trace.calls.some((c) => c.label.startsWith('ci-')), 'no CI watch against a phantom PR')
  // (b) claimed not pushed, observed pushed+PR -> the live PR is not stranded unwatched
  const b = await run(makeDispatcher({
    'ship-verify': () => ({ pushed: true, prUrl: 'https://github.com/o/r/pull/9', evidence: 'ahead 0; PR open' }),
    'ship': () => ({ pushed: false, prUrl: '', prCreated: false, planStatusFlipped: true, detail: 'push reported failed' }),
  }))
  assert.ifError(b.error)
  assert.equal(b.result.ship.pushed, true, 'observed push wins over a claimed failure')
  assert.match(b.result.ship.prUrl, /pull\/9/)
  assert.ok(b.trace.calls.some((c) => c.label === 'ci-watch-1'), 'live PR gets watched, not stranded')
  return 'self-report corrected by observation; CI keyed off observed state'
})

S('S62 ship-verify agent dies: self-report kept but marked unverified; CI proceeds', async () => {
  const d = makeDispatcher({ 'ship-verify': () => { throw new Error('verifier died') } })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ship.pushed, true, 'self-report kept when no observation exists')
  assert.equal(result.ship.verified, false, 'and marked unverified, never silently trusted')
  assert.ok(trace.logs.some((m) => /Ship-verify agent died/.test(m)))
  assert.ok(trace.calls.some((c) => c.label === 'ci-watch-1'), 'CI watch still runs — the watcher observes gh itself')
  return 'dead verifier degrades to a flagged self-report, not a halt'
})

S('S63 proof agent dies: durable UNVERIFIED residual, distinguishable from a skip; ship still gated on tests+lint only', async () => {
  const d = makeDispatcher({ proof: () => { throw new Error('proof died') } })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.proof, null)
  assert.ok(trace.logs.some((m) => /Proof agent failed/.test(m)))
  assert.equal(result.ship.pushed, true, 'a dead proof agent does not block a green-gated ship')
  const shipCall = trace.calls.find((c) => c.label === 'ship')
  assert.ok(shipCall.prompt.includes('(UNVERIFIED) browser-proof agent died'), 'death durable in PR residuals')
  assert.ok(shipCall.prompt.includes('not run (proof agent failed)'), 'evidence section states proof never ran')
  return 'proof death is durable, never silently equivalent to not-applicable'
})

S('S64 compound docs claim audited: failing path demoted; dead auditor flags the claim unverified', async () => {
  const claim = () => ({ documented: true, paths: ['docs/solutions/a.md', 'docs/solutions/b.md'], detail: 'wrote two docs' })
  const a = await run(makeDispatcher({
    'audit-compound': () => ({ failures: [{ path: 'docs/solutions/b.md', evidence: 'not committed on the branch' }], detail: 'checked both' }),
    compound: claim,
  }))
  assert.ifError(a.error)
  assert.equal(a.result.compound.documented, true)
  assert.deepEqual(a.result.compound.paths, ['docs/solutions/a.md'], 'unbacked path demoted from the result')
  assert.match(a.result.compound.detail, /audit demoted 1 claimed path/)
  assert.ok(a.trace.logs.some((m) => /failed the audit/.test(m)))
  const auditCall = a.trace.calls.find((c) => c.label === 'audit-compound')
  assert.ok(auditCall.prompt.includes('docs/solutions/a.md') && auditCall.prompt.includes('docs/solutions/b.md'), 'audit grounded with every claimed path')
  assert.match(auditCall.prompt, /THIS\s+session/, 'audit judges only from session-observed output')
  // dead auditor: claim kept but flagged, never silently trusted
  const b = await run(makeDispatcher({
    'audit-compound': () => { throw new Error('auditor died') },
    compound: claim,
  }))
  assert.ifError(b.error)
  assert.equal(b.result.compound.documented, true)
  assert.match(b.result.compound.detail, /UNVERIFIED/)
  assert.ok(b.trace.logs.some((m) => /Compound-verify agent died/.test(m)))
  // no claim -> no audit dispatched
  const c = await run(makeDispatcher({}))
  assert.ifError(c.error)
  assert.ok(!c.trace.calls.some((x) => x.label === 'audit-compound'), 'documented=false claims nothing, audits nothing')
  return 'documented=true is audited; failures demote, a dead auditor flags'
})

S('S65 simplify agent deaths are loud at both call sites', async () => {
  const d = makeDispatcher({
    'simplify-wave-': () => { throw new Error('wave simplify died') },
    'simplify': () => { throw new Error('quality simplify died') },
  }, { routeExecutor: () => 'claude' })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.ok(trace.logs.some((m) => /Simplify wave 1 agent died/.test(m)), 'wave-site death logged')
  assert.ok(trace.logs.some((m) => /Simplify agent died — pass skipped/.test(m)), 'quality-site death logged')
  assert.equal(result.ship.pushed, true, 'a dead simplify never blocks the run')
  return 'no silent simplify skips'
})

S('S66 CI residual recorder retry: first recorder dies, the retry lands the note', async () => {
  let recorderCalls = 0
  const d = makeDispatcher({
    'ci-watch-': () => ({ checks: 'red', fixedAndPushed: false, detail: 'flaky, no fix path' }),
    'ci-residual': () => { recorderCalls++; if (recorderCalls === 1) throw new Error('recorder died'); return 'recorded on retry' },
  })
  const { result, trace, error } = await run(d)
  assert.ifError(error)
  assert.equal(result.ci.residualRecorded, true, 'retry made the residual durable')
  const first = trace.calls.find((c) => c.label === 'ci-residual')
  const retry = trace.calls.find((c) => c.label === 'ci-residual-retry')
  assert.ok(first && retry, 'retry dispatched after the first recorder died')
  assert.equal(first.prompt, retry.prompt, 'retry carries the identical durable-note brief')
  assert.ok(trace.logs.some((m) => /retrying once/.test(m)))
  return 'one bounded retry before a live PR is left unannotated'
})

S('S56 model-tier policy: pinned labels use sonnet, keep-inherit labels stay on session model', async () => {
  // Use a dispatcher that triggers all 7 pinned labels in one run:
  // - a blocking finding in src/u1.js triggers fix-u1.js
  // - a failing proof route triggers proof-fix + proof-retest
  const FAIL_PROOF = { status: 'fail', routes: [{ route: '/', result: 'fail', detail: '500 on render' }], detail: 'broken' }
  // proof-retest and proof-fix are listed before proof so startsWith('proof') does not shadow them
  const d = makeDispatcher({
    'review-correctness': () => ({ findings: [{ title: 'off-by-one', file: 'src/u1.js', line: 4, severity: 'blocking', detail: 'd', failure_scenario: 'empty input crashes' }] }),
    'verify-correctness': () => ({ verdict: 'CONFIRMED', evidence: 'real' }),
    'fix-': () => ({ fixed: ['off-by-one'], skipped: [], detail: 'ok' }),
    'proof-retest': () => ({ status: 'pass', routes: [{ route: '/', result: 'pass', detail: 'ok' }], detail: 'ok' }),
    'proof-fix': () => ({ committed: true, detail: 'fixed' }),
    'proof-revalidate': () => VALIDATION,
    proof: () => FAIL_PROOF,
    compound: () => ({ documented: true, paths: ['docs/solutions/x.md'], detail: 'wrote one doc' }),
  }, { routeExecutor: () => 'claude' })
  const { trace, error } = await run(d)
  assert.ifError(error)
  const model = (label) => trace.calls.find((c) => c.label === label)?.model
  // pinned — grunt-tier sites must dispatch with model: 'sonnet'
  assert.equal(model('route-U1'), 'sonnet', 'route-${t.id} is grunt-tier; pinned to sonnet')
  assert.equal(model('fix-u1.js'), 'sonnet', 'fix-${filename} is grunt-tier; pinned to sonnet')
  assert.equal(model('proof'), 'sonnet', 'proof is grunt-tier; pinned to sonnet')
  assert.equal(model('proof-fix'), 'sonnet', 'proof-fix is grunt-tier; pinned to sonnet')
  assert.equal(model('proof-retest'), 'sonnet', 'proof-retest is grunt-tier; pinned to sonnet')
  assert.equal(model('compound'), 'sonnet', 'compound is grunt-tier; pinned to sonnet')
  assert.equal(model('ship'), 'sonnet', 'ship is grunt-tier; pinned to sonnet')
  assert.equal(model('audit-fixes'), 'sonnet', 'audit-fixes is mechanical commit-vs-claim checking; pinned to sonnet')
  assert.equal(model('gate-recheck'), 'sonnet', 'gate-recheck is mechanical run-and-report; pinned to sonnet')
  assert.equal(model('ship-verify'), 'sonnet', 'ship-verify is mechanical observe-and-report; pinned to sonnet')
  assert.equal(model('audit-compound'), 'sonnet', 'audit-compound is mechanical path checking; pinned to sonnet')
  // keep-inherit — session-model labels must NOT set model
  assert.equal(model('split-U1'), undefined, 'split-${u.uid} is keep-inherit; must not set model')
  assert.equal(model('triage-wave-1'), undefined, 'triage-wave-${w+1} is keep-inherit; must not set model')
  assert.equal(model('simplify'), undefined, 'simplify is keep-inherit; must not set model')
  assert.equal(model('sweep'), undefined, 'sweep is keep-inherit; must not set model')
  return '11 sonnet pins confirmed; 4 keep-inherit labels confirmed undefined'
})

// ---------- runner ----------
S('S55 first-class repo arg: every dispatch is grounded with the target repository; absent by default', async () => {
  const grounded = await run(makeDispatcher(), { args: { ...ARGS, repo: '/sibling/target-repo/' } })
  assert.ifError(grounded.error)
  const ungroundedCalls = grounded.trace.calls.filter((c) => !c.prompt.startsWith('TARGET REPOSITORY: /sibling/target-repo\n'))
  assert.deepEqual(ungroundedCalls.map((c) => c.label), [], 'every agent dispatch carries the repo grounding prefix (trailing slash trimmed)')
  const plain = await run(makeDispatcher())
  assert.ifError(plain.error)
  assert.ok(!plain.trace.calls.some((c) => c.prompt.includes('TARGET REPOSITORY:')), 'no grounding prefix when args.repo is unset')
  // Runtime quirk: scriptPath launches deliver args as a JSON-encoded string.
  const stringly = await run(makeDispatcher(), { args: JSON.stringify({ ...ARGS, repo: '/sibling/target-repo/' }) })
  assert.ifError(stringly.error)
  assert.ok(stringly.trace.calls.every((c) => c.prompt.startsWith('TARGET REPOSITORY: /sibling/target-repo\n')), 'JSON-string args are parsed at the boundary and behave identically')
  return 'one chokepoint grounds every contextless agent with the target repo'
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
