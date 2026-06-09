export const meta = {
  name: 'ce-work-deterministic',
  description: 'Deterministic ce-work: parse a ce-plan doc, split units into context-window-sized tasks, route each task to codex or claude, execute in isolated worktrees, merge in dependency waves, review and validate on an integration branch.',
  whenToUse: 'Executing a ce-plan plan document end-to-end with mixed codex/claude executors. args: { plan: "<path>", planVersion?: "<hash-or-mtime — pass a NEW value after editing the plan so resume does not replay a stale cached parse>", base?: "<branch>", slug?: "<branch-slug>", codex?: true|false, sandbox?: "yolo"|"full-auto", effortFloor?: "<minimal|low|medium|high|xhigh>", startedAt?: <ms> }',
  phases: [
    { title: 'Recon', detail: 'Parse plan, probe repo + codex availability' },
    { title: 'Setup', detail: 'Create integration worktree and branch' },
    { title: 'Split', detail: 'Split units into one-context-window tasks' },
    { title: 'Route', detail: 'Analyzer assigns codex or claude per task' },
    { title: 'Execute', detail: 'Run tasks in worktrees, wave by wave' },
    { title: 'Integrate', detail: 'Merge task branches, test, clean up' },
    { title: 'Quality', detail: 'Simplify, persona review, verified fixes' },
    { title: 'Validate', detail: 'Requirements trace, full suite, lint' },
  ],
}

// ============================================================
// args contract (all coordinator inputs come from args — no I/O here)
// ============================================================
if (!args || !args.plan) {
  throw new Error('ce-work-deterministic requires args.plan = path to a ce-plan document')
}
const PLAN = args.plan
const CODEX_ENABLED = args.codex !== false           // invoking with codex enabled is the consent act
const SANDBOX = args.sandbox === 'full-auto' ? 'full-auto' : 'yolo'
const CODEX_WAIT_ROUNDS = args.codexWaitRounds || 30 // x ~60s poll blocks ≈ 30 min ceiling per codex task

// ============================================================
// Schemas
// ============================================================
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

const RECON_SCHEMA = {
  type: 'object',
  properties: {
    repoRoot: { type: 'string' },
    defaultBranch: { type: 'string' },
    testCommand: { type: 'string' },
    lintCommand: { type: 'string' },
    conventionsDigest: { type: 'string', description: '<=20 lines distilled from AGENTS.md/CLAUDE.md' },
    codexAvailable: { type: 'boolean' },
    codexPath: { type: 'string' },
    effortFloor: { type: 'string', description: 'work_delegate_effort from .compound-engineering/config.local.yaml if set to one of minimal|low|medium|high|xhigh, else ""' },
    insideCodexSandbox: { type: 'boolean' },
    baselineClean: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['repoRoot', 'defaultBranch', 'testCommand', 'lintCommand', 'codexAvailable', 'insideCodexSandbox', 'baselineClean', 'conventionsDigest'],
}

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'unit U-ID plus letter when split, e.g. U3a; bare U-ID when unsplit' },
          uid: { type: 'string' },
          title: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'task ids WITHIN this unit only (intra-unit chaining for shared files)' },
          dossier: { type: 'string', description: 'fully self-contained work brief: goal, exact file paths, approach, patterns to mirror, test scenarios, verification outcome. Must require no access to the plan to act on.' },
          files: { type: 'array', items: { type: 'string' } },
          risk: { enum: ['trivial', 'low', 'medium', 'high'] },
          ambiguity: { enum: ['none', 'some', 'high'], description: 'how many implementation-time decisions remain open' },
          estDiffLines: { type: 'number' },
        },
        required: ['id', 'uid', 'title', 'dependsOn', 'dossier', 'files', 'risk', 'ambiguity', 'estDiffLines'],
      },
    },
  },
  required: ['tasks'],
}

const ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    executor: { enum: ['codex', 'claude'] },
    effort: { enum: ['default', 'medium', 'high', 'xhigh'], description: 'codex reasoning effort; ignored for claude' },
    reason: { type: 'string' },
  },
  required: ['executor', 'effort', 'reason'],
}

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['completed', 'partial', 'failed'] },
    branch: { type: 'string' },
    worktreePath: { type: 'string' },
    filesModified: { type: 'array', items: { type: 'string' } },
    verificationSummary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'branch', 'worktreePath', 'filesModified', 'verificationSummary', 'issues'],
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['merged', 'conflict', 'tests-failed'] },
    detail: { type: 'string' },
  },
  required: ['status', 'detail'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { enum: ['blocking', 'suggested', 'nit'] },
          detail: { type: 'string' },
        },
        required: ['title', 'file', 'severity', 'detail'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: ['continue', 'halt'] },
    reason: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'the specific discoveries that invalidate remaining work, quoted' },
  },
  required: ['verdict', 'reason', 'evidence'],
}

// ============================================================
// Shared prompt blocks. Personas live in agents/*.md (task-splitter,
// executor-router, unit-executor, codex-runner, skeptical-refuter), resolved
// via agentType. Prompts below carry only per-run grounding.
// ============================================================
const WORKTREE_HOWTO = (repoRoot, integrationBranch) => `
Work ONLY in an isolated worktree — never modify the main checkout at ${repoRoot}.
Create it (retry up to 3 times on ref-lock errors, it can race with sibling agents):
  git -C "${repoRoot}" worktree add "${repoRoot}/.worktrees/<TASK_ID>" -b "<BRANCH>" "${integrationBranch}"
Then copy env files if present: cp "${repoRoot}"/.env* "${repoRoot}/.worktrees/<TASK_ID>/" 2>/dev/null || true
Run every subsequent command from inside the worktree directory (absolute path).
Commit your work inside the worktree with a conventional message (no attribution
footers). Do NOT push. Do NOT touch branches other than your own.`

// ============================================================
// Phase: Recon
// ============================================================
phase('Recon')
log(`Plan: ${PLAN}`)

// Barrier justified: Setup and Split both need the full output of BOTH recon agents.
const [planDoc, recon] = await parallel([
  () => agent(
    `Read the plan document at "${PLAN}" (version: ${args.planVersion || 'unversioned'}) in this repository. It follows the ce-plan format:
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
planTitle.`,
    { label: 'parse-plan', phase: 'Recon', model: 'sonnet', schema: UNITS_SCHEMA },
  ),
  () => agent(
    `Probe this repository and report facts. Run, from the repo root:
- git rev-parse --show-toplevel  (repoRoot)
- default branch: git symbolic-ref refs/remotes/origin/HEAD, falling back to main/master
- baselineClean: git diff --quiet HEAD on the MAIN checkout (true if clean)
- the project's test command and lint command (from package.json / Makefile /
  AGENTS.md / CI config — report real commands, not guesses; if none exists say "none")
- conventionsDigest: read AGENTS.md (and CLAUDE.md if present) and distill the
  coding conventions an implementer must follow into <=20 lines
- codexAvailable: command -v codex prints an absolute path
- codexPath: that path or ""
- effortFloor: read .compound-engineering/config.local.yaml at the repo root if it
  exists; if work_delegate_effort is one of minimal|low|medium|high|xhigh report
  it, otherwise report ""
- insideCodexSandbox: true if $CODEX_SANDBOX or $CODEX_SESSION_ID is set`,
    { label: 'repo-recon', phase: 'Recon', model: 'sonnet', schema: RECON_SCHEMA },
  ),
])

if (!planDoc || !recon) throw new Error('Recon failed: plan parse or repo probe returned null')
if (!planDoc.units.length) throw new Error(`No implementation units extracted from ${PLAN}: ${planDoc.planTitle}`)
if (!recon.baselineClean) throw new Error('Main checkout has uncommitted tracked changes — commit or stash before running')

const codexUsable = CODEX_ENABLED && recon.codexAvailable && !recon.insideCodexSandbox
log(`${planDoc.units.length} units. codex=${codexUsable ? 'on' : 'off'} (enabled=${CODEX_ENABLED}, installed=${recon.codexAvailable}, sandboxed=${recon.insideCodexSandbox})`)

const SLUG = args.slug || planDoc.slug
const BASE = args.base || recon.defaultBranch

// Effort floor (reference: "Floor and resolution — hard rules"): when a floor is
// configured, substitute default->medium in the pick, then take max(pick, floor).
const EFFORT_ORDER = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4 }
const EFFORT_FLOOR = args.effortFloor || (recon.effortFloor && EFFORT_ORDER[recon.effortFloor] !== undefined ? recon.effortFloor : '')
const effectiveEffort = (picked) => {
  if (!EFFORT_FLOOR) return picked
  const p = picked === 'default' ? 'medium' : picked
  return EFFORT_ORDER[p] >= EFFORT_ORDER[EFFORT_FLOOR] ? p : EFFORT_FLOOR
}
const INTEGRATION_BRANCH = `feat/${SLUG}`
const INTEGRATION_WT = `${recon.repoRoot}/.worktrees/${SLUG}`

// ============================================================
// Phase: Setup — integration worktree; main checkout is never touched again
// ============================================================
phase('Setup')
const setup = await agent(
  `In the git repo at ${recon.repoRoot}, create an integration worktree:
  git -C "${recon.repoRoot}" fetch origin ${BASE} || true
  git -C "${recon.repoRoot}" worktree add "${INTEGRATION_WT}" -b "${INTEGRATION_BRANCH}" "origin/${BASE}"
(fall back to local "${BASE}" if the remote ref is unavailable; if the branch or
worktree already exists from a prior run, reuse it only if its tree is clean,
otherwise fail). Copy .env* files from the repo root into it if present. Ensure
".worktrees" is gitignored (add to .git/info/exclude if not). Return "ok: <path>"
or "fail: <reason>".`,
  { label: 'setup-integration', phase: 'Setup', model: 'sonnet' },
)
if (!setup || !String(setup).startsWith('ok')) throw new Error(`Integration worktree setup failed: ${setup}`)

// ============================================================
// Phase: Split + Route — pipeline per unit, then per task (no barrier needed
// until wave computation, which genuinely requires the full task set)
// ============================================================
phase('Split')
const unitContext = (u) => `
<unit>
U-ID: ${u.uid} — ${u.name}
Goal: ${u.goal}
Requirements: ${(u.requirements || []).join(', ') || 'n/a'}
Files: ${u.files.join(', ')}
Approach: ${u.approach}
Execution note: ${u.executionNote || 'none'}
Patterns to follow: ${u.patterns.join('; ') || 'none — follow conventions of modified files'}
Test scenarios:\n${u.testScenarios.map((s) => '- ' + s).join('\n')}
Verification: ${u.verification}
</unit>`

const splitResults = await pipeline(
  planDoc.units,
  (u) => agent(
    `Split (or pass through) this unit into tasks.
${unitContext(u)}

Repo conventions (include the relevant ones inside each dossier):
${recon.conventionsDigest}

Plan-level deferred questions the implementer must know about:
${(planDoc.deferredQuestions || []).join('\n') || 'none'}
Scope boundaries (non-goals):
${(planDoc.scopeBoundaries || []).join('\n') || 'none'}`,
    { label: `split-${u.uid}`, phase: 'Split', agentType: 'task-splitter', schema: TASKS_SCHEMA },
  ),
  (split, u) => {
    if (!split) return null
    return parallel(split.tasks.map((t) => () =>
      agent(
        `Codex is ${codexUsable ? 'AVAILABLE' : 'NOT available — apply the rubric honestly; the orchestrator handles the override'}.

Task ${t.id} (${t.title}) — risk: ${t.risk}, ambiguity: ${t.ambiguity}, est diff: ${t.estDiffLines} lines, files: ${t.files.join(', ')}
Dossier:
${t.dossier}`,
        { label: `route-${t.id}`, phase: 'Route', agentType: 'executor-router', schema: ROUTE_SCHEMA },
      ).then((route) => ({ ...t, route: route || { executor: 'claude', effort: 'default', reason: 'router failed — defaulted to claude' } })),
    )).then((routed) => ({ unit: u, tasks: routed.filter(Boolean) }))
  },
)

const unitResults = splitResults.filter(Boolean)
const droppedUnits = planDoc.units.filter((u) => !unitResults.some((r) => r.unit.uid === u.uid))
if (droppedUnits.length) log(`WARNING: splitter failed for ${droppedUnits.map((u) => u.uid).join(', ')} — these units will NOT be executed`)

// Propagate drops transitively: a unit depending (directly or through a chain)
// on a dropped unit must not execute against a tree missing its prerequisite.
const droppedUids = new Set(droppedUnits.map((u) => u.uid))
let grew = true
while (grew) {
  grew = false
  for (const { unit } of unitResults) {
    if (!droppedUids.has(unit.uid) && (unit.dependsOn || []).some((d) => droppedUids.has(d))) {
      droppedUids.add(unit.uid)
      grew = true
    }
  }
}

// ---- Build the full task graph (pure JS; barrier-equivalent point — wave
// computation genuinely needs every task) ----
const lastTaskOfUnit = {}
const allTasks = []
const preSkipped = []
for (const { unit, tasks } of unitResults) {
  if (droppedUids.has(unit.uid) && !droppedUnits.some((u) => u.uid === unit.uid)) {
    preSkipped.push(...tasks.map((t) => ({ ...t, skipReason: `prerequisite unit dropped: ${(unit.dependsOn || []).filter((d) => droppedUids.has(d)).join(', ')}` })))
    continue
  }
  if (droppedUids.has(unit.uid)) continue
  for (const t of tasks) allTasks.push({ ...t, unitDeps: unit.dependsOn || [] })
  lastTaskOfUnit[unit.uid] = tasks.map((t) => t.id)
}
if (preSkipped.length) log(`Skipping ${preSkipped.map((t) => t.id).join(', ')} — they depend on dropped unit(s)`)
for (const t of allTasks) {
  const cross = t.unitDeps.flatMap((uid) => lastTaskOfUnit[uid] || []) // unit dep -> all its tasks
  t.allDeps = [...new Set([...(t.dependsOn || []), ...cross])].filter((d) => allTasks.some((x) => x.id === d))
  if (!codexUsable && t.route.executor === 'codex') {
    t.route = { ...t.route, executor: 'claude', reason: t.route.reason + ' [codex unavailable — overridden]' }
  }
}
// Kahn levels -> waves
const level = {}
let remaining = [...allTasks]
let guard = 0
while (remaining.length && guard < 100) {
  const ready = remaining.filter((t) => t.allDeps.every((d) => level[d] !== undefined))
  if (!ready.length) throw new Error(`Dependency cycle among tasks: ${remaining.map((t) => t.id).join(', ')}`)
  for (const t of ready) level[t.id] = Math.max(0, ...t.allDeps.map((d) => level[d] + 1))
  remaining = remaining.filter((t) => level[t.id] === undefined)
  guard++
}
if (remaining.length) throw new Error(`Wave computation exceeded ${guard} levels with ${remaining.length} tasks unplaced`)
const maxLevel = Math.max(...allTasks.map((t) => level[t.id]))
const waves = []
for (let l = 0; l <= maxLevel; l++) waves.push(allTasks.filter((t) => level[t.id] === l))
log(`${allTasks.length} tasks in ${waves.length} wave(s). codex: ${allTasks.filter((t) => t.route.executor === 'codex').length}, claude: ${allTasks.filter((t) => t.route.executor === 'claude').length}`)

// ============================================================
// Phase: Execute + Integrate — sequential waves; parallel execution inside a
// wave (barrier justified: merges must be ordered and serialized), then a
// strictly sequential merge loop in fixed task order.
// ============================================================
const claudeExecutorPrompt = (t) => `
Task ${t.id}: ${t.title}
Branch: wf/${SLUG}/${t.id.toLowerCase()}   Worktree: ${recon.repoRoot}/.worktrees/${t.id}
${WORKTREE_HOWTO(recon.repoRoot, INTEGRATION_BRANCH).replace(/<TASK_ID>/g, t.id).replace(/<BRANCH>/g, `wf/${SLUG}/${t.id.toLowerCase()}`)}
Test command: ${recon.testCommand}

<dossier>
${t.dossier}
</dossier>

Repo conventions:
${recon.conventionsDigest}`

const codexRunnerPrompt = (t) => `
Task ${t.id}: ${t.title}
Codex binary: ${recon.codexPath}
Branch: wf/${SLUG}/${t.id.toLowerCase()}   Worktree: ${recon.repoRoot}/.worktrees/${t.id}
${WORKTREE_HOWTO(recon.repoRoot, INTEGRATION_BRANCH).replace(/<TASK_ID>/g, t.id).replace(/<BRANCH>/g, `wf/${SLUG}/${t.id.toLowerCase()}`)}
Test command (for the <verify> section of the codex prompt): ${recon.testCommand}
Scratch template for mktemp: -t ce-work-${t.id}-XXXXXX
Wait-round cap: ${CODEX_WAIT_ROUNDS}

Launch command (run from INSIDE the worktree, literal <scratch> path substituted):
  cd ${recon.repoRoot}/.worktrees/${t.id} && ${recon.codexPath} exec \\
    ${SANDBOX === 'full-auto' ? '-s workspace-write' : '--dangerously-bypass-approvals-and-sandbox'} \\
    ${effectiveEffort(t.route.effort) !== 'default' ? `-c 'model_reasoning_effort="${effectiveEffort(t.route.effort)}"' \\` : '\\'}
    --output-schema "<scratch>/schema.json" -o "<scratch>/result.json" \\
    - < "<scratch>/prompt.md"

Poll command (separate foreground Bash calls, literal <scratch> path):
  for i in $(seq 1 6); do test -s "<scratch>/result.json" && echo DONE && exit 0; sleep 10; done; echo WAITING

Cleanup commands (on failure):
  git -C "${recon.repoRoot}" worktree remove --force "${recon.repoRoot}/.worktrees/${t.id}"
  git -C "${recon.repoRoot}" branch -D "wf/${SLUG}/${t.id.toLowerCase()}"

<dossier>
${t.dossier}
</dossier>`

const integratorPrompt = (t, branch) => `
You integrate one finished task branch into the integration branch.
Integration worktree: ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}).
Task branch: ${branch}   Task worktree: ${recon.repoRoot}/.worktrees/${t.id}
Run everything from inside ${INTEGRATION_WT}.
1. git merge --no-ff ${branch}
   - On conflict: git merge --abort, return status "conflict" — do NOT hand-resolve.
2. Run the test suite: ${recon.testCommand}. If tests fail after a clean merge,
   try to diagnose and fix (you may edit, then commit the fix); if you cannot fix
   it within a couple of attempts, git reset --hard to the pre-merge commit and
   return status "tests-failed" with the failure output in detail.
3. On success: unlock/remove the task worktree and delete its branch:
   git -C "${recon.repoRoot}" worktree unlock "${recon.repoRoot}/.worktrees/${t.id}" 2>/dev/null || true
   git -C "${recon.repoRoot}" worktree remove "${recon.repoRoot}/.worktrees/${t.id}"
   git -C "${recon.repoRoot}" branch -d ${branch}
   (if branch -d refuses, report it in detail rather than forcing)
   Return status "merged".`

phase('Execute')
const results = {}            // taskId -> { status, executor, detail }
const failed = new Set()      // tasks that ultimately failed (dependents skipped)
let codexFailStreak = 0
let codexBroken = false
let planInvalidation = null   // set when a wave-boundary triage halts the run
let budgetHalted = false
const BUDGET_FLOOR = 30000    // stop dispatching waves below this many remaining tokens

for (let w = 0; w < waves.length; w++) {
  // Budget stop-loss: end cleanly with a partial result instead of mid-wave throws.
  if (budget.total && budget.remaining() < BUDGET_FLOOR) {
    const unrun = waves.slice(w).flat().filter((t) => !results[t.id])
    for (const t of unrun) results[t.id] = { status: 'skipped', executor: '-', detail: 'token budget exhausted before dispatch' }
    log(`Budget floor reached before wave ${w + 1} — skipping ${unrun.length} remaining task(s)`)
    budgetHalted = true
    break
  }
  const wave = waves[w].filter((t) => !t.allDeps.some((d) => failed.has(d)))
  const skipped = waves[w].filter((t) => !wave.includes(t))
  for (const t of skipped) { failed.add(t.id); results[t.id] = { status: 'skipped', executor: '-', detail: `dependency failed: ${t.allDeps.filter((d) => failed.has(d)).join(', ')}` } }
  if (skipped.length) log(`Wave ${w + 1}: skipping ${skipped.map((t) => t.id).join(', ')} (failed dependencies)`)
  if (!wave.length) continue
  log(`Wave ${w + 1}/${waves.length}: ${wave.map((t) => `${t.id}(${t.route.executor})`).join(', ')}`)

  // Execute the wave (barrier: the merge loop below must see all results and run in fixed order)
  const execs = await parallel(wave.map((t) => () => {
    const useCodex = t.route.executor === 'codex' && !codexBroken
    return agent(
      useCodex ? codexRunnerPrompt(t) : claudeExecutorPrompt(t),
      {
        label: `exec-${t.id}-${useCodex ? 'codex' : 'claude'}`,
        phase: 'Execute',
        agentType: useCodex ? 'codex-runner' : 'unit-executor',
        schema: EXEC_SCHEMA,
        ...(useCodex ? { model: 'sonnet' } : {}), // runner is mechanical; claude executor inherits
      },
    ).then((r) => ({ t, usedCodex: useCodex, r }))
  }))

  // Post-execution triage. Circuit-breaker accounting per the reference's
  // classification table: failed AND partial increment the streak; only
  // completed resets it. Any partial (codex or claude) gets a finisher; any
  // codex failure gets a claude fallback in a FRESH worktree after cleaning up
  // whatever the dead runner may have left behind.
  const staleCleanup = (t, branch) => `
IMPORTANT — a previous attempt at this task may have left stale state. Before
creating your worktree, clean it up:
  if pgrep -f "${recon.repoRoot}/.worktrees/${t.id}" >/dev/null 2>&1; then pkill -f "${recon.repoRoot}/.worktrees/${t.id}"; fi
  git -C "${recon.repoRoot}" worktree remove --force "${recon.repoRoot}/.worktrees/${t.id}" 2>/dev/null || true
  git -C "${recon.repoRoot}" branch -D "${branch}" 2>/dev/null || true`
  const finisherPrompt = (t, r) => `${claudeExecutorPrompt(t)}
\nIMPORTANT: a previous executor already made partial progress in this worktree
(${r.worktreePath}, branch ${r.branch}) and committed it. Do NOT recreate the
worktree. Review the existing diff against ${INTEGRATION_BRANCH}, complete the
remaining work described in the dossier (known gaps: ${r.issues.join('; ') || 'unspecified'}),
verify, and commit. Report "completed" only if verification passes.`

  const retried = []
  for (const e of execs.filter(Boolean)) {
    const status = e.r ? e.r.status : 'failed'
    if (e.usedCodex) {
      if (status === 'completed') {
        codexFailStreak = 0
      } else {
        codexFailStreak++
        if (codexFailStreak >= 3 && !codexBroken) { codexBroken = true; log('Circuit breaker: 3 consecutive non-completed codex results — all remaining codex tasks route to claude') }
      }
      if (status === 'failed') {
        log(`${e.t.id}: codex failed (${e.r ? e.r.issues.join('; ') : 'runner returned null'}) — re-dispatching to claude in a fresh worktree`)
        retried.push(agent(
          `${staleCleanup(e.t, `wf/${SLUG}/${e.t.id.toLowerCase()}`)}\n${claudeExecutorPrompt(e.t)}`,
          { label: `exec-${e.t.id}-claude-fallback`, phase: 'Execute', agentType: 'unit-executor', schema: EXEC_SCHEMA },
        ).then((r) => ({ t: e.t, usedCodex: false, r, wasFallback: true })))
      } else if (status === 'partial') {
        log(`${e.t.id}: codex partial — dispatching claude finisher in the same worktree`)
        retried.push(agent(finisherPrompt(e.t, e.r), { label: `finish-${e.t.id}`, phase: 'Execute', agentType: 'unit-executor', schema: EXEC_SCHEMA })
          .then((r) => ({ t: e.t, usedCodex: false, r, wasFinisher: true })))
      }
    } else if (status === 'partial' && e.r.branch) {
      log(`${e.t.id}: claude partial — dispatching finisher in the same worktree`)
      retried.push(agent(finisherPrompt(e.t, e.r), { label: `finish-${e.t.id}`, phase: 'Execute', agentType: 'unit-executor', schema: EXEC_SCHEMA })
        .then((r) => ({ t: e.t, usedCodex: false, r, wasFinisher: true })))
    }
  }
  const finals = new Map()
  for (const e of execs.filter(Boolean)) finals.set(e.t.id, e)
  for (const e of (await Promise.all(retried)).filter(Boolean)) finals.set(e.t.id, e)

  // Sequential merge loop, fixed task order (deterministic for resume)
  phase('Integrate')
  for (const t of wave) {
    let e = finals.get(t.id)
    // Only "completed" merges. A surviving "partial" here means the finisher
    // itself could not close the gaps — treat as failed so dependents skip.
    if (!e || !e.r || e.r.status !== 'completed' || !e.r.branch) {
      failed.add(t.id)
      results[t.id] = { status: 'failed', executor: e && e.usedCodex ? 'codex' : 'claude', detail: e && e.r ? `${e.r.status}: ${e.r.issues.join('; ') || 'no detail'}` : 'executor returned null' }
      log(`${t.id}: FAILED (${e && e.r ? e.r.status : 'null'}) — dependents will be skipped`)
      continue
    }
    let merge = await agent(integratorPrompt(t, e.r.branch), { label: `merge-${t.id}`, phase: 'Integrate', model: 'sonnet', schema: MERGE_SCHEMA })
    if (merge && merge.status === 'conflict') {
      log(`${t.id}: merge conflict — re-executing against the merged tree (claude)`)
      const redo = await agent(
        `${staleCleanup(t, e.r.branch)}\n${claudeExecutorPrompt(t)}
\nNOTE: an earlier attempt conflicted when merging into ${INTEGRATION_BRANCH}.
After the cleanup above, create a FRESH worktree from the CURRENT tip of
${INTEGRATION_BRANCH} and implement the dossier against the code as it now stands.`,
        { label: `redo-${t.id}`, phase: 'Execute', agentType: 'unit-executor', schema: EXEC_SCHEMA },
      )
      if (redo && redo.status === 'completed' && redo.branch) {
        e = { t, usedCodex: false, r: redo, wasRedo: true } // rebind so reporting reflects the work that actually merged
        merge = await agent(integratorPrompt(t, redo.branch), { label: `merge-${t.id}-retry`, phase: 'Integrate', model: 'sonnet', schema: MERGE_SCHEMA })
      } else {
        merge = { status: 'conflict', detail: `conflict re-execution ${redo ? redo.status : 'returned null'}` }
      }
    }
    if (merge && merge.status === 'merged') {
      results[t.id] = {
        status: 'merged',
        executor: e.usedCodex ? 'codex' : (e.wasFallback ? 'claude (codex fallback)' : e.wasFinisher ? 'partial + claude finisher' : e.wasRedo ? 'claude (conflict redo)' : 'claude'),
        detail: e.r.verificationSummary,
      }
    } else {
      failed.add(t.id)
      results[t.id] = { status: 'failed', executor: e.usedCodex ? 'codex' : 'claude', detail: merge ? `${merge.status}: ${merge.detail}` : 'integrator returned null' }
      log(`${t.id}: integration failed (${merge ? merge.status : 'null'}) — dependents will be skipped`)
    }
  }

  // Wave-boundary discovery triage (stop-loss, not re-planning): discoveries
  // flow up, the goal never mutates mid-run. If a discovery falsifies a premise
  // of unexecuted work, halt cleanly and report — the user edits the plan and
  // re-runs with a new planVersion. Local issues continue.
  const discoveries = [...finals.values()]
    .filter((e) => e.r && e.r.issues && e.r.issues.length)
    .map((e) => ({ task: e.t.id, status: e.r.status, issues: e.r.issues }))
  const remainingTasks = waves.slice(w + 1).flat().filter((t) => !failed.has(t.id) && !t.allDeps.some((d) => failed.has(d)))
  if (discoveries.length && remainingTasks.length) {
    const triage = await agent(
      `You are a stop-loss gate in a plan-execution run. Implementation agents just
finished a batch of tasks for the plan at ${PLAN} and reported these discoveries:
${JSON.stringify(discoveries, null, 2)}

These tasks are still queued to execute next, each built on the plan's assumptions:
${remainingTasks.map((t) => `- ${t.id}: ${t.title} (files: ${t.files.join(', ')})`).join('\n')}

Decide: "halt" ONLY if a discovery falsifies a premise the remaining tasks are
built on — e.g. a module they extend turns out not to exist or works completely
differently, an API contract they assume is wrong, the capability they add
already exists. Routine friction is "continue": test flakiness, small deviations
from the planned approach, extra files touched, partial-then-finished work,
style issues. You may read the plan and the repo to check a premise. The plan
was human-reviewed: executing it is the default, halting is the exception —
when uncertain, continue. You have no authority to change the plan; halting
hands the decision back to the human.`,
      { label: `triage-wave-${w + 1}`, phase: 'Integrate', schema: TRIAGE_SCHEMA },
    )
    if (triage && triage.verdict === 'halt') {
      for (const t of remainingTasks) results[t.id] = { status: 'skipped', executor: '-', detail: `plan invalidated after wave ${w + 1}: ${triage.reason}` }
      planInvalidation = { afterWave: w + 1, reason: triage.reason, evidence: triage.evidence }
      log(`HALT after wave ${w + 1}: plan-invalidating discovery — ${triage.reason}`)
      break
    }
  }
}

const mergedCount = Object.values(results).filter((r) => r.status === 'merged').length
log(`Execution done: ${mergedCount}/${allTasks.length} tasks merged, ${failed.size} failed/skipped`)
if (!mergedCount) throw new Error('No task merged — nothing to review or validate')

// On a stop-loss halt, skip Quality/Validate: hand back to the human fast
// instead of polishing a branch whose plan is stale or whose budget is gone.
const halted = planInvalidation || budgetHalted
if (halted) log(`Skipping Quality and Validate phases (${planInvalidation ? 'plan invalidated' : 'budget exhausted'}) — branch ${INTEGRATION_BRANCH} holds the merged partial work`)

// ============================================================
// Phase: Quality — simplify (>=30 changed lines), persona review with
// adversarial verification, batched fixes. All on the integration worktree.
// ============================================================
let confirmedCount = 0
let validation = null
if (!halted) {

phase('Quality')
const diffStat = await agent(
  `In ${INTEGRATION_WT}, run: git diff --stat origin/${BASE}...HEAD (fall back to ${BASE}).
Return ONLY the total changed-line count as a number.`,
  { label: 'diffstat', phase: 'Quality', model: 'sonnet', schema: { type: 'object', properties: { lines: { type: 'number' } }, required: ['lines'] } },
)
const changedLines = diffStat ? diffStat.lines : 0

if (changedLines >= 30) {
  await agent(
    `In the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}):
review the full diff vs the base for simplification — duplicated patterns to
consolidate, shared helpers to extract, dead code introduced by the changes,
needless indirection. Apply only safe, behavior-preserving simplifications, run
${recon.testCommand}, and commit ("refactor: simplify after ${SLUG} implementation").
If nothing is worth changing, change nothing and say so.`,
    { label: 'simplify', phase: 'Quality' },
  )
} else {
  log(`Simplify skipped: diff is ${changedLines} lines (<30)`)
}

// Persona reviewers — reuse compound-engineering reviewer agents via agentType.
// Always-on trio plus conditional personas based on the plan's risk surfaces.
const personas = [
  { key: 'correctness', type: 'compound-engineering:ce-correctness-reviewer' },
  { key: 'maintainability', type: 'compound-engineering:ce-maintainability-reviewer' },
  { key: 'testing', type: 'compound-engineering:ce-testing-reviewer' },
]
if (planDoc.riskSurfaces.some((s) => ['auth', 'payments', 'crypto', 'public-api'].includes(s))) {
  personas.push({ key: 'security', type: 'compound-engineering:ce-security-reviewer' })
}
if (planDoc.riskSurfaces.includes('migrations')) {
  personas.push({ key: 'migrations', type: 'compound-engineering:ce-data-migration-reviewer' })
}
log(`Review personas: ${personas.map((p) => p.key).join(', ')}`)

const reviewPrompt = (p) => `
Review the changes on branch ${INTEGRATION_BRANCH} relative to ${BASE}.
Work inside the worktree at ${INTEGRATION_WT}; diff with: git diff origin/${BASE}...HEAD
(fall back to ${BASE}). The work implements the plan at ${PLAN}.
Report findings with file, line where possible, severity (blocking | suggested | nit),
and enough detail that a fixer who has not seen your reasoning can act.`

// pipeline: each persona's findings go to verification as soon as that persona
// finishes — no cross-persona barrier needed.
const reviewed = await pipeline(
  personas,
  (p) => agent(reviewPrompt(p), { label: `review-${p.key}`, phase: 'Quality', agentType: p.type, schema: FINDINGS_SCHEMA }),
  (rev, p) => {
    if (!rev || !rev.findings.length) return []
    const actionable = rev.findings.filter((f) => f.severity !== 'nit')
    return parallel(actionable.map((f) => () =>
      agent(
        `Finding (${f.severity}) ${f.file}${f.line ? ':' + f.line : ''} — ${f.title}
${f.detail}

Where to look: the worktree at ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).`,
        { label: `verify-${p.key}-${f.file.split('/').pop()}`, phase: 'Quality', model: 'sonnet', agentType: 'skeptical-refuter', schema: VERDICT_SCHEMA },
      ).then((v) => (v && !v.refuted ? { ...f, persona: p.key } : null)),
    )).then((vs) => vs.filter(Boolean))
  },
)
const confirmed = reviewed.filter(Boolean).flat()
confirmedCount = confirmed.length
log(`${confirmed.length} confirmed finding(s) after adversarial verification`)

if (confirmed.length) {
  // Batch by file, but apply SEQUENTIALLY: all fixers share the one integration
  // worktree, so parallel edits/commits/test runs would race on the same tree.
  const byFile = {}
  for (const f of confirmed) (byFile[f.file] = byFile[f.file] || []).push(f)
  for (const [file, fs] of Object.entries(byFile)) {
    await agent(
      `In the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}): fix these
confirmed review findings in ${file}. Make the smallest correct fix for each, run
${recon.testCommand}, stage ONLY the files you changed, and commit
("fix: address review findings in ${file}").
If a finding turns out to be wrong once you read the code, skip it and say why.
${fs.map((f) => `- (${f.severity}, ${f.persona}) ${f.title}: ${f.detail}`).join('\n')}`,
      { label: `fix-${file.split('/').pop()}`, phase: 'Quality' },
    )
  }
}

// ============================================================
// Phase: Validate — full suite, lint, requirements trace
// ============================================================
phase('Validate')
validation = await agent(
  `Final validation in ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).
1. Run the full test suite: ${recon.testCommand}
2. Run lint: ${recon.lintCommand}
3. Requirements trace — for each requirement below, check the merged diff
   (git diff origin/${BASE}...HEAD, fall back to ${BASE}) and the code, and judge
   satisfied / partial / unmet with one line of evidence:
${planDoc.requirements.map((r) => `   - ${r.id}: ${r.text}`).join('\n')}
4. Per-unit verification — judge each criterion against the current code:
${planDoc.units.map((u) => `   - ${u.uid}: ${u.verification}`).join('\n')}
Do not fix anything; report honestly.`,
  {
    label: 'final-validation',
    phase: 'Validate',
    schema: {
      type: 'object',
      properties: {
        testsPass: { type: 'boolean' },
        lintPasses: { type: 'boolean' },
        requirements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { enum: ['satisfied', 'partial', 'unmet'] }, evidence: { type: 'string' } }, required: ['id', 'verdict', 'evidence'] } },
        units: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, verdict: { enum: ['verified', 'partial', 'unmet'] }, evidence: { type: 'string' } }, required: ['uid', 'verdict', 'evidence'] } },
        notes: { type: 'string' },
      },
      required: ['testsPass', 'lintPasses', 'requirements', 'units', 'notes'],
    },
  },
)

} // end if (!halted)

// Deliberately NO push / PR creation: the branch is ready for the main session
// (and the user) to review and ship via ce-commit-push-pr.
return {
  plan: PLAN,
  planVersion: args.planVersion || 'unversioned',
  branch: INTEGRATION_BRANCH,
  worktree: INTEGRATION_WT,
  planInvalidation,
  budgetHalted,
  tasks: Object.fromEntries([
    ...allTasks.map((t) => [t.id, { title: t.title, routedTo: t.route.executor, routeReason: t.route.reason, ...results[t.id] }]),
    ...preSkipped.map((t) => [t.id, { title: t.title, routedTo: t.route.executor, status: 'skipped', detail: t.skipReason }]),
  ]),
  droppedUnits: droppedUnits.map((u) => u.uid),
  effortFloor: EFFORT_FLOOR || 'none',
  codexCircuitBreakerTripped: codexBroken,
  confirmedReviewFindings: confirmedCount,
  validation,
}
