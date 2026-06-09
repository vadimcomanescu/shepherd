# Constraints, limits, and gotchas

This document is the authoritative reference for every hard limit, coordinator restriction, execution semantic, and budget rule that applies to dynamic workflows in this repo. Every claim is grounded in the SPEC. If a behavior is not described here, do not assume it exists.

---

## 1. Concurrency cap

**The rule.** The number of agents that can run concurrently is capped at `min(16, cpu_cores - 2)` per workflow. Excess calls queue automatically and run as slots free.

**Why.** The runtime enforces this to prevent runaway resource exhaustion on the host machine. The cap is per-workflow, not per-pipeline or per-parallel call.

**What to do instead.** You may still pass many items to `parallel()` or `pipeline()` — the runtime queues them. Do not try to manage concurrency yourself; do not artificially batch below the cap. Trust the queue.

```js
// Correct: pass all 200 items; the runtime queues down to the cap automatically.
const results = await pipeline(
  items,          // up to 4096 items
  async (item) => agent(`Process: ${item}`, { label: item, phase: 'process' }),
);
```

---

## 2. Total-agent ceiling

**The rule.** A workflow may spawn at most 1000 agents across its entire lifetime.

**Why.** This is a runaway-loop backstop, not a design target. Hitting it indicates a logic error (unbounded loop, exponential fan-out).

**What to do instead.** Design workflows with bounded fan-out. If you are looping until a stop condition, guard on `budget.total` and on an explicit iteration counter. Log what was dropped when coverage is bounded.

```js
let round = 0;
const MAX_ROUNDS = 10;
while (round < MAX_ROUNDS) {
  const findings = await agent('Find more issues', { label: `round-${round}` });
  if (!findings) break;
  round++;
}
log(`Stopped after ${round} rounds`);
```

---

## 3. Items-per-call limit for `parallel()` and `pipeline()`

**The rule.** A single `parallel()` or `pipeline()` call accepts at most 4096 items.

**Why.** Above 4096, the runtime rejects the call. This is a hard parse/run-time check, not a soft warning.

**What to do instead.** If you have more than 4096 items, split them into batches and call `pipeline()` or `parallel()` on each batch sequentially, then merge results in script variables.

```js
const BATCH = 4096;
const allResults = [];
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  const batchResults = await pipeline(
    batch,
    async (item) => agent(`Handle: ${item}`, { label: item }),
  );
  allResults.push(...batchResults.filter(Boolean));
}
```

---

## 4. One-level nesting for `workflow()`

**The rule.** `workflow()` can be called from a coordinator to run a child workflow. A child workflow cannot call `workflow()` — the call throws at runtime.

**Why.** Recursive or deeply nested orchestration produces unpredictable resource trees and makes resume semantics undefined. The runtime enforces exactly one level.

**What to do instead.** Flatten your design. If a child workflow logically needs sub-orchestration, inline that logic (as agents or pipeline stages) inside the child, or restructure so the parent coordinator owns all the fan-out.

```js
// ALLOWED: parent coordinator calls a child workflow.
const summary = await workflow('summarize-module', { path: 'src/auth' });

// ILLEGAL: inside 'summarize-module', calling another workflow throws.
// const sub = await workflow('helper', args); // DO NOT DO THIS
```

The child shares the parent's concurrency cap, agent counter, abort signal, and token budget.

---

## 5. Coordinator restrictions: no I/O of any kind

**The rule.** The coordinator (the script body) has no filesystem access, no shell access, no git access, no network access, and no Node.js API access. It cannot read or write files, run commands, or make HTTP requests.

**Why.** The coordinator is pure orchestration logic. Mixing I/O into the coordinator breaks deterministic resume: the runtime journals agent results and replays them on resume, but coordinator-level I/O would run again and produce divergent state.

**What to do instead.** Every real-world action (read a file, write a file, run git, call a URL, run tests) must be performed by an agent. The coordinator calls agents, collects their return values, and uses those values in subsequent logic.

```js
// WRONG: coordinator tries to read a file directly.
// const src = fs.readFileSync('src/index.ts', 'utf8'); // THROWS — no Node API

// CORRECT: delegate reading to an agent.
const src = await agent(
  'Read the file src/index.ts and return its full contents verbatim.',
  { label: 'read-index', model: 'sonnet' },
);
```

---

## 6. Coordinator is plain JavaScript, not TypeScript

**The rule.** The coordinator script must be plain JavaScript. TypeScript syntax — type annotations, interfaces, generics, `as` casts, `satisfies`, `readonly`, enum declarations — fails to parse.

**Why.** The runtime executes the script directly as JavaScript. There is no TypeScript compilation step.

**What to do instead.** Write all coordinator logic in plain JS. Type safety belongs in the agent prompts (use `opts.schema` for structured output) and in any tooling outside the script.

```js
// WRONG: TypeScript syntax fails at parse time.
// const items: string[] = [];
// function process(x: string): Promise<string> { ... }

// CORRECT: plain JS throughout.
const items = [];
async function process(x) {
  return agent(`Process ${x}`, { model: 'sonnet' });
}
```

---

## 7. Three forbidden time-and-randomness built-ins

**The rule.** Three specific JavaScript expressions throw at parse/run time inside a coordinator:

1. `Date.now()` — the static method call that returns the current timestamp as milliseconds.
2. `Math.random()` — the call that returns a pseudo-random float.
3. `new Date()` — the no-argument Date constructor call that captures the current moment.

**Why.** These expressions are non-deterministic. On resume, the runtime replays the coordinator from the top, re-executing all coordinator code. If `Date.now()` or `Math.random()` ran again, they would return different values, producing divergent state and breaking the resume guarantee.

**What to do instead.**

- For timestamps: pass a timestamp via the workflow's `args` input before the run starts, then read it from `args` inside the coordinator. If you need to record when a result was produced, stamp it after the run completes outside the workflow.
- For unique labels or variation: vary an agent's prompt or `label` option by its index in the array rather than by a random value.

```js
// WRONG: all three forms throw at runtime.
// const ts = Date.now();
// const r  = Math.random();
// const d  = new Date();

// CORRECT: pass timestamps via args.
export const meta = {
  name: 'timestamped-sweep',
  description: 'Sweep with a caller-supplied timestamp.',
};

const startedAt = args?.startedAt; // caller passes: workflow('timestamped-sweep', { startedAt: Date.now() })

// CORRECT: vary by index instead of random.
const results = await parallel(
  items.map((item, i) => () =>
    agent(`Approach ${i}: ${item}`, { label: `agent-${i}`, phase: 'work' }),
  ),
);
```

---

## 8. The `meta` export: must be first, must be a pure literal

**The rule.** `export const meta = { ... }` must be the very first statement in the script. The value must be a pure object literal: no variables, no function calls, no spreads, no template literals, no interpolation. `name` and `description` are required. `phases` is optional: an array of `{ title, detail }` objects whose titles must match the `phase()` calls used in the script.

**Why.** The runtime reads `meta` at load time to register the workflow, display progress, and validate phase labels. A non-literal `meta` cannot be statically analyzed and fails to load.

**What to do instead.** Write the literal inline. Cross-reference the phase titles by string identity.

```js
// CORRECT: pure literal, first statement.
export const meta = {
  name: 'audit-codebase',
  description: 'Audit every module for security issues.',
  phases: [
    { title: 'Collect', detail: 'Enumerate modules' },
    { title: 'Audit',   detail: 'Run an agent per module' },
    { title: 'Report',  detail: 'Synthesize findings' },
  ],
};

phase('Collect');
// ...
phase('Audit');
// ...
phase('Report');
```

---

## 9. Background execution and the `/workflows` view

**The rule.** A workflow runs in the background. The `workflow()` tool call returns immediately with a run ID; a notification arrives when the run completes. The main session stays responsive during execution.

**Why.** Long workflows may spawn hundreds of agents over many minutes. Blocking the main session for the duration would be unusable.

**What to do.** Use the `/workflows` view to monitor a live or completed run. The view shows phases, agent counts, token totals, and elapsed time. Drill into any agent to inspect its prompt, tool calls, and result.

---

## 10. Subagent permission mode: `acceptEdits`

**The rule.** Subagents spawned by a workflow run in `acceptEdits` permission mode. Their file edits are auto-approved regardless of the session's permission mode. Shell, web, and MCP tools that are not in the allowlist can still prompt mid-run.

**Why.** Workflows are designed for unattended batch execution. Auto-approving file edits allows the workflow to make progress without human interruption on every write. Non-allowlisted tools retain their prompt to avoid unintended side-effects.

**What to do.** Ensure that any shell or MCP tool an agent needs is in the project allowlist before starting a workflow that should run fully unattended. Do not assume all tools are auto-approved.

---

## 11. Resume semantics: same session, same script, same args

**The rule.** Relaunching a workflow with the same `scriptPath` and `resumeFromRunId` resumes the run. Completed agents return cached results instantly; the first edited or new agent and everything after it runs live. Same script plus same args equals a full cache hit. Resume is same-session only — it does not persist across Claude Code restarts.

**Why.** The runtime journals each agent's result during the run. On resume, it replays the coordinator code from the top and substitutes cached results for agents whose prompts and options match exactly. Anything that changed runs fresh.

**What to do.**
- Keep agent prompts and `opts` deterministic (no `Date.now()`, no `Math.random()`) so they hash the same on re-run.
- If you close the session, you cannot resume a prior run — start a new run instead.
- Pass an identical `args` object for a full cache hit; any change to `args` is seen as a different run.

```js
// Resume pattern (invoked by the caller, not inside the script):
// workflow('my-script', args, { resumeFromRunId: 'run_abc123' });
// Completed agents return instantly; only new/changed agents run.
```

---

## 12. Cost awareness: shared pool, token budget, and test-on-a-slice

**The rule.** A workflow can spawn many agents, and one run can use meaningfully more tokens than doing the same task in conversation. Runs count toward plan usage and rate limits.

**Why.** Each agent has its own context window. Hundreds of agents means hundreds of context windows, which compounds cost rapidly.

**What to do first.** Test on a small slice before running at full scale. Use `log()` to report how many items were processed and how many were dropped.

### Budget object

The `budget` object is available in every coordinator:

| Property | Type | Meaning |
|---|---|---|
| `budget.total` | `number \| null` | The turn's token target. `null` if no target is set. |
| `budget.spent()` | `number` | Output tokens consumed so far across the main loop and all workflows (shared pool). |
| `budget.remaining()` | `number \| Infinity` | `max(0, total - spent())`, or `Infinity` if `total` is `null`. |

**The rule.** `budget.total` is a hard ceiling. Once `budget.spent()` reaches `budget.total`, further `agent()` calls throw. Guard any loop that reads `budget.remaining()` on `budget.total`; if `total` is `null`, `remaining()` returns `Infinity` and an unguarded budget loop runs until the 1000-agent ceiling.

```js
// WRONG: budget loop without guard — runs to 1000-agent cap when total is null.
// while (budget.remaining() > 0) { ... }

// CORRECT: guard on budget.total before entering a budget-sensitive loop.
if (budget.total !== null) {
  while (budget.remaining() > 500) {
    const result = await agent('Do more work', { label: 'incremental' });
    if (!result) break;
  }
} else {
  // No budget target set; use a fixed-count loop instead.
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const result = await agent('Do more work', { label: `round-${i}` });
    if (!result) break;
  }
}
```

The budget pool is shared across the current workflow and any child workflows it spawns with `workflow()`.

---

## 13. Model policy for this repo

**The rule.** Three tiers apply:

| Tier | When to use | How to set |
|---|---|---|
| Inherit | Default for all agents | Omit `model` from `opts` entirely |
| `'sonnet'` | Grunt work: search, fetch, extraction, mechanical authoring, routine verification | `model: 'sonnet'` in `opts` |
| `'opus'` | Steps that genuinely need top-tier reasoning | `model: 'opus'` in `opts` |

**Why.** Using opus indiscriminately multiplies cost. Sonnet handles the vast majority of mechanical tasks at a fraction of the cost. Inherit lets the session operator set the default for the run without hard-coding it into every agent call.

**What to do.** Default to omitting `model`. Annotate each agent call with the tier and reason when you do override.

```js
// Default: inherit session model.
const outline = await agent('List all TypeScript files under src/', { label: 'list-files' });

// Sonnet for grunt work.
const content = await agent(`Read and return the contents of ${path}`, {
  label: `read-${path}`,
  model: 'sonnet', // grunt: file read
});

// Opus only where reasoning demands it.
const verdict = await agent(
  `Given these 40 findings, identify which three represent the highest systemic risk and explain why: ${findings}`,
  { label: 'risk-rank', model: 'opus' }, // top-tier reasoning required
);
```

---

## 14. Grounding context-less agents

**The rule.** Each agent has its own fresh context window and sees only what its prompt contains. It cannot access the coordinator's variables, other agents' results, or any state outside its prompt.

**Why.** Agents are isolated workers. The coordinator is the only entity that holds shared state.

**What to do.** The coordinator must pass each agent exactly the data, file paths, and facts it needs. Embed data inline in the prompt string, or instruct the agent to read specific named paths.

```js
// WRONG: agent cannot see `sourceCode` — it's a coordinator variable.
// const review = await agent('Review the code.', { label: 'review' });

// CORRECT: embed the data the agent needs directly in the prompt.
const review = await agent(
  `Review this code for security issues:\n\n\`\`\`ts\n${sourceCode}\n\`\`\`\n\nReturn a JSON array of findings.`,
  { label: 'review', schema: { type: 'array', items: { type: 'object' } } },
);
```

---

## 15. `pipeline()` is the default; `parallel()` only when a true barrier is needed

**The rule.** Use `pipeline()` by default for multi-stage work. Use `parallel()` only when a stage genuinely requires ALL prior results together before proceeding — for deduplication across the full set, early-exit when the count reaches zero, or cross-referencing all other results.

**Why.** `pipeline()` has no barrier between stages: item A can be in stage 3 while item B is still in stage 1. Wall-clock time equals the slowest single-item chain, not the sum of the slowest time per stage. `parallel()` is a barrier — it waits for all thunks to resolve before returning, which adds latency when you do not need the full set.

"I need to flatten, map, or filter first" is not a barrier reason — do that in a pipeline stage.

```js
// CORRECT: pipeline for independent per-item multi-stage work.
const reports = await pipeline(
  modules,
  async (mod) => agent(`Extract exports from ${mod}`, { label: `extract-${mod}`, phase: 'Extract' }),
  async (exports, mod) => agent(`Check ${mod} exports for breaking changes: ${exports}`, { label: `check-${mod}`, phase: 'Check' }),
);

// CORRECT: parallel only when all results are needed before the next step.
const drafts = await parallel(
  candidates.map((c) => () => agent(`Draft solution for ${c}`, { label: c, phase: 'Draft' })),
);
const deduplicated = drafts.filter(Boolean);
// Now deduplicated contains ALL drafts — needed for dedup across the full set.
const final = await agent(
  `These ${deduplicated.length} drafts may overlap. Deduplicate and keep the best three:\n${deduplicated.join('\n---\n')}`,
  { label: 'dedup', model: 'opus' },
);
```

---

## Sources

- [Official dynamic workflows docs](https://code.claude.com/docs/en/workflows)
- [Blog: A harness for every task — dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Subagents reference](https://code.claude.com/docs/en/sub-agents)
- [Skills reference](https://code.claude.com/docs/en/skills)
- [Managed Agents SDK — headless/standalone contrast](https://platform.claude.com/docs/en/managed-agents/overview)
