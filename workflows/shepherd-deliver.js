export const meta = {
  name: 'shepherd-deliver',
  description: 'Drives a committed ce-plan document to a pull request: it splits each plan unit into context-window-sized tasks, routes each to a Codex or Claude executor, builds them test-first in isolated git worktrees, and merges them in dependency order. It then reviews the integrated branch (simplification plus persona and second-model passes with independently verified fixes), validates against the plan\'s requirements, browser-proofs affected routes, records reusable learnings, opens the PR, and watches CI with a bounded auto-fix loop.',
  whenToUse: 'Executing a ce-plan plan document end-to-end with mixed codex/claude executors, through to a PR. Invoking with ship enabled IS the consent to push and open a PR. args: { plan: "<path>", planVersion?: "<hash-or-mtime — pass a NEW value after editing the plan so resume does not replay a stale cached parse>", base?: "<branch>", slug?: "<branch-slug>", codex?: true|false, sandbox?: "yolo"|"full-auto", effortFloor?: "<minimal|low|medium|high|xhigh>", proof?: true|false, ship?: true|false, compound?: true|false, ciRounds?: <max CI fix iterations, default 3>, startedAt?: <ms> }',
  phases: [
    { title: 'Recon', detail: 'Parse plan, probe repo + codex availability' },
    { title: 'Setup', detail: 'Create integration worktree and branch' },
    { title: 'Split', detail: 'Split units into one-context-window tasks' },
    { title: 'Route', detail: 'Analyzer assigns codex or claude per task' },
    { title: 'Execute', detail: 'Run tasks in worktrees, wave by wave' },
    { title: 'Integrate', detail: 'Merge task branches, test, simplify as you go' },
    { title: 'Quality', detail: 'Simplify, persona + codex review, verified fixes' },
    { title: 'Validate', detail: 'Requirements trace, full suite, lint' },
    { title: 'Proof', detail: 'Browser-test affected routes, one fix round' },
    { title: 'Compound', detail: 'Document solved problems from the run' },
    { title: 'Ship', detail: 'Commit, push, open PR with evidence + residuals' },
    { title: 'CI', detail: 'Watch checks, bounded autofix loop' },
  ],
}

// ============================================================
// args contract (all coordinator inputs come from args — no I/O here)
// ============================================================
// The Workflow runtime delivers tool-level args to scriptPath launches as a
// JSON-encoded STRING (observed live, twice — instant preflight death as
// args.plan read undefined). Accept both forms at the boundary.
if (typeof args === 'string') { try { args = JSON.parse(args) } catch { /* fall through — the contract check below dies legibly */ } }
if (!args || !args.plan) {
  throw new Error('shepherd-deliver requires args.plan = path to a ce-plan document')
}
const PLAN = args.plan
const CODEX_ENABLED = args.codex !== false           // invoking with codex enabled is the consent act
const SANDBOX = args.sandbox === 'full-auto' ? 'full-auto' : 'yolo'
const CODEX_WAIT_ROUNDS = args.codexWaitRounds || 30 // x ~60s poll blocks ≈ 30 min ceiling per codex task
const PROOF_ENABLED = args.proof !== false
const SHIP_ENABLED = args.ship !== false             // invoking with ship enabled is the consent to push + open a PR
const COMPOUND_ENABLED = args.compound !== false
const CI_ROUNDS = Math.max(1, Math.min(10, args.ciRounds || 3)) // lfg default 3; hard-clamped 1..10 so a bad arg cannot unbound the loop
// Args echo — a launch whose args never arrived (observed live: a scriptPath
// launch delivered no tool-level args) must die loudly AND legibly, never silently.
log(`shepherd-deliver args resolved: plan=${PLAN}, base=${args.base || '(default)'}, slug=${args.slug || '(derived)'}, codex=${CODEX_ENABLED}, sandbox=${SANDBOX}, proof=${PROOF_ENABLED}, ship=${SHIP_ENABLED}, compound=${COMPOUND_ENABLED}, ciRounds=${CI_ROUNDS}, repo=${args.repo || '(session cwd)'}`)

// ---- target-repo grounding (first-class repo arg) ----
// Every agent runs with the session cwd, which is NOT necessarily the repo the
// plan targets (observed live: executing against a sibling checkout required
// shimming a grounding prefix into every prompt). One chokepoint grounds every dispatch.
const REPO = args.repo ? String(args.repo).replace(/\/+$/, '') : ''
if (REPO) {
  const ungroundedAgent = agent
  agent = (prompt, opts) => ungroundedAgent(`TARGET REPOSITORY: ${REPO}
You are working on the repository at ${REPO}, NOT your current working directory.
Resolve every relative path in this brief (the plan document, worktrees, test
and git commands) against ${REPO}: cd into it first in any shell command, search
and read only there, and write only under ${REPO} and its worktrees.

${prompt}`, opts)
}

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
    ceSkillsRoot: { type: 'string', description: 'skills/ dir of the highest installed compound-engineering plugin version, or ""' },
    agentBrowserAvailable: { type: 'boolean' },
    ghAvailable: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['repoRoot', 'defaultBranch', 'testCommand', 'lintCommand', 'codexAvailable', 'insideCodexSandbox', 'baselineClean', 'conventionsDigest', 'ceSkillsRoot', 'agentBrowserAvailable', 'ghAvailable'],
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
    model: { enum: ['haiku', 'sonnet', 'opus'], description: 'claude model tier — used by the claude executor, and by fallback/finisher dispatches when codex fails' },
    reason: { type: 'string' },
  },
  required: ['executor', 'effort', 'model', 'reason'],
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

const SIMPLIFY_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean', description: 'true only when a simplification commit landed' },
    detail: { type: 'string' },
    kept: { type: 'array', items: { type: 'string' }, description: 'dead-code candidates kept because a reference remains or certainty was lacking' },
  },
  required: ['changed', 'detail', 'kept'],
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
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong outcome; for cleanup-style findings, the concrete cost' },
        },
        required: ['title', 'file', 'severity', 'detail', 'failure_scenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] }, evidence: { type: 'string' } },
  required: ['verdict', 'evidence'],
}

const CODEX_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    ran: { type: 'boolean', description: 'false when codex could not produce a result — distinct from a clean review' },
    findings: FINDINGS_SCHEMA.properties.findings,
    reason: { type: 'string', description: 'why codex was unusable when ran=false; "" on a clean run' },
  },
  required: ['ran', 'findings', 'reason'],
}

// Codex OUTPUT schemas: the shape codex writes to result.json, which the single
// codex-executor serializes to schema.json for `--output-schema`. Distinct from
// the agent-RETURN schemas (EXEC_SCHEMA, CODEX_REVIEW_SCHEMA) that the executor
// maps codex's snake_case result onto. These two moved out of the former
// codex-runner / codex-reviewer agents when the three Codex operators merged.
const CODEX_REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'number' },
      severity: { enum: ['blocking', 'suggested', 'nit'] },
      detail: { type: 'string' },
      failure_scenario: { type: 'string' },
    }, required: ['title', 'file', 'line', 'severity', 'detail', 'failure_scenario'] } },
  },
  required: ['findings'],
}
const CODEX_IMPL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['completed', 'partial', 'failed'] },
    files_modified: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    verification_summary: { type: 'string' },
  },
  required: ['status', 'files_modified', 'issues', 'summary', 'verification_summary'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' }, description: 'titles of findings actually fixed and committed' },
    skipped: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'] } },
    detail: { type: 'string' },
  },
  required: ['fixed', 'skipped', 'detail'],
}

const PROOF_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['pass', 'fail', 'partial', 'not-applicable', 'tool-missing'] },
    routes: { type: 'array', items: { type: 'object', properties: { route: { type: 'string' }, result: { enum: ['pass', 'fail', 'skip'] }, detail: { type: 'string' } }, required: ['route', 'result', 'detail'] } },
    detail: { type: 'string' },
  },
  required: ['status', 'routes', 'detail'],
}

const SHIP_SCHEMA = {
  type: 'object',
  properties: {
    pushed: { type: 'boolean' },
    prUrl: { type: 'string', description: '"" when no PR exists' },
    prCreated: { type: 'boolean' },
    planStatusFlipped: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['pushed', 'prUrl', 'prCreated', 'planStatusFlipped', 'detail'],
}

const CI_SCHEMA = {
  type: 'object',
  properties: {
    checks: { enum: ['green', 'red', 'no-ci'] },
    fixedAndPushed: { type: 'boolean', description: 'true when checks were red and a root-cause fix was committed and pushed' },
    detail: { type: 'string', description: 'one line: what failed, the diagnosis, and what the pushed fix changed (files + approach) — later rounds read this to avoid repeating a failed approach' },
  },
  required: ['checks', 'fixedAndPushed', 'detail'],
}

const COMPOUND_SCHEMA = {
  type: 'object',
  properties: {
    documented: { type: 'boolean' },
    paths: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
  required: ['documented', 'paths', 'detail'],
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
// executor-router, unit-executor, codex-executor, finding-verifier), resolved
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

// Codex CLI protocol fragments shared by the runner (Execute) and the
// second-model reviewer (Quality) so the two briefs cannot drift.
const CODEX_OUTPUT_ARGS = `--output-schema "<scratch>/schema.json" -o "<scratch>/result.json" \\
    - < "<scratch>/prompt.md"`
const CODEX_POLL_BLOCK = `Poll command (separate foreground Bash calls, literal <scratch> path):
  for i in $(seq 1 6); do test -s "<scratch>/result.json" && echo DONE && exit 0; sleep 10; done; echo WAITING`

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
- insideCodexSandbox: true if $CODEX_SANDBOX or $CODEX_SESSION_ID is set
- ceSkillsRoot: the skills/ directory of the HIGHEST installed version under
  ~/.claude/plugins/cache/compound-engineering-plugin/compound-engineering/*/skills
  (expand ~, report an absolute path; "" if none exists)
- agentBrowserAvailable: command -v agent-browser succeeds
- ghAvailable: gh auth status exits 0`,
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

// Installed compound-engineering skills are the authoritative instructions for
// the tail phases — agents read and follow the SKILL.md at run time rather than
// this script mirroring its content. Each call site supplies a fallback so the
// phase still runs when the plugin is not installed.
const skillGuide = (name, withSkill, fallback) => (recon.ceSkillsRoot
  ? `Read and follow the ${name} skill at ${recon.ceSkillsRoot}/${name}/SKILL.md${withSkill}`
  : fallback)
const SIMPLIFY_GUIDE = skillGuide('ce-simplify-code',
  ': run its reuse, quality, and efficiency review passes over the diff vs the base and apply the fixes it prescribes.',
  'Review the full diff vs the base for simplification — duplicated patterns to consolidate, shared helpers to extract, dead code introduced by the changes, needless indirection.')
const simplifyPrompt = (extraContext, commitMessage) => `
In the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}):
${SIMPLIFY_GUIDE}${extraContext}
Behavior preservation is non-negotiable: same outputs, same errors, same side
effects; do not relax assertions, weaken types, or delete tests. Run
${recon.testCommand} and commit ("${commitMessage}") only when green.
Dead code (overrides any skill guidance on deletions): before deleting any
symbol or file as dead, grep this worktree for remaining references — imports,
re-exports, string/dynamic lookups, scripts, bins — ignoring only code removed
in this same pass, and re-grep after each deletion. Delete only candidates
with no remaining references; exported symbols of a published package count
as referenced. If a reference remains or you are uncertain, keep it and
record it in kept — green tests alone cannot clear a deletion, because
consumers outside the diff may be untested.
If nothing is worth changing, change nothing and say so in detail.
Return: changed (true only if you committed), detail (what you did or why
nothing), kept (each kept dead-code candidate as "file:symbol — evidence";
[] when none).`

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
// Real agents wrap the sentinel in narrative ("Worktree created… ok: <path>"), so
// scan lines for it instead of anchoring to position; "fail:" anywhere wins.
const setupText = String(setup || '')
if (!setup || /^\s*fail\b/im.test(setupText) || !/^\s*ok\b/im.test(setupText)) throw new Error(`Integration worktree setup failed: ${setup}`)

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
        { label: `route-${t.id}`, phase: 'Route', agentType: 'executor-router', model: 'sonnet', schema: ROUTE_SCHEMA }, // routing is mechanical; output is a ROUTE_SCHEMA enum, not a design judgment
      ).then((route) => ({ ...t, route: route || { executor: 'claude', effort: 'default', model: 'sonnet', reason: 'router failed — defaulted to claude/sonnet' } })),
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

const codexRunnerPrompt = (t) => `Delegate one implementation task to the Codex CLI through your mechanical protocol.
sandbox_mode: workspace-write
Task ${t.id}: ${t.title}
Codex binary: ${recon.codexPath}
Branch: wf/${SLUG}/${t.id.toLowerCase()}   Worktree: ${recon.repoRoot}/.worktrees/${t.id}
${WORKTREE_HOWTO(recon.repoRoot, INTEGRATION_BRANCH).replace(/<TASK_ID>/g, t.id).replace(/<BRANCH>/g, `wf/${SLUG}/${t.id.toLowerCase()}`)}
Test command: ${recon.testCommand}
Scratch template for mktemp: -t ce-work-${t.id}-XXXXXX
Wait-round cap: ${CODEX_WAIT_ROUNDS}
Return shape: { status, branch, worktreePath, filesModified, verificationSummary, issues }. Map codex's snake_case result (files_modified -> filesModified, verification_summary -> verificationSummary), and fill branch + worktreePath from the coordinates above. Commit policy: on codex 'completed' verify the worktree changed (git status) then commit with a conventional message from the task title; on 'partial' commit "wip(${t.id}): partial — <summary>"; on 'failed' or a missing/malformed result, run the cleanup commands and return status 'failed' (carry codex's issues/summary). Never report 'completed' unless codex reported completed AND a commit now exists. Do NOT push.

Launch command (run from INSIDE the worktree, literal <scratch> path substituted):
  cd ${recon.repoRoot}/.worktrees/${t.id} && ${recon.codexPath} exec \\
    ${SANDBOX === 'full-auto' ? '-s workspace-write' : '--dangerously-bypass-approvals-and-sandbox'} \\
    ${effectiveEffort(t.route.effort) !== 'default' ? `-c 'model_reasoning_effort="${effectiveEffort(t.route.effort)}"' \\` : '\\'}
    ${CODEX_OUTPUT_ARGS}

${CODEX_POLL_BLOCK}

output_schema (serialize to schema.json per your strict-output rules):
${JSON.stringify(CODEX_IMPL_OUTPUT_SCHEMA, null, 2)}

Cleanup commands (on failure):
  git -C "${recon.repoRoot}" worktree remove --force "${recon.repoRoot}/.worktrees/${t.id}"
  git -C "${recon.repoRoot}" branch -D "wf/${SLUG}/${t.id.toLowerCase()}"

context (there is no role_file; write this into prompt.md as XML sections filled from the dossier below, then append the dossier):
Implement this task. Fill these sections from the dossier: <task> (the goal and end state); <files> (the file list); <patterns> (patterns to follow, or "No explicit patterns referenced — follow existing conventions in the modified files."); <approach>; <constraints> (do NOT run git commit/push or create PRs; restrict modifications to the worktree; keep changes tightly scoped — no unrelated refactors; resolve the task fully before stopping; report anything you could not do via the issues field); <testing> (the dossier's test scenarios plus: cover happy/edge/error/integration and supplement gaps; work test-first — write the failing tests, run them to confirm they fail because the behavior is missing, then implement until green; never delete or weaken an existing test to get green); <verify> (run all tests together in one command using the test command above; fix and re-run until green; never report "completed" unless verification passes — the orchestrator will not re-verify); <output_contract> (fill every schema field; status "completed" ONLY if all changes made AND verification passes).

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
const BUDGET_FLOOR = 30000    // stop dispatching below this many remaining tokens
const belowBudgetFloor = () => !!budget.total && budget.remaining() <= BUDGET_FLOOR

const simplifyKept = []  // dead-code candidates the simplify passes kept — surfaced in logs, the result, and (when shipping) PR residuals
for (let w = 0; w < waves.length; w++) {
  // Budget stop-loss: end cleanly with a partial result instead of mid-wave throws.
  if (belowBudgetFloor()) {
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
        agentType: useCodex ? 'codex-executor' : 'unit-executor',
        schema: EXEC_SCHEMA,
        model: useCodex ? 'sonnet' : (t.route.model || 'sonnet'), // codex-executor is mechanical; claude executor uses the routed tier (never inherits the session model)
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
          { label: `exec-${e.t.id}-claude-fallback`, phase: 'Execute', agentType: 'unit-executor', model: e.t.route.model || 'sonnet', schema: EXEC_SCHEMA },
        ).then((r) => ({ t: e.t, usedCodex: false, r, wasFallback: true })))
      } else if (status === 'partial') {
        log(`${e.t.id}: codex partial — dispatching claude finisher in the same worktree`)
        retried.push(agent(finisherPrompt(e.t, e.r), { label: `finish-${e.t.id}`, phase: 'Execute', agentType: 'unit-executor', model: e.t.route.model || 'sonnet', schema: EXEC_SCHEMA })
          .then((r) => ({ t: e.t, usedCodex: false, r, wasFinisher: true })))
      }
    } else if (status === 'partial' && e.r.branch) {
      log(`${e.t.id}: claude partial — dispatching finisher in the same worktree`)
      retried.push(agent(finisherPrompt(e.t, e.r), { label: `finish-${e.t.id}`, phase: 'Execute', agentType: 'unit-executor', model: e.t.route.model || 'sonnet', schema: EXEC_SCHEMA }) // finisher continues the unit at its routed tier, same as the codex-partial path
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
        { label: `redo-${t.id}`, phase: 'Execute', agentType: 'unit-executor', model: t.route.model || 'sonnet', schema: EXEC_SCHEMA },
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
      // A halt strands a human-reviewed plan and hands control back to a person, so it
      // is a high-consequence verdict that must be unambiguous. Observed live: a triage
      // agent emitted verdict:'halt' while its own reason prose concluded the opposite
      // ("this is a clear CONTINUE ... Correcting my verdict to continue") — the enum
      // and the reasoning diverged and a sound, half-built plan was stranded mid-run.
      // Per the adversarial-verification doctrine, confirm a halt with an INDEPENDENT
      // agent before acting on it; on any disagreement, uncertainty, or a dead confirmer,
      // continue — the triage's own default (a human-reviewed plan executes unless a
      // premise is provably falsified). One fumbled enum can no longer strand the run.
      const confirm = await agent(
        `An automated stop-loss gate has PROPOSED HALTING a plan-execution run after wave ${w + 1}.
A halt strands a human-reviewed plan and hands control back to a person, so it must be
justified by a discovery that PROVABLY falsifies a premise the remaining tasks depend on.

The RAW discoveries the gate was given (the source task id, status, and the executor's
issue text — your primary evidence; inspect these directly, do not rely on the gate's
summary alone):
${JSON.stringify(discoveries, null, 2)}

The gate's proposed halt reason:
${triage.reason}

The gate's cited evidence:
${(triage.evidence || []).map((e) => `- ${e}`).join('\n') || '(none cited)'}

The tasks that would be skipped if you confirm the halt:
${remainingTasks.map((t) => `- ${t.id}: ${t.title} (files: ${t.files.join(', ')})`).join('\n')}

Verify INDEPENDENTLY against the raw discoveries above. You may read the plan at ${PLAN}
and the repo to check. A real falsification means a premise the remaining tasks are built
on is provably wrong: a module they extend does not exist or works completely differently,
an API contract they assume is wrong, the capability they add already exists. A discovery
from a failed or partial task whose work never merged may not be visible in the repo —
weigh the reported issue text itself rather than treating its absence from the tree as
proof it is benign. The following are NOT falsifications: a dependency unit already created
a file the plan assigns it (intended dependsOn sequencing), extra files touched,
partial-then-finished work, test flakiness, style issues. Return "continue" if the raw
discoveries do not prove a real falsification, OR the proposed reason is internally
inconsistent (e.g. its own text argues for continuing), OR you are uncertain. Return
"halt" ONLY when you can independently name the falsified premise from the evidence above.`,
        { label: `triage-confirm-wave-${w + 1}`, phase: 'Integrate', schema: TRIAGE_SCHEMA },
      )
      if (confirm && confirm.verdict === 'halt') {
        for (const t of remainingTasks) results[t.id] = { status: 'skipped', executor: '-', detail: `plan invalidated after wave ${w + 1}: ${confirm.reason}` }
        planInvalidation = { afterWave: w + 1, reason: confirm.reason, evidence: confirm.evidence }
        log(`HALT after wave ${w + 1}: plan-invalidating discovery confirmed — ${confirm.reason}`)
        break
      }
      log(`Triage proposed halt after wave ${w + 1} but independent confirmation did not agree (verdict=${confirm ? confirm.verdict : 'null'}) — continuing. Proposed reason: ${triage.reason}`)
    }
  }

  // Simplify as you go (ce-work-beta Phase 2, step 5): after a wave that merged
  // 2+ tasks, consolidate on the integration branch BEFORE the next wave's
  // worktrees fork from it. The final wave is covered by the Quality simplify.
  const mergedThisWave = wave.filter((t) => results[t.id] && results[t.id].status === 'merged')
  if (w < waves.length - 1 && mergedThisWave.length >= 2) {
    const sw = await agent(
      simplifyPrompt(`
This is a mid-implementation pass — ${mergedThisWave.map((t) => t.id).join(', ')} just
merged and later tasks will build on this tree, so consolidate duplication NOW
but leave intentional seams alone.`, `refactor: simplify after wave ${w + 1}`),
      { label: `simplify-wave-${w + 1}`, phase: 'Integrate', schema: SIMPLIFY_SCHEMA },
    )
    if (!sw) log(`Simplify wave ${w + 1} agent died — pass skipped, no simplification applied`)
    else if (sw.kept.length) {
      simplifyKept.push(...sw.kept.map((k) => `wave ${w + 1}: ${k}`))
      log(`Simplify wave ${w + 1}: ${sw.kept.length} dead-code candidate(s) kept, not deleted — ${sw.kept.join('; ')}`)
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
let reviewStats = null        // { candidates, verified, refuted, dupes, budgetDropped, verifierFailed } — null when the run halts before Quality
let validation = null
const reviewDrops = { refuted: [], verifierDied: [], reviewerDied: [] } // coverage lost in the Quality gate, loud, never silent: refuted-with-evidence and no-verdict (refuter died/skipped) are per-verdict instance records (a duplicate of a refuted instance may still be confirmed via another reviewer; fail-closed by design); reviewerDied lists reviewer perspectives that produced NO result at all — their entire viewpoint is missing from the review.
let residuals = []            // confirmed-but-unfixed findings — made durable in the PR body (lfg residual contract)
let fixAudit = null           // independent audit of fixer "fixed" self-reports — { claimed, unsupported, unaudited } or null when nothing was claimed fixed
let shipGate = null           // independent fresh-context recheck of tests+lint at the ship boundary — null when ship never reached the gate
let proof = null
let proofFixSucceeded = false // a proof fix round ran AND the retest cleared every previously failing route
let ship = { pushed: false, prUrl: '', prCreated: false, planStatusFlipped: false, verified: false, detail: halted ? 'run halted before quality/validation' : '' }
let ci = { status: 'skipped', attempts: 0, detail: '', residualRecorded: false }
let compounded = null
const nitsDeferred = []       // nit findings excluded from verification (deliberate cost cap) — logged and returned, never silently dropped
if (!halted) {

phase('Quality')
const diffStat = await agent(
  `In ${INTEGRATION_WT}, run: git diff --stat origin/${BASE}...HEAD (fall back to ${BASE}).
Return ONLY the total changed-line count as a number.`,
  { label: 'diffstat', phase: 'Quality', model: 'sonnet', schema: { type: 'object', properties: { lines: { type: 'number' } }, required: ['lines'] } },
)
const changedLines = diffStat ? diffStat.lines : 0

if (changedLines >= 30) {
  const sq = await agent(
    simplifyPrompt('', `refactor: simplify after ${SLUG} implementation`),
    { label: 'simplify', phase: 'Quality', schema: SIMPLIFY_SCHEMA },
  )
  if (!sq) log('Simplify agent died — pass skipped, no simplification applied')
  else if (sq.kept.length) {
    simplifyKept.push(...sq.kept.map((k) => `quality: ${k}`))
    log(`Simplify: ${sq.kept.length} dead-code candidate(s) kept, not deleted — ${sq.kept.join('; ')}`)
  }
} else {
  log(`Simplify skipped: diff is ${changedLines} lines (<30)`)
}

// Persona reviewers — reuse compound-engineering reviewer agents via agentType.
// Always-on quartet (mirrors ce-code-review's always-on set minus the PR-only
// personas) plus conditional personas from the plan's risk surfaces and diff size.
const personas = [
  { key: 'correctness', type: 'compound-engineering:ce-correctness-reviewer' },
  { key: 'maintainability', type: 'compound-engineering:ce-maintainability-reviewer' },
  { key: 'testing', type: 'compound-engineering:ce-testing-reviewer' },
  { key: 'standards', type: 'compound-engineering:ce-project-standards-reviewer' },
]
if (planDoc.riskSurfaces.some((s) => ['auth', 'payments', 'crypto', 'public-api'].includes(s))) {
  personas.push({ key: 'security', type: 'compound-engineering:ce-security-reviewer' })
}
if (planDoc.riskSurfaces.includes('migrations')) {
  personas.push({ key: 'migrations', type: 'compound-engineering:ce-data-migration-reviewer' })
}
if (planDoc.riskSurfaces.includes('public-api')) {
  personas.push({ key: 'api-contract', type: 'compound-engineering:ce-api-contract-reviewer' })
}
if (changedLines >= 50 || planDoc.riskSurfaces.some((s) => ['auth', 'payments'].includes(s))) {
  personas.push({ key: 'adversarial', type: 'compound-engineering:ce-adversarial-reviewer' })
}

const reviewPrompt = () => `
Review the changes on branch ${INTEGRATION_BRANCH} relative to ${BASE}.
Work inside the worktree at ${INTEGRATION_WT}; diff with: git diff origin/${BASE}...HEAD
(fall back to ${BASE}). The work implements the plan at ${PLAN}.
Read the new and changed tests before the implementation — they reveal intended
coverage and where it falls short.
Report findings with file, line where possible, severity (blocking | suggested | nit),
and enough detail that a fixer who has not seen your reasoning can act.
Each finding must include a \`failure_scenario\`: the concrete inputs or state that produce the wrong outcome; for cleanup-style findings, state the concrete cost instead of a crash.
Pass every candidate with a nameable failure scenario through — do not silently drop half-believed candidates; an independent verifier judges them next.`

// Reviewer roster = persona reviewers + (when codex is usable) the Codex CLI as
// a second-model reviewer: a different model family catches what same-family
// review rationalizes away, and its findings face the same Claude verifier.
const reviewers = personas.map((p) => ({
  key: p.key,
  spawn: () => agent(reviewPrompt(), { label: `review-${p.key}`, phase: 'Quality', agentType: p.type, schema: FINDINGS_SCHEMA }),
}))
if (codexUsable && !codexBroken) {
  reviewers.push({
    key: 'codex',
    spawn: () => agent(
      `Run the Codex CLI as a read-only second-model reviewer through your mechanical protocol.
sandbox_mode: read-only
Codex binary: ${recon.codexPath}
Worktree: ${INTEGRATION_WT}   Branch: ${INTEGRATION_BRANCH}   Base: ${BASE} (diff origin/${BASE}...HEAD, fall back to ${BASE})
The work implements the plan at ${PLAN}.
Scratch template for mktemp: -t ce-review-${SLUG}-XXXXXX
Wait-round cap: 10
Return shape: { ran, findings, reason } — reason carries why codex was unusable when ran=false, "" on a clean run.

Launch command (run from INSIDE the worktree, literal <scratch> path substituted):
  cd ${INTEGRATION_WT} && ${recon.codexPath} exec -s read-only \\
    ${CODEX_OUTPUT_ARGS}

${CODEX_POLL_BLOCK}

output_schema (serialize to schema.json per your strict-output rules):
${JSON.stringify(CODEX_REVIEW_OUTPUT_SCHEMA, null, 2)}

context (there is no role_file; write this verbatim into prompt.md as the review instructions):
Review the diff between the base and HEAD in the worktree (git diff ${BASE}...HEAD, fall back to ${BASE}), reading surrounding code as needed. Hunt specifically for logic errors, broken edge cases, contract violations, and risky changes a reviewer from the authoring model family might rationalize away. Each finding MUST carry: title; file; line (0 when no specific line applies); severity (blocking | suggested | nit); failure_scenario (the concrete inputs/state that produce the wrong outcome — for cleanup-style findings, state the concrete cost instead of a crash); and enough detail that a fixer who has not seen the reasoning can act. Pass every candidate with a nameable failure scenario through — do not silently drop half-believed candidates; an independent verifier judges them next. Style nits without consequence are not findings. The review is READ-ONLY: no edits, no commits.`,
      { label: 'review-codex', phase: 'Quality', agentType: 'codex-executor', model: 'sonnet', schema: CODEX_REVIEW_SCHEMA }, // the single mechanical codex operator; codex does the reviewing
    ).then((r) => {
      if (r && !r.ran) log(`Codex second-model review did not run: ${r.reason}`)
      return r && r.ran ? { findings: r.findings } : null
    }),
  })
} else {
  log(`Codex second-model review skipped (${codexBroken ? 'circuit breaker tripped' : 'codex unavailable'})`)
}
// Inline angle reviewers — single-angle prompts with no persona file.
const inlineAngles = [
  ['removed-behavior', `Angle — removed behavior: For every line the diff DELETES or replaces, name the invariant or behavior it enforced, then search the new code for where that invariant is re-established. If you can't find it, that's a candidate: a removed guard, a dropped error path, a narrowed validation, a deleted test that was covering a real case.`],
  ['cross-file', `Angle — cross-file: For each function the diff changes, find its callers (Grep for the symbol) and check whether the change breaks any call site: a new precondition, a changed return shape, a new exception, a timing/ordering dependency. Also check callees: does a parallel change in the same PR make a call unsafe?`],
]
for (const [key, angle] of inlineAngles) {
  reviewers.push({
    key,
    spawn: () => agent(`${reviewPrompt()}\n\n${angle}`, { label: `review-${key}`, phase: 'Quality', schema: FINDINGS_SCHEMA }),
  })
}
log(`Reviewers: ${reviewers.map((r) => r.key).join(', ')}`)

// Pre-verification dedup + capped verifier budget. Dedup runs streaming, as
// each reviewer completes (pipeline stage 2, no cross-reviewer barrier), so a
// duplicate never consumes a verifier spawn. Same-defect rule: same file AND
// either both lines positive within 5 of each other (titles irrelevant), or at
// least one line-less and the normalized titles share a real 30-char prefix
// (both titles >=30 chars), falling back to exact normalized-title equality
// when either is shorter — a degraded prefix would let a short title like
// "cache poisoning bypass" absorb distinct defects across the file.
// JS is single-threaded, so mutating these shared accumulators inside
// concurrently-progressing stage closures is safe; bucket-winner and drop
// selection follow reviewer completion order — accepted because every drop and
// every duplicate absorption is logged with its identity.
const MAX_VERIFY = 25         // suggested-severity verifier cap
const MAX_BLOCKING_VERIFY = 50 // generous blocking ceiling so an inflated roster cannot spawn unbounded verifiers toward the agent cap
let verifySlots = MAX_VERIFY
let blockingSlots = MAX_BLOCKING_VERIFY
const kept = []               // every non-duplicate entry, INCLUDING budget-dropped ones, so later duplicates of a dropped finding still register as dupes
let candidates = 0, dupes = 0, budgetDropped = 0, refutedCount = 0, verifierFailed = 0
const findingRef = (f) => `${f.file}:${f.line || 0} — ${f.title}`
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\s]+/g, '').replace(/\s+/g, ' ').trim()
const sameDefect = (a, b) => {
  if (a.file !== b.file) return false
  if (a.line > 0 && b.line > 0) return Math.abs(a.line - b.line) <= 5
  const ta = normTitle(a.title), tb = normTitle(b.title)
  if (ta.length >= 30 && tb.length >= 30) return ta.slice(0, 30) === tb.slice(0, 30)
  return ta.length > 0 && ta === tb // a degraded (shorter) prefix would merge any title that prefixes a longer one; short titles must match exactly
}
// Resolves to the SAME kept-entry object (never a fresh spread) so severity and
// persona merges from later-completing reviewers stay visible to the fixer batch.
const spawnVerifier = (entry, rvKey) => agent(
  `Finding (${entry.severity}) ${entry.file}${entry.line ? ':' + entry.line : ''} — ${entry.title}
${entry.detail}
Failure scenario: ${entry.failure_scenario}

Where to look: the worktree at ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).
Read the actual code there; never take the finding's word for anything.
Verdict ladder — CONFIRMED only when you can name the concrete triggering
inputs/state AND quote the offending line; REFUTED only when the refutation is
constructible from the code (quote the disproving line, invariant, or guard);
otherwise PLAUSIBLE, the default for realistic-but-unproven findings.`,
  { label: `verify-${rvKey}-${entry.file.split('/').pop()}`, phase: 'Quality', model: 'sonnet', agentType: 'finding-verifier', schema: VERDICT_SCHEMA },
).then((v) => {
  if (v && v.verdict !== 'REFUTED') { entry.verdict = v.verdict; entry.evidence = v.evidence || ''; return entry }
  if (v) {
    // genuine code-based refutation — marked so later duplicates of this entry
    // can revive it, and recorded with the verifier's evidence (never silent)
    entry.refuted = true
    refutedCount++
    entry.refutedRecord = `(${rvKey}) ${entry.file}${entry.line ? ':' + entry.line : ''} — ${entry.title}: ${String(v.evidence || '').replace(/\s*\n\s*/g, ' ')}`
    reviewDrops.refuted.push(entry.refutedRecord)
  } else {
    verifierFailed++          // verifier crashed: still drop the finding (fail if uncertain), but never report infra failure as a refutation
    reviewDrops.verifierDied.push(`(${rvKey}, ${entry.severity}) ${entry.file}${entry.line ? ':' + entry.line : ''} — ${entry.title}`)
    log(`Verifier agent died for ${findingRef(entry)} — finding dropped unverified (fail if uncertain)`)
  }
  return null
})
// Shared by the reviewer pipeline and the post-verification sweep so both
// finding sources face the exact same dedup, budget, and verification path.
const processFindings = (findings, key) => {
  const toVerify = []
  const nits = findings.filter((f) => f.severity === 'nit')
  if (nits.length) {
    // The reviewPrompt solicits nit severity, so reviewers WILL produce nits;
    // verifying/fixing them is a deliberate cost cap — but the cap must be loud.
    nitsDeferred.push(...nits.map((f) => `(${key}) ${f.file}${f.line ? ':' + f.line : ''} — ${f.title}`))
    log(`review-${key}: ${nits.length} nit finding(s) not sent to verification (cost cap) — listed in the workflow result`)
  }
  for (const f of findings.filter((x) => x.severity !== 'nit')) {
    candidates++
    const match = kept.find((k) => sameDefect(k, f))
    if (match) {
      dupes++
      log(`Duplicate finding absorbed into ${findingRef(match)}: ${findingRef(f)} (${key})`)
      const escalates = f.severity === 'blocking' && match.severity !== 'blocking'
      if (escalates) {
        match.severity = 'blocking'
        // Refund the suggested-only budget slot: the entry is now blocking and
        // exempt from MAX_VERIFY, so its slot must not starve a later suggested finding.
        if (match.suggestedSlot) { match.suggestedSlot = false; verifySlots++ }
      }
      match.persona = `${match.persona}+${key}`
      // Keep the absorbed finding's distinct wording — a false merge of two
      // nearby defects must still surface both write-ups to the verifier
      // (revival paths below) and the fixer, not just the first reviewer's.
      if (f.detail !== match.detail) match.detail = `${match.detail} [dup ${key}: ${f.detail}]`
      if (f.failure_scenario !== match.failure_scenario) match.failure_scenario = `${match.failure_scenario} [dup ${key}: ${f.failure_scenario}]`
      // Anchor a line-less entry at the duplicate's location so it stops
      // absorbing every later same-file finding via the title branch.
      if (!(match.line > 0) && f.line > 0) match.line = f.line
      // A budget-dropped (never verified) entry escalated to blocking gets its
      // verifier NOW — blocking findings always get one — and leaves the
      // budgetDropped bucket so candidates === verified + refuted + verifierFailed + dupes + budgetDropped holds.
      if (match.dropped && escalates) {
        match.dropped = false
        budgetDropped--
        toVerify.push(() => spawnVerifier(match, key))
      }
      // A REFUTED entry hit by a blocking duplicate gets re-verified with the
      // merged write-up (which now carries the duplicate's failure_scenario):
      // the refutation judged the original wording, not the new evidence.
      if (match.refuted && escalates) {
        match.refuted = false
        refutedCount--
        // Withdraw the refutation record pending re-verification — it judged
        // the original wording, which no longer stands alone.
        const ri = reviewDrops.refuted.indexOf(match.refutedRecord)
        if (ri >= 0) reviewDrops.refuted.splice(ri, 1)
        toVerify.push(() => spawnVerifier(match, key))
      }
      continue
    }
    const entry = { ...f, persona: key }
    kept.push(entry)
    if (f.severity === 'blocking') {
      if (blockingSlots <= 0) {
        entry.dropped = true
        budgetDropped++
        log(`Blocking-verifier ceiling (${MAX_BLOCKING_VERIFY}) reached — dropping unverified blocking finding ${findingRef(f)}`)
      } else {
        blockingSlots--
        toVerify.push(() => spawnVerifier(entry, key)) // blocking bypasses the suggested-severity cap, under its own generous ceiling
      }
    } else if (verifySlots <= 0) {
      entry.dropped = true
      budgetDropped++
      log(`Verify cap (${MAX_VERIFY}) reached — dropping unverified suggested finding ${findingRef(f)}`)
    } else {
      verifySlots--
      entry.suggestedSlot = true // consumed a MAX_VERIFY slot; refunded if a later duplicate escalates this entry to blocking
      toVerify.push(() => spawnVerifier(entry, key))
    }
  }
  return toVerify
}
await pipeline(
  reviewers,
  (rv) => rv.spawn(),
  (rev, rv) => {
    if (!rev) {
      // A dead reviewer is NOT a clean reviewer: its whole perspective is gone.
      reviewDrops.reviewerDied.push(rv.key)
      log(`Reviewer ${rv.key} produced no result (died, skipped, or reported it could not run) — its perspective is MISSING from this review`)
      return []
    }
    if (!rev.findings.length) return []
    return parallel(processFindings(rev.findings, rv.key))
  },
)

// Gap-hunting sweep — a sequential post-pipeline step, NOT a reviewer pipeline
// stage: it needs the COMPLETE verified set so it hunts only what the first
// pass missed. Gated on diff size like simplify; the skip is logged because
// the gate bounds coverage.
if (changedLines < 50) {
  log(`Sweep skipped: diff is ${changedLines} lines (<50)`)
} else if (belowBudgetFloor()) {
  log('Sweep skipped: token budget floor reached')
} else {
  // Exclude EVERYTHING the first pass already examined — verified, refuted,
  // and cap-dropped alike — so the sweep's 8 candidate slots go to genuine
  // gaps instead of re-deriving known-dead candidates that die in dedup.
  const exclusionLines = kept.map((e) =>
    e.verdict ? findingRef(e)
    : e.refuted ? `${findingRef(e)} (already examined and refuted — do not re-report)`
    : e.dropped ? `${findingRef(e)} (already reported, dropped at a verifier cap — do not re-report)`
    : `${findingRef(e)} (already reported — do not re-report)`)
  const sweep = await agent(
    `Hunt for gaps a first review pass MISSED in the changes on branch ${INTEGRATION_BRANCH} relative to ${BASE}.
Work inside the worktree at ${INTEGRATION_WT}; diff with: git diff origin/${BASE}...HEAD
(fall back to ${BASE}). The work implements the plan at ${PLAN}.

These findings were already examined by the first pass — do NOT re-derive or re-confirm these:
${exclusionLines.join('\n') || '(none — the first pass reported nothing)'}

Gap focus: moved/extracted code that dropped a guard or anchor; second-tier footguns (dataclass default evaluated once, hash() non-determinism, lock-scope shrink, predicate methods with side effects); setup/teardown asymmetry in tests; config defaults flipped.

Report at most 8 candidates, each with file, line where possible, severity
(blocking | suggested | nit), and enough detail that a fixer who has not seen
your reasoning can act.
Each finding must include a \`failure_scenario\`: the concrete inputs or state that produce the wrong outcome; for cleanup-style findings, state the concrete cost instead of a crash.
If nothing new, return an empty list — do not pad.`,
    { label: 'sweep', phase: 'Quality', schema: FINDINGS_SCHEMA },
  )
  if (!sweep) {
    log('Sweep agent failed — no gap candidates collected')
  } else {
    let sweepFindings = sweep.findings
    if (sweepFindings.length > 8) {
      log(`Sweep returned ${sweepFindings.length} candidates — keeping the first 8, dropping ${sweepFindings.slice(8).map(findingRef).join('; ')}`)
      sweepFindings = sweepFindings.slice(0, 8)
    }
    const keptBefore = kept.length
    const survivors = (await parallel(processFindings(sweepFindings, 'sweep'))).filter(Boolean)
    log(`Sweep: ${kept.length - keptBefore} new candidate(s), ${survivors.length} survived verification`)
  }
}
// Confirmed = kept entries that were verified and not refuted. Budget-dropped
// entries are NOT confirmed, NOT fixed, NOT residuals — logs and stats only.
const confirmed = kept.filter((e) => e.verdict)
confirmedCount = confirmed.length
if (dupes) log(`${dupes} duplicate finding(s) merged by proximity dedup before verification`)
if (budgetDropped) log(`${budgetDropped} finding(s) dropped unverified at a verifier cap (suggested ${MAX_VERIFY}, blocking ${MAX_BLOCKING_VERIFY}) — identities in the drop logs above`)
log(`${confirmed.length} confirmed finding(s) after pre-verification dedup and adversarial verification${
  reviewDrops.refuted.length ? `; ${reviewDrops.refuted.length} refuted with evidence` : ''}${
  reviewDrops.verifierDied.length ? `; ${reviewDrops.verifierDied.length} dropped UNVERIFIED — refuter produced no verdict (died or skipped)` : ''}${
  reviewDrops.reviewerDied.length ? `; ${reviewDrops.reviewerDied.length} reviewer perspective(s) MISSING (${reviewDrops.reviewerDied.join(', ')})` : ''}`)
reviewStats = { candidates, verified: confirmedCount, refuted: refutedCount, dupes, budgetDropped, verifierFailed }

if (confirmed.length) {
  // Batch by file, but apply SEQUENTIALLY: all fixers share the one integration
  // worktree, so parallel edits/commits/test runs would race on the same tree.
  const byFile = {}
  for (const f of confirmed) (byFile[f.file] = byFile[f.file] || []).push(f)
  const fixLog = []   // one line per completed batch — each fixer is contextless, so prior batches' commits must ride the brief
  const claimedFixed = []  // findings the fixers self-reported as fixed — audited independently below, never trusted as-is
  for (const [file, fs] of Object.entries(byFile)) {
    const fx = await agent(
      `In the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}): fix these
verified review findings in ${file}. Make the smallest correct fix for each, run
${recon.testCommand}, stage ONLY the files you changed, and commit
("fix: address review findings in ${file}").
Each finding carries a verifier verdict; apply the verdict-conditional policy:
- CONFIRMED findings: fix them unless you can prove from the code that the
  finding is wrong; if you skip one, say exactly why it is provably wrong.
- PLAUSIBLE findings: fix only when the fix is local and behavior-preserving;
  otherwise skip it and cite the verifier's evidence (included with each finding
  below) in your skip reason.
Report every finding as either fixed (by title) or skipped (title + reason).
Report a finding as fixed ONLY when its fix commit now exists on the branch —
audit the claim against git log output from THIS session; attempted or intended
but uncommitted work is skipped, not fixed.${fixLog.length ? `
Outcomes of earlier fix batches this round, as REPORTED by each fixer — verify
against git log before treating a claimed fix as settled. Do not undo or
rework their commits; if your fix genuinely conflicts with one, skip the
finding and say so instead:
${fixLog.join('\n')}` : ''}
The findings to fix now:
${fs.map((f) => `- (${f.severity}, ${f.verdict}, ${f.persona}) ${f.title}: ${f.detail}
  Failure scenario: ${f.failure_scenario}
  Verifier evidence: ${f.evidence}`).join('\n')}`,
      { label: `fix-${file.split('/').pop()}`, phase: 'Quality', model: 'sonnet', schema: FIX_SCHEMA }, // file-level fix application is mechanical; findings and policy are fully specified in the prompt
    )
    const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ')
    fixLog.push(fx
      ? `- ${file}: fixed [${fx.fixed.map(oneLine).join('; ') || 'none'}], skipped [${fx.skipped.map((s) => oneLine(s.title)).join('; ') || 'none'}]`
      : `- ${file}: fixer agent died — findings became residuals; whether it committed is unverified, check git log`)
    // Anything not verifiably fixed becomes a residual — durable in the PR body.
    const residualOf = (f, reason) => ({ title: f.title, file: f.file, severity: f.severity, verdict: f.verdict, reason })
    if (!fx) residuals.push(...fs.map((f) => residualOf(f, 'fixer agent failed')))
    else {
      residuals.push(...fx.skipped.map((s) => residualOf(
        // UNKNOWN, not a verifier grade: a skip title matching no finding in the
        // batch was never verified, and the PR body must not claim it was.
        fs.find((f) => f.title === s.title) || { title: s.title, file, severity: 'suggested', verdict: 'UNKNOWN' },
        s.reason,
      )))
      const unaccounted = fs.filter((f) => !fx.fixed.includes(f.title) && !fx.skipped.some((s) => s.title === f.title))
      residuals.push(...unaccounted.map((f) => residualOf(f, 'fixer did not account for this finding')))
      claimedFixed.push(...fs.filter((f) => fx.fixed.includes(f.title)))
    }
  }
  // Fixer "fixed" lists are self-reports, not facts (lfg: "an unverified fix is
  // not finished"). One fresh-context auditor checks every claim against the
  // actual commits: unsupported claims demote to residuals; a dead or
  // budget-skipped audit leaves a durable UNAUDITED residual instead of
  // silently trusting the claims.
  if (claimedFixed.length && !belowBudgetFloor()) {
    const audit = await agent(
      `Independently audit fixer self-reports in the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}).
Fix agents claim they fixed and committed these review findings
("fix: address review findings in <file>" commits):
${claimedFixed.map((f) => `- ${f.file} — ${f.title}: ${String(f.detail).replace(/\s*\n\s*/g, ' ')}`).join('\n')}
For EACH claim: read the actual commits touching that file (git log --oneline -- <file>,
then git show) and judge whether a committed diff hunk plausibly addresses the
finding. Never take the claim's word for it — judge only from commits you read
in THIS session. Report in unsupported every claim (exact title and file as
listed above) with no backing commit; an empty unsupported list asserts you
checked every claim and each one is backed by a commit. Change nothing.`,
      { label: 'audit-fixes', phase: 'Quality', model: 'sonnet', schema: { type: 'object', properties: { unsupported: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, file: { type: 'string' }, evidence: { type: 'string' } }, required: ['title', 'file', 'evidence'] } }, detail: { type: 'string' } }, required: ['unsupported', 'detail'] } }, // mechanical commit-vs-claim check; the claims and the judging rule are fully specified
    )
    if (!audit) {
      fixAudit = { claimed: claimedFixed.length, unsupported: [], unaudited: claimedFixed.map((f) => `${f.file} — ${f.title}`) }
      log(`Fix-audit agent died — ${claimedFixed.length} fixed claim(s) stand UNAUDITED; recorded as a PR residual, not trusted silently`)
    } else {
      const unsupported = []
      for (const u of audit.unsupported) {
        const f = claimedFixed.find((c) => c.title === u.title && c.file === u.file) || claimedFixed.find((c) => c.title === u.title)
        if (!f) { log(`Fix-audit reported an unknown claim "${u.title}" — ignored (matches no fixer-claimed finding)`); continue }
        unsupported.push(`${f.file} — ${f.title}`)
        residuals.push({ title: f.title, file: f.file, severity: f.severity, verdict: f.verdict, reason: `fixer claimed fixed, but the audit found no supporting commit: ${u.evidence}` })
      }
      fixAudit = { claimed: claimedFixed.length, unsupported, unaudited: [] }
      log(unsupported.length
        ? `Fix-audit: ${unsupported.length}/${claimedFixed.length} fixed claim(s) NOT backed by a commit — demoted to residuals`
        : `Fix-audit: all ${claimedFixed.length} fixed claim(s) backed by commits`)
    }
  } else if (claimedFixed.length) {
    fixAudit = { claimed: claimedFixed.length, unsupported: [], unaudited: claimedFixed.map((f) => `${f.file} — ${f.title}`) }
    log(`Fix-audit skipped: token budget floor reached — ${claimedFixed.length} fixed claim(s) stand UNAUDITED; recorded as a PR residual`)
  }
  if (residuals.length) log(`${residuals.length} review residual(s) will be recorded in the PR body`)
}

// ============================================================
// Phase: Validate — full suite, lint, requirements trace. A function so the
// Proof phase can re-run the WHOLE trace after a fix commit lands — re-grounding
// only tests+lint would leave the requirements/deferred/post-deploy evidence in
// the PR body asserting the pre-fix snapshot.
// ============================================================
const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    testsPass: { type: 'boolean' },
    lintPasses: { type: 'boolean' },
    requirements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { enum: ['satisfied', 'partial', 'unmet'] }, evidence: { type: 'string' } }, required: ['id', 'verdict', 'evidence'] } },
    units: { type: 'array', items: { type: 'object', properties: { uid: { type: 'string' }, verdict: { enum: ['verified', 'partial', 'unmet'] }, evidence: { type: 'string' } }, required: ['uid', 'verdict', 'evidence'] } },
    deferredQuestions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, resolved: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['question', 'resolved', 'evidence'] } },
    postDeployChecks: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['testsPass', 'lintPasses', 'requirements', 'units', 'deferredQuestions', 'postDeployChecks', 'notes'],
}
const runValidation = (label, preamble) => agent(
  `${preamble}Validation in ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).
1. Run the full test suite: ${recon.testCommand}
2. Run lint: ${recon.lintCommand}
3. Requirements trace — for each requirement below, check the merged diff
   (git diff origin/${BASE}...HEAD, fall back to ${BASE}) and the code, and judge
   satisfied / partial / unmet with one line of evidence:
${planDoc.requirements.map((r) => `   - ${r.id}: ${r.text}`).join('\n')}
4. Per-unit verification — judge each criterion against the current code:
${planDoc.units.map((u) => `   - ${u.uid}: ${u.verification}`).join('\n')}
5. Deferred-question check — for each question the plan deferred to
   implementation, judge from the diff and commit messages whether it was
   actually resolved, with one line of evidence:
${(planDoc.deferredQuestions || []).map((q) => `   - ${q}`).join('\n') || '   (none deferred)'}
6. Post-deploy checks — from what the diff touches, list the 2-5 concrete
   things to monitor or manually validate after this deploys (metrics, logs,
   user flows). These go into the PR body verbatim.
Do not fix anything; report honestly. Audit every verdict you report against a
tool result from THIS session — testsPass and lintPasses come strictly from the
exit codes of the commands you ran above, never from memory, expectation, or a
prior agent's report.`,
  { label, phase: 'Validate', schema: VALIDATION_SCHEMA },
)

phase('Validate')
validation = await runValidation('final-validation', 'Final ')

// ============================================================
// Tail phases — the rest of the lfg pipeline (browser proof, compound, ship,
// CI watch), still inside the !halted block: a halted run skips them all.
// Autopilot contract: never prompt; anything unresolved becomes a durable
// residual in the PR body.
// ============================================================
const tailBudget = (phaseName) => {
  if (!belowBudgetFloor()) return true
  log(`${phaseName} skipped: token budget floor reached`)
  return false
}

// ---- Phase: Proof (lfg step 6) — browser-test the merged work, ONE fix round.
// Gated on green validation: browser-proofing a branch the ship gate already
// rejects burns dev-server + browser wall-clock for a report nobody ships. ----
if (!PROOF_ENABLED) {
  proof = { status: 'skipped', routes: [], detail: 'disabled by args.proof=false' }
} else if (!validation || !validation.testsPass || !validation.lintPasses) {
  proof = { status: 'skipped', routes: [], detail: 'validation gate red — fix the branch before browser-proofing it' }
  log(`Proof skipped: ${proof.detail}`)
} else if (!recon.agentBrowserAvailable) {
  proof = { status: 'skipped', routes: [], detail: 'agent-browser not installed' }
  log('Proof skipped: agent-browser CLI not installed')
} else if (!tailBudget('Proof')) {
  proof = { status: 'skipped', routes: [], detail: 'token budget floor reached' }
} else {
  phase('Proof')
  const proofPrompt = (focus) => `
Browser-proof the merged work in the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).
${skillGuide('ce-test-browser', ' in mode:pipeline — it covers port detection, auto-starting the dev server, mapping changed files to routes, and per-route checks with the agent-browser CLI.', 'Use the agent-browser CLI headlessly (open / snapshot -i / click / screenshot): detect the dev port (AGENTS.md, CLAUDE.md, package.json, .env*; default 3000; scan upward for a free one), start the dev server in the background, map the changed files to affected routes, and verify each route renders without errors and its primary interactions work.')}
Changed files: git diff --name-only origin/${BASE}...HEAD (fall back to ${BASE}).
Start the dev server from INSIDE the worktree so you test the merged code, and
kill any server you started when done.${focus}
If no changed file maps to a web route or page, return status "not-applicable" —
do not invent routes. If agent-browser turns out to be unusable, return
"tool-missing". Screenshot every failure.`
  proof = await agent(proofPrompt(''), { label: 'proof', phase: 'Proof', model: 'sonnet', schema: PROOF_SCHEMA }) // browser-proofing is a mechanical pass/fail operation; route results are enumerated, not designed
  if (!proof) log('Proof agent failed — browser testing recorded as not run')
  const failedRoutes = proof ? proof.routes.filter((r) => r.result === 'fail') : []
  if (failedRoutes.length) {
    log(`Proof: ${failedRoutes.length} route(s) failed — one fix round, then retest`)
    const fixRes = await agent(
      `In the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}): browser testing
found these failing routes. Diagnose from the code (diff vs origin/${BASE}...HEAD,
fall back to ${BASE}) and fix the ROOT CAUSE — do not paper over rendering errors.
Run ${recon.testCommand}, stage only the files you changed, and commit
("fix: repair browser-test failures"). Report committed=true ONLY if a fix
commit now exists on the branch.
${failedRoutes.map((r) => `- ${r.route}: ${r.detail}`).join('\n')}`,
      { label: 'proof-fix', phase: 'Proof', model: 'sonnet', schema: { type: 'object', properties: { committed: { type: 'boolean' }, detail: { type: 'string' } }, required: ['committed', 'detail'] } }, // fix is one commit targeting a concrete failing route; scope and steps are fully prescribed
    )
    if (fixRes && fixRes.committed) {
      const retest = await agent(
        proofPrompt(`\nRetest after a fix: previously failing routes were ${failedRoutes.map((r) => r.route).join(', ')} — check them all again.`),
        { label: 'proof-retest', phase: 'Proof', model: 'sonnet', schema: PROOF_SCHEMA }, // retest is identical mechanical pass/fail browsing against a fixed route list
      )
      if (retest) proof = retest
      proofFixSucceeded = !!retest && retest.routes.every((r) => r.result !== 'fail')
      log(`Proof after fix round: ${proof ? proof.status : 'unknown'} — one round only; remaining failures become PR residuals`)
      // The fix round committed code AFTER final validation — re-run the FULL
      // validation so every trace the PR body prints (tests, lint, requirements,
      // deferred questions, post-deploy) reflects the post-fix tree, not stale
      // pre-fix evidence. Fail closed if the re-validation agent dies.
      const regate = await runValidation('proof-revalidate', 'Re-')
      if (validation) {
        validation = regate || { ...validation, testsPass: false, lintPasses: false, notes: `${validation.notes} [proof-fix re-validation agent failed — failing closed]` }
      }
    } else {
      // No fix landed: retesting identical code invites a flaky pass that
      // would masquerade as "diagnosed and fixed". Keep the honest failure.
      log(`Proof fix round landed no commit (${fixRes ? fixRes.detail : 'fixer agent failed'}) — keeping the failed proof; failures become PR residuals`)
    }
  }
}

// ---- Phase: Compound — document solved problems BEFORE Ship so the docs
// commit rides the one push (a post-ship push would restart CI from zero) ----
if (COMPOUND_ENABLED) {
  if (!validation || !validation.testsPass) {
    log('Compound skipped: no verified work to learn from')
  } else if (tailBudget('Compound')) {
    phase('Compound')
    const fixedFindingCount = confirmedCount - residuals.length
    const solvedProblems = [
      ...Object.entries(results)
        .filter(([, r]) => r.status === 'merged' && r.executor && r.executor !== 'claude' && r.executor !== 'codex')
        .map(([id, r]) => `- task ${id} recovered via "${r.executor}": ${r.detail}`),
      ...(fixedFindingCount > 0 ? [`- ${fixedFindingCount} review finding(s) survived adversarial verification and were REPORTEDLY fixed (fixer self-report — confirm each against the actual "fix: address review findings" commits before documenting)`] : []),
      ...(proofFixSucceeded ? ['- browser-proof failures diagnosed and fixed (see "fix: repair browser-test failures" commit; confirm against the diff)'] : []),
    ]
    compounded = await agent(
      `Compound the learnings from a finished implementation run.
${skillGuide('ce-compound', ' in mode:headless.', 'Write solved-problem docs under docs/solutions/<category>/<slug>.md with frontmatter (module, date, problem_type, component, severity) and sections Problem / Symptoms / What Didn\'t Work / Solution / Why This Works / Prevention.')}
Work from INSIDE the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}); read the
branch's commits and the diff vs origin/${BASE}...HEAD (fall back to ${BASE}) for the
full story. Candidate material — problems actually solved AND verified this run:
${solvedProblems.join('\n') || '- none flagged by the orchestrator; check commit history for non-obvious fixes'}
Document ONLY non-trivial solved problems a future implementer would otherwise
re-discover the hard way; a routine implementation with no surprises produces
nothing. If nothing qualifies, write nothing and return documented=false.
If you write docs: validate their frontmatter as the skill requires and commit
("docs(solutions): compound learnings from ${SLUG}"). Do NOT push — the Ship
phase owns pushing.`,
      { label: 'compound', phase: 'Compound', model: 'sonnet', schema: COMPOUND_SCHEMA }, // mechanical authoring from enumerated solved-problem candidates; skill prescribes template and commit
    )
    if (!compounded) log('Compound agent failed — nothing documented')
    else if (!compounded.documented) log(`Compound: nothing qualifying (${compounded.detail})`)
    else {
      log(`Compounded: ${compounded.paths.join(', ')}`)
      // documented=true is a self-report: docs that were never committed would
      // vanish from the shipped branch while the run summary still cites them.
      // One mechanical check per claimed path; failures demote from the result.
      const cv = await agent(
        `Verify claimed solution docs in the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}).
For each path below confirm, strictly from command output you observe in THIS
session: the file exists, it is committed on the branch (git log -1 -- <path>
returns a commit), and its YAML frontmatter parses. Paths:
${compounded.paths.map((p) => `- ${p}`).join('\n')}
Change nothing. Report each failing path with evidence; an empty failures list
asserts you checked every path listed and each one passed.`,
        { label: 'audit-compound', phase: 'Compound', model: 'sonnet', schema: { type: 'object', properties: { failures: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, evidence: { type: 'string' } }, required: ['path', 'evidence'] } }, detail: { type: 'string' } }, required: ['failures', 'detail'] } }, // mechanical exists/committed/frontmatter check over an enumerated path list
      )
      if (!cv) {
        compounded = { ...compounded, detail: `${compounded.detail} [UNVERIFIED — compound-verify agent died; paths stand on the compound agent's self-report]` }
        log("Compound-verify agent died — documented paths stand on the compound agent's self-report, UNVERIFIED")
      } else if (cv.failures.length) {
        const failedPaths = cv.failures.map((f) => f.path)
        compounded = {
          documented: compounded.paths.some((p) => !failedPaths.includes(p)),
          paths: compounded.paths.filter((p) => !failedPaths.includes(p)),
          detail: `${compounded.detail} [audit demoted ${failedPaths.length} claimed path(s): ${cv.failures.map((f) => `${f.path} — ${f.evidence}`).join('; ')}]`,
        }
        log(`Compound-verify: ${failedPaths.length} claimed doc(s) failed the audit — demoted from the result`)
      }
    }
  }
}

// ---- Phase: Ship (lfg steps 4/5/7) — hard gate: tests + lint green, or no push ----
if (!SHIP_ENABLED) {
  ship.detail = 'disabled by args.ship=false'
  log('Ship disabled by args.ship=false — branch stays local')
} else if (!validation) {
  ship.detail = 'no validation result — not shipping'
  log(`Ship skipped: ${ship.detail}`)
} else if (!validation.testsPass || !validation.lintPasses) {
  ship.detail = `gate failed: ${[!validation.testsPass ? 'tests failing' : '', !validation.lintPasses ? 'lint failing' : ''].filter(Boolean).join(', ')} — branch left unpushed for human review`
  log(`Ship skipped: ${ship.detail}`)
} else if (!tailBudget('Ship')) {
  ship.detail = 'token budget floor reached'
} else {
    phase('Ship')
    // Independent ship gate: the push is the one irreversible step, and
    // validation's testsPass/lintPasses are a single agent's self-report. A
    // fresh-context agent re-observes both commands before anything leaves the
    // machine; a contradiction or a dead recheck fails closed — no push.
    shipGate = await agent(
      `Independent ship-gate recheck in ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}).
Run exactly these two commands and report strictly from the exit codes you
observe in THIS session — never from memory, a prior agent's report, or
inference:
1. ${recon.testCommand}
2. ${recon.lintCommand}
evidence: each command's exit code plus its last few output lines.
Do not fix anything, do not commit — observe and report.`,
      { label: 'gate-recheck', phase: 'Ship', model: 'sonnet', schema: { type: 'object', properties: { testsPass: { type: 'boolean' }, lintPasses: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['testsPass', 'lintPasses', 'evidence'] } }, // mechanical run-and-report; both commands are fully specified
    )
    if (!shipGate) {
      ship.detail = 'independent ship-gate recheck agent died — failing closed, branch left unpushed'
      log(`Ship blocked: ${ship.detail}`)
    } else if (!shipGate.testsPass || !shipGate.lintPasses) {
      ship.detail = `independent ship-gate recheck contradicted validation (${[!shipGate.testsPass ? 'tests failing' : '', !shipGate.lintPasses ? 'lint failing' : ''].filter(Boolean).join(', ')}) — branch left unpushed: ${shipGate.evidence}`
      log(`Ship blocked: ${ship.detail}`)
    } else {
    const reqLines = (validation.requirements || []).map((r) => `- ${r.id}: ${r.verdict} — ${r.evidence}`)
    const residualLines = [
      ...residuals.map((f) => `- (${f.severity}, ${f.verdict}) ${f.file} — ${f.title}: ${f.reason}`),
      ...(fixAudit && fixAudit.unaudited.length ? [`- (UNAUDITED) ${fixAudit.unaudited.length} review-fix claim(s) were never independently audited (${fixAudit.unaudited.join('; ')}) — verify the "fix: address review findings" commits by hand`] : []),
      ...reviewDrops.verifierDied.map((k) => `- (UNVERIFIED) ${k} — refuter produced no verdict; dropped fail-closed without verification`),
      ...reviewDrops.reviewerDied.map((k) => `- (COVERAGE GAP) reviewer ${k} produced no result — its entire review perspective is missing from this PR's quality gate`),
      ...simplifyKept.map((k) => `- (info) simplify kept a dead-code candidate, not deleted — ${k}`),
      ...Object.entries(results).filter(([, r]) => r.status !== 'merged').map(([id, r]) => `- task ${id}: ${r.status} — ${r.detail}`),
      ...droppedUnits.map((u) => `- unit ${u.uid} (${u.name}): splitter failed — never executed`),
      ...preSkipped.map((t) => `- task ${t.id}: skipped — ${t.skipReason}`),
      ...(validation.requirements || []).filter((r) => r.verdict !== 'satisfied').map((r) => `- requirement ${r.id} ${r.verdict}: ${r.evidence}`),
      ...(validation.deferredQuestions || []).filter((q) => !q.resolved).map((q) => `- unresolved deferred question: ${q.question} (${q.evidence})`),
      ...(proof ? proof.routes.filter((r) => r.result === 'fail').map((r) => `- browser-proof failure: ${r.route} — ${r.detail}`) : []),
      // proof === null only when the proof agent died (every skip path sets an
      // object): a dead proof must be durable and distinguishable from a skip.
      ...(PROOF_ENABLED && !proof ? ['- (UNVERIFIED) browser-proof agent died — affected routes were never browser-tested'] : []),
    ]
    const proofSummary = !proof ? 'not run (proof agent failed)'
      : proof.status === 'skipped' ? `skipped (${proof.detail})`
      : `${proof.status}${proof.routes.length ? ` (${proof.routes.filter((r) => r.result === 'pass').length}/${proof.routes.length} routes passing)` : ''}`
    const shipRes = await agent(
      `Ship the integration branch from the worktree ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}, base ${BASE}).
${skillGuide('ce-commit-push-pr', ' for commit conventions, push mechanics, and PR creation (write the PR body to a temp file and pass it via --body-file; never stdin).', 'Conventions: conventional commits; stage files by name (never git add -A or .); push with git push -u origin HEAD; create the PR with gh pr create --title "<title>" --body-file <tempfile>.')}
Steps:
1. Plan status flip — locate the plan document INSIDE the worktree: the caller
   referenced it as "${PLAN}"; if that is not already a path under
   ${INTEGRATION_WT}, strip any checkout-root prefix and look for the same
   repo-relative path under the worktree. If no such file exists inside the
   worktree, SKIP this step and report planStatusFlipped=false — NEVER edit any
   file outside ${INTEGRATION_WT}. If found and its YAML frontmatter says
   "status: active", flip it to "status: completed" and stage it.
2. Commit any uncommitted changes (stage by name; nothing uncommitted is also fine).
3. Push the branch: prefer origin; with no upstream, git push --set-upstream <remote> HEAD
   using the first configured remote.
4. gh availability: ${recon.ghAvailable}. Check for an existing open PR
   (gh pr view --json url,state): update its body if one exists, otherwise create
   the PR with base ${BASE}. If gh is unavailable or PR creation fails, still
   push and report prCreated=false with the reason in detail.
PR title: conventional, derived from the plan title "${planDoc.planTitle}".
The PR body must include these sections verbatim (plus whatever the skill prescribes):

## Requirements
${reqLines.join('\n') || '- none traced'}

## Evidence
- Tests: ${validation.testsPass ? 'passing' : 'FAILING'} (${recon.testCommand})
- Lint: ${validation.lintPasses ? 'passing' : 'FAILING'} (${recon.lintCommand})
- Browser proof: ${proofSummary}

${residualLines.length ? `## Residuals
${residualLines.join('\n')}

` : ''}## Post-Deploy Monitoring & Validation
${(validation.postDeployChecks || []).map((c) => `- ${c}`).join('\n') || '- nothing specific noted'}

Report honestly: pushed=true only if the push succeeded; prUrl "" when no PR exists.`,
      { label: 'ship', phase: 'Ship', model: 'sonnet', schema: SHIP_SCHEMA }, // mechanical commit/push/PR creation; steps and PR body sections are fully specified in the prompt
    )
    if (shipRes) ship = { ...shipRes, verified: false }
    else { ship.detail = 'ship agent failed — check the worktree state by hand'; log(`Ship: ${ship.detail}`) }
    if (shipRes) {
      // pushed/prUrl are outward-facing self-reports that gate the CI phase: a
      // wrong one either watches a phantom PR or strands a live one unwatched.
      // One fresh-context observation wins over the self-report, both directions.
      const sv = await agent(
        `Independently verify a ship outcome in ${INTEGRATION_WT} (branch ${INTEGRATION_BRANCH}).
Report strictly from command output you observe in THIS session:
- pushed: does the branch's HEAD exist on its upstream? (git fetch the remote,
  then compare git rev-parse @ against @{u} — pushed means the upstream has
  this HEAD, i.e. ahead 0)
- prUrl: the open PR's URL for this branch from gh pr view --json url,state
  (gh available: ${recon.ghAvailable}); report "" when none exists or gh is unusable.
Change nothing: no push, no commit, no PR edits.`,
        { label: 'ship-verify', phase: 'Ship', model: 'sonnet', schema: { type: 'object', properties: { pushed: { type: 'boolean' }, prUrl: { type: 'string' }, evidence: { type: 'string' } }, required: ['pushed', 'prUrl', 'evidence'] } }, // mechanical observe-and-report against two commands
      )
      if (!sv) {
        log("Ship-verify agent died — ship outcome stands on the ship agent's self-report, UNVERIFIED")
      } else {
        ship.verified = true
        if (sv.pushed !== ship.pushed || (sv.prUrl || '') !== (ship.prUrl || '')) {
          log(`Ship-verify contradicted the ship self-report (claimed pushed=${ship.pushed}, prUrl=${ship.prUrl || '""'}; observed pushed=${sv.pushed}, prUrl=${sv.prUrl || '""'}) — adopting the observed state`)
          ship.detail = `${ship.detail} [self-report corrected by ship-verify: ${sv.evidence}]`
        }
        ship.pushed = sv.pushed
        ship.prUrl = sv.prUrl
      }
    }
    }
}

// ---- Phase: CI (lfg step 8) — watch checks, bounded autofix, durable residuals ----
if (ship.pushed && ship.prUrl) {
  phase('CI')
  let ciStop = ''            // why the loop ended while still red: budget | no-fix-path | rounds
  let ciLastFixPushed = false // a fix landed after the last watch and was never re-watched
  const ciHistory = []       // one line per completed round — each watcher is contextless, so prior outcomes must ride the brief
  for (let attempt = 1; attempt <= CI_ROUNDS; attempt++) {
    if (!tailBudget(`CI attempt ${attempt}`)) { ciStop = 'budget'; break }
    const r = await agent(
      `CI watch iteration ${attempt}/${CI_ROUNDS}.
PR: ${ship.prUrl}
Worktree: ${INTEGRATION_WT}   Branch: ${INTEGRATION_BRANCH}
Test command: ${recon.testCommand}${ciHistory.length ? `
Previous rounds — if the same underlying failure recurs after one of these
pushed fixes, that round's diagnosis was likely wrong or partial: diagnose
afresh from the code (including reverting the prior fix if it proves to be a
symptom patch), and do not repeat an approach listed here:
${ciHistory.join('\n')}` : ''}`,
      { label: `ci-watch-${attempt}`, phase: 'CI', agentType: 'ci-watcher', schema: CI_SCHEMA },
    )
    ci.attempts = attempt
    if (!r) { ci.status = 'unknown'; ci.detail = 'ci watch agent failed'; log('CI watch agent failed — PR checks state unknown'); break }
    ci.status = r.checks
    ci.detail = r.detail
    ciHistory.push(`- round ${attempt}: checks=${r.checks}, fixedAndPushed=${r.fixedAndPushed} — ${String(r.detail).replace(/\s*\n\s*/g, ' ')}`)
    ciLastFixPushed = r.checks === 'red' && r.fixedAndPushed
    if (r.checks !== 'red') break
    if (!r.fixedAndPushed) { ciStop = 'no-fix-path'; break } // nothing was pushed — re-watching would loop on the same failure
    if (attempt === CI_ROUNDS) ciStop = 'rounds'
  }
  // Record a durable PR residual for ANY terminal state that did not confirm
  // green — red (loop exhausted/no fix path), unknown (watcher died), or
  // skipped (budget floor hit before the first watch). Only confirmed green or
  // a repo with no CI ('no-ci') needs no note. Leaving an unverified live PR
  // unannotated would silently drop the autopilot contract.
  const ciSituation = ci.status === 'red'
    ? `checks were RED on the last watch; the autofix loop stopped because ${
        ciStop === 'budget' ? 'the token budget floor was reached'
        : ciStop === 'no-fix-path' ? 'the failure has no fix path (e.g. flaky or external)'
        : `the iteration cap (${CI_ROUNDS}) was reached`}.${
        ciLastFixPushed ? ' NOTE: a fix WAS pushed after that last watch and never re-watched — state that checks may yet turn green.' : ''}`
    : ci.status === 'unknown' ? 'the CI-watch agent died before checks could be confirmed — the PR\'s check state is UNVERIFIED.'
    : ci.status === 'skipped' ? 'CI was never watched — the token budget floor was reached before the first watch. The PR\'s checks are running unverified.'
    : ''
  if (ciSituation) {
    const ciResidualPrompt = `PR ${ship.prUrl} needs a durable note: ${ciSituation}
Last detail: ${ci.detail || 'none'}${ciHistory.length ? `
Round history (include it in the note — it tells the next human or agent what
was already tried):
${ciHistory.join('\n')}` : ''}
Make this durable per the autopilot contract: from ${INTEGRATION_WT}, fetch the
current PR body (gh pr view --json body), append or replace a
"## CI Status Unresolved" section stating the situation above and listing any
failing checks with their links. Write the new body to a temp file and apply it
with gh pr edit --body-file. Do NOT change code.`
    let recorded = await agent(ciResidualPrompt, { label: 'ci-residual', phase: 'CI', model: 'sonnet' })
    if (!recorded) {
      // One bounded retry: a live PR with no CI note silently drops the
      // autopilot contract, so a single recorder crash must not be terminal.
      log('CI residual recorder died — retrying once before leaving the PR unannotated')
      recorded = await agent(ciResidualPrompt, { label: 'ci-residual-retry', phase: 'CI', model: 'sonnet' })
    }
    ci.residualRecorded = !!recorded
    log(recorded
      ? `CI unresolved (${ci.status}) — recorded in the PR body, not looping further`
      : 'CI residual recorder FAILED — the PR body does NOT carry the unresolved CI status')
  }
} else if (ship.pushed) {
  ci.detail = 'branch pushed but no PR — nothing to watch'
  log('CI watch skipped: no PR exists')
}

} // end if (!halted)

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
  nitsDeferred,
  effortFloor: EFFORT_FLOOR || 'none',
  codexCircuitBreakerTripped: codexBroken,
  confirmedReviewFindings: confirmedCount,
  reviewDrops,
  reviewStats,
  residualReviewFindings: residuals,
  fixAudit,
  simplifyKept,
  validation,
  shipGate,
  proof,
  ship,
  ci,
  compound: compounded,
}
