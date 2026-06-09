# The Coordinator and the Agent Pipeline

This document is the authoritative reference for anyone authoring or modifying dynamic workflows in this repo. It describes the two-layer model — the coordinator script body and the agent workers — and the pipeline primitives that connect them.

---

## 1. What a Dynamic Workflow Is

A dynamic workflow is a JavaScript script that orchestrates many subagents at scale. Claude writes the script for the task; the runtime executes it in the background while the main session stays responsive.

The defining idea: the plan moves into code, not the model's context. The script holds the loop, the branching, and the intermediate results. The main session's context holds only the final answer.

Philosophy: "a harness for every task" — instead of a fixed multi-agent structure, the script encodes exactly the structure the task needs.

---

## 2. The Coordinator

### The script body IS the coordinator

The script body owns all control flow: loops, conditionals, fan-out, ordering, and gating. It holds all intermediate results in plain variables.

```js
export const meta = {
  name: "example-workflow",
  description: "Illustrates coordinator control flow",
  phases: [
    { title: "Discovery", detail: "Find all relevant files" },
    { title: "Analysis", detail: "Analyse each file" },
    { title: "Synthesis", detail: "Produce the final report" },
  ],
};

phase("Discovery");
const fileList = await agent("List every TypeScript file under src/. Return one path per line.", {
  label: "discover files",
  phase: "Discovery",
  model: "sonnet",
});

const files = fileList.split("\n").filter(Boolean);

phase("Analysis");
const analyses = await pipeline(
  files,
  async (file, _original, index) => {
    return agent(`Analyse the file at ${file}. Return a JSON object with keys: path, issues.`, {
      label: `analyse ${file}`,
      phase: "Analysis",
      schema: { type: "object", properties: { path: { type: "string" }, issues: { type: "array" } }, required: ["path", "issues"] },
    });
  }
);

phase("Synthesis");
const report = await agent(
  `Synthesise the following per-file analyses into a final report:\n${JSON.stringify(analyses.filter(Boolean))}`,
  { label: "synthesise", phase: "Synthesis" }
);

log(report);
```

### The coordinator has NO I/O access — ever

This is the single most important constraint. State it plainly and follow it without exception:

**The coordinator has NO filesystem access, NO shell access, NO git access, NO network access, and NO Node.js API access. It CANNOT read or write files and it CANNOT run commands. Every real-world action — reading code, editing files, running tests, git operations, web requests — is performed by AGENTS, never by the coordinator.**

Violating this constraint is not a matter of style. The coordinator's execution environment does not provide these capabilities. Attempts to use them will fail or silently do nothing. If you need data from the filesystem, spawn an agent to read it. If you need to run a shell command, spawn an agent to run it.

### Language: plain JavaScript, not TypeScript

The coordinator is plain JavaScript. TypeScript does not parse. Do not add type annotations, interfaces, or generics to coordinator code.

```js
// WRONG — TypeScript, will fail to parse
const results: string[] = [];
function summarise(items: string[]): Promise<string> { ... }

// CORRECT — plain JavaScript
const results = [];
async function summarise(items) { ... }
```

### Async context

The script body runs in an async context. Use `await` directly at the top level without wrapping in an async function.

```js
// CORRECT — top-level await
const result = await agent("Do something.", { label: "step 1" });
log(result);
```

### Forbidden built-ins: the three time-and-randomness forms

Three JavaScript built-in calls are forbidden because they break deterministic resume. They throw at parse or run time:

- `Date.now()` — the `Date` now-timestamp static call
- `Math.random()` — the `Math` random call
- `new Date()` — the no-argument `Date` constructor

Do not use any of these in coordinator code.

**Workarounds:**

- For timestamps: pass the timestamp via `args` before the run; stamp results after the run completes.
- For randomness: vary an agent's prompt or label by its index — the index is deterministic and unique per item.

```js
// WRONG — forbidden
const ts = Date.now();
const rand = Math.random();
const now = new Date();

// CORRECT — timestamp via args
const { startedAt } = args; // caller passes { startedAt: "2026-06-07T10:00:00Z" }

// CORRECT — index-based variation instead of random
const analyses = await pipeline(
  candidates,
  async (item, _original, index) => {
    return agent(`Approach ${index}: analyse ${item} using strategy ${index % 3}.`, { label: `analyse-${index}` });
  }
);
```

### The meta export

The `meta` export must be the first statement in the script. It must be a pure object literal — no variables, no function calls, no spreads, no interpolation. `name` and `description` are required. `phases` is optional; its `title` values must match the `phase()` calls in the script body.

```js
// CORRECT — pure literal, first statement
export const meta = {
  name: "audit-api-surface",
  description: "Audit the public API surface for breaking changes",
  phases: [
    { title: "Collect", detail: "Collect all exported symbols" },
    { title: "Compare", detail: "Compare each symbol against the baseline" },
    { title: "Report", detail: "Produce the diff report" },
  ],
};

// WRONG — uses a variable
const NAME = "audit-api-surface";
export const meta = { name: NAME, description: "..." }; // fails

// WRONG — uses a function call
export const meta = { name: buildName(), description: "..." }; // fails
```

---

## 3. Agents: the Workers That Do Everything

An agent is a subagent with its own fresh context window and an isolated goal. Agents are the only things that can do I/O. The coordinator spawns agents; agents do the work.

```js
const result = await agent("Read src/api.ts and list every exported function name. Return one name per line.", {
  label: "list exports",
  phase: "Collect",
  model: "sonnet",
});
```

### Structured output

Pass `opts.schema` (a JSON Schema) to force structured output. The subagent calls a structured-output tool and `agent()` returns the validated object directly — no parsing required. The model retries on schema mismatch.

```js
const finding = await agent(
  `Analyse the file at ${filePath}. Return a JSON object.`,
  {
    label: `analyse ${filePath}`,
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string" },
      },
      required: ["path", "severity", "summary"],
    },
  }
);
// finding is already { path, severity, summary } — no JSON.parse needed
```

### Null return

`agent()` returns `null` if the user skips the agent mid-run or the subagent dies on a terminal error after retries. Filter with `.filter(Boolean)` before using results.

```js
const results = await parallel([
  () => agent("Task A", { label: "a" }),
  () => agent("Task B", { label: "b" }),
]);
const valid = results.filter(Boolean);
```

### Grounding: pass agents everything they need

A context-less agent knows only what its prompt says. The coordinator MUST pass each agent the data, the file paths to read, and the authoritative facts it needs. An agent cannot see the coordinator's variables. An agent cannot see another agent's work unless you pass it explicitly.

```js
// WRONG — agent has no idea what "the files" are
const analysis = await agent("Analyse the files.", { label: "analyse" });

// CORRECT — agent receives the specific path
const analysis = await agent(
  `Read the file at src/payment/processor.ts and list every function that calls an external API.`,
  { label: "analyse processor" }
);

// CORRECT — coordinator holds prior result and passes it forward
const fileList = await agent("List all .ts files under src/. One path per line.", { label: "list" });
const synthesis = await agent(
  `Here is a list of TypeScript files:\n${fileList}\n\nFor each file, describe its primary responsibility.`,
  { label: "describe files" }
);
```

### Agent options

| Option | Purpose |
|---|---|
| `label` | Display label in the /workflows view |
| `phase` | Assigns the agent to a progress phase group |
| `schema` | JSON Schema — forces structured output |
| `model` | `sonnet`, `opus`, or `haiku`; default inherits the session model |
| `isolation: "worktree"` | Runs the agent in a fresh git worktree; use ONLY when agents mutate files in parallel and would otherwise conflict; expensive (~200–500 ms + disk per agent) |
| `agentType` | Custom subagent type from the Agent registry — environment-specific, NOT portable |

### Model policy for this repo

- Default: omit `model` to inherit the session model.
- Grunt work (search, fetch, extraction, mechanical authoring, routine verification): use `model: "sonnet"`.
- Steps that genuinely need top-tier reasoning: use `model: "opus"`.

---

## 4. The Agent Pipeline

### `pipeline()`: multi-stage processing without a barrier

`pipeline(items, stage1, stage2, ...)` runs each item through all stages independently. There is NO barrier between stages. Item A can be in stage 3 while item B is still in stage 1. Wall-clock time equals the slowest single-item chain, not the sum of the slowest stage across all items.

Each stage callback receives three arguments: `(prevResult, originalItem, index)`.

- `prevResult`: the return value of the previous stage (or the original item for stage 1).
- `originalItem`: the original item from the input array, unchanged.
- `index`: the zero-based position of this item in the input array.

A stage that throws drops that item to `null` and skips its remaining stages. `pipeline()` is the DEFAULT for multi-stage work.

```js
const files = ["src/a.ts", "src/b.ts", "src/c.ts"];

const reports = await pipeline(
  files,
  // Stage 1: read the file
  async (file, _original, index) => {
    const content = await agent(`Read ${file} and return its full text.`, {
      label: `read-${index}`,
      phase: "Read",
      model: "sonnet",
    });
    return { file, content };
  },
  // Stage 2: analyse the content from stage 1
  async ({ file, content }, _original, index) => {
    const analysis = await agent(
      `Analyse this file:\nPath: ${file}\n\nContent:\n${content}\n\nReturn a JSON object with keys: path, issues.`,
      {
        label: `analyse-${index}`,
        phase: "Analyse",
        schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            issues: { type: "array", items: { type: "string" } },
          },
          required: ["path", "issues"],
        },
      }
    );
    return analysis;
  },
  // Stage 3: score each finding
  async (analysis, _original, index) => {
    const scored = await agent(
      `Score the severity of these issues:\n${JSON.stringify(analysis.issues)}\nReturn a JSON object with keys: path, score (0-10).`,
      {
        label: `score-${index}`,
        phase: "Score",
        model: "sonnet",
        schema: {
          type: "object",
          properties: { path: { type: "string" }, score: { type: "number" } },
          required: ["path", "score"],
        },
      }
    );
    return scored;
  }
);

const valid = reports.filter(Boolean);
```

#### ASCII diagram: items flowing through pipeline stages without a barrier

```
items:   [ A ]         [ B ]         [ C ]
          |             |             |
Stage 1: [A.read]      [B.read]      [C.read]
          |             |
Stage 2: [A.analyse]  [B.analyse]   [C.read still running...]
          |
Stage 3: [A.score]    [B.analyse still running...]
                                      |
                                     [C.analyse]
                                                  |
                                                 [C.score]
          |             |             |
done:    [A.result]   [B.result]   [C.result]
```

No item waits for another item to finish its stage before advancing. The pipeline returns when every item has completed every stage (or has been dropped to `null`).

### `parallel()`: a barrier that awaits all

`parallel(thunks)` runs an array of zero-argument thunks concurrently and waits for ALL of them before returning. It is a barrier.

```js
const [readmeResult, changelogResult, licenseResult] = await parallel([
  () => agent("Summarise README.md.", { label: "readme", model: "sonnet" }),
  () => agent("Summarise CHANGELOG.md.", { label: "changelog", model: "sonnet" }),
  () => agent("Summarise LICENSE.", { label: "license", model: "sonnet" }),
]);
```

A thunk that throws, or whose agent errors, resolves to `null` in the result array. The `parallel()` call itself never rejects. Filter with `.filter(Boolean)`.

### When to use `pipeline()` vs `parallel()`

Use `pipeline()` by default for any multi-stage, multi-item work.

Reach for a `parallel()` barrier ONLY when a step genuinely needs ALL prior results together at once:
- Deduplication or merging across the full result set.
- Early exit when the count of valid results is zero.
- Cross-referencing across all results (e.g. "find the item most unlike the others").

"I need to flatten, map, or filter first" is NOT a reason to use a barrier. Do that work inside a `pipeline()` stage or in plain coordinator JavaScript after `pipeline()` returns.

```js
// WRONG — using parallel() as a mere map
const summaries = await parallel(files.map(f => () => agent(`Summarise ${f}.`)));

// CORRECT — pipeline() for per-item work with no cross-item dependency
const summaries = await pipeline(
  files,
  async (file, _original, index) => agent(`Summarise ${file}.`, { label: `sum-${index}`, model: "sonnet" })
);

// CORRECT — parallel() only when the step genuinely needs all results at once
const allSummaries = await pipeline(
  files,
  async (file, _original, i) => agent(`Summarise ${file}.`, { label: `sum-${i}`, model: "sonnet" })
);
const merged = allSummaries.filter(Boolean);
// Now run ONE agent that needs ALL summaries at once
const deduped = await parallel([
  () => agent(`Find duplicate themes across these summaries:\n${JSON.stringify(merged)}`, { label: "dedup" }),
]);
```

---

## 5. Coordinator Responsibility vs Agent Responsibility

| Responsibility | Coordinator | Agent |
|---|---|---|
| Control flow (loops, conditionals, fan-out, ordering) | Yes | No |
| Holding intermediate results between steps | Yes | No |
| Deciding which items go to which stage | Yes | No |
| Logging progress messages | Yes | No |
| Reading files from the filesystem | No | Yes |
| Writing or editing files | No | Yes |
| Running shell commands | No | Yes |
| Git operations | No | Yes |
| Making network or web requests | No | Yes |
| Running tests | No | Yes |
| Producing structured data from raw text | No | Yes |
| Grounding: passing data/paths to workers | Yes (must do this) | No (cannot see coordinator vars) |

The coordinator routes, sequences, and aggregates. Agents act.

---

## 6. Other Coordinator Primitives

### `phase(title)`

Start a named phase. Subsequent `agent()` calls group under it in the progress display. Inside `pipeline()` or `parallel()`, prefer `opts.phase` on each agent call to avoid races on the global phase state.

```js
phase("Collect");
// ... agents with phase: "Collect"

phase("Analyse");
// ... agents with phase: "Analyse"
```

### `log(message)`

Emit a progress or narrator line to the user.

```js
log(`Processing ${files.length} files across 3 stages.`);
```

### `workflow(nameOrRef, args)`

Run another workflow inline as a sub-step. It shares the run's concurrency cap, agent counter, abort signal, and token budget. Nesting is one level only — calling `workflow()` inside a child workflow throws.

```js
const subResult = await workflow("lint-and-fix", { paths: files });
```

### `budget`

An object with `total` (number or null), `spent()`, and `remaining()`. `total` is the turn's token target (null if unset). `spent()` is output tokens across the main loop and all workflows (a shared pool). `remaining()` is `max(0, total − spent())` or `Infinity` if no target is set. The target is a **hard ceiling**: once `spent()` reaches `total`, further `agent()` calls throw. Use `budget.total` to guard any loop that might run indefinitely — if no token target is set, `remaining()` is `Infinity` and the loop runs to the agent cap.

```js
// WRONG — infinite loop if budget.total is null
while (budget.remaining() > 0) {
  // ...
}

// CORRECT — guard on budget.total first
if (budget.total !== null) {
  while (budget.remaining() > 0) {
    // ...
  }
}
```

### `args`

The value passed as the workflow's `args` input, verbatim. Pass arrays and objects as real JSON values, not a stringified blob.

```js
const { targetDir, maxFiles } = args ?? {};
```

---

## 7. Hard Limits

- Concurrent agents per workflow: min(16, cpu_cores - 2). Excess calls queue automatically.
- Total agents per workflow lifetime: 1000.
- Items per single `parallel()` or `pipeline()` call: 4096.
- Workflow nesting depth: 1 level. `workflow()` cannot call `workflow()`.

---

## 8. Execution and Resume

Workflows run in the background. The tool returns immediately with a run ID; a notification arrives on completion. Watch live with the `/workflows` view.

Subagents spawned by a workflow run in `acceptEdits` permission mode: file edits are auto-approved.

The runtime journals each agent's result. Relaunch with the same `scriptPath` and `resumeFromRunId` to resume — completed agents return cached results instantly; the first edited or new agent and everything after it runs live. Resume is same-session only.

---

## 9. Canonical Patterns

### Classify-and-act

```js
const category = await agent(`Classify this issue: "${issueText}". Return one of: bug, feature, docs.`, {
  label: "classify",
  model: "sonnet",
});

let result;
if (category.trim() === "bug") {
  result = await agent(`Propose a fix for this bug: "${issueText}"`, { label: "fix-bug" });
} else if (category.trim() === "feature") {
  result = await agent(`Write a spec for this feature: "${issueText}"`, { label: "spec-feature" });
} else {
  result = await agent(`Draft a docs update for: "${issueText}"`, { label: "update-docs" });
}
```

### Fan-out-and-synthesize

```js
const modules = ["auth", "payments", "notifications", "storage"];
const analyses = await pipeline(
  modules,
  async (mod, _original, i) => agent(`Audit the ${mod} module for security issues.`, {
    label: `audit-${mod}`,
    phase: "Audit",
    model: "sonnet",
  })
);

const synthesis = await agent(
  `Synthesise these module audits into a priority-ordered remediation plan:\n${JSON.stringify(analyses.filter(Boolean))}`,
  { label: "synthesise", phase: "Synthesise" }
);
```

### Adversarial verification

```js
const finding = await agent(`Find all uses of eval() in src/. Return a JSON array of { file, line, snippet }.`, {
  label: "find-eval",
  schema: { type: "array", items: { type: "object" } },
});

const verifications = await parallel(
  finding.map((f, i) => () =>
    agent(
      `ATTEMPT TO REFUTE this finding. Is this actually a use of eval()? Finding: ${JSON.stringify(f)}. Return JSON { confirmed: boolean, reason: string }.`,
      {
        label: `verify-${i}`,
        phase: "Verify",
        model: "sonnet",
        schema: {
          type: "object",
          properties: { confirmed: { type: "boolean" }, reason: { type: "string" } },
          required: ["confirmed", "reason"],
        },
      }
    )
  )
);

const confirmed = finding.filter((_, i) => verifications[i]?.confirmed);
```

### Bounded loop-until-dry

```js
let round = 0;
let remaining = await agent("List all TODO comments in src/. Return JSON array of { file, line, text }.", {
  label: "initial-scan",
  schema: { type: "array" },
});

while (remaining.length > 0 && round < 5) {
  log(`Round ${round + 1}: ${remaining.length} TODOs remaining.`);
  const fixes = await pipeline(
    remaining,
    async (todo, _original, i) =>
      agent(`Resolve this TODO: ${JSON.stringify(todo)}. Edit the file directly.`, {
        label: `fix-${round}-${i}`,
        phase: `Round ${round + 1}`,
        model: "sonnet",
      })
  );
  remaining = await agent("Re-scan src/ for remaining TODO comments. Return JSON array.", {
    label: `rescan-${round}`,
    schema: { type: "array" },
  });
  round++;
}

if (remaining.length > 0) {
  log(`Stopped after ${round} rounds. ${remaining.length} TODOs unresolved: ${JSON.stringify(remaining)}`);
}
```

---

## Sources

- [Official workflow docs](https://code.claude.com/docs/en/workflows)
- [Blog: A harness for every task — dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog: Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Skills](https://code.claude.com/docs/en/skills)
- [Managed Agents SDK (headless/standalone contrast)](https://platform.claude.com/docs/en/managed-agents/overview)
