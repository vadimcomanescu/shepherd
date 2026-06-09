# Primitives — the workflow JS API reference

The primitives documented here are every function and global available in the coordinator body of a dynamic workflow. This file is the authoritative reference for agents authoring or modifying workflows in this repo. Every claim is grounded in the SPEC; nothing here is invented.

**The coordinator is plain JavaScript, NOT TypeScript.** Type annotations, interfaces, and generics fail to parse. The body runs in an async context — use `await` directly at the top level.

---

## The `meta` export

Every workflow script MUST begin with a `meta` export as its first statement. The `meta` block is a **pure literal** — no variables, no function calls, no spreads, no template interpolation. `name` and `description` are required. `phases` is optional.

```js
export const meta = {
  name: "audit-dependencies",
  description: "Scans all packages for outdated or vulnerable dependencies and reports findings.",
  phases: [
    { title: "Discover", detail: "Find all package manifests" },
    { title: "Audit",    detail: "Run per-package vulnerability check" },
    { title: "Synthesize", detail: "Merge and rank findings" }
  ]
};
```

`phases` is an array of objects, each with `title` and `detail`. The `title` strings here must match the strings you pass to `phase()` calls in the body — these titles drive the progress display. If you add or rename a phase at runtime but leave `meta.phases` stale, the UI shows a mismatch.

The `meta` export must be **literally the first statement** in the file. Placing any other statement before it is an error.

---

## `agent(prompt, opts)` — spawn one subagent

```
agent(prompt: string, opts?: AgentOpts): Promise<string | object | null>
```

Spawns a subagent with a fresh, isolated context window. The subagent receives `prompt` as its sole input and performs the actual work (file reads, edits, shell, git, web, MCP). **The coordinator cannot do I/O; every real-world action must go through an agent.**

The subagent's final text is its return value. Subagents are instructed to return raw data, not human-facing prose — write your prompts accordingly.

### Return value

- Without `opts.schema`: returns the subagent's final text as a `string`.
- With `opts.schema`: forces structured output via a tool call and returns the validated object. The model retries automatically on schema mismatch; no manual parsing is needed.
- Returns `null` if the user skips the agent mid-run, or if the subagent dies on a terminal error after retries. Always guard downstream code against `null`.

### `opts` fields

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Display label shown in the progress UI for this agent. |
| `phase` | `string` | Assigns this agent to a named progress group. Inside `pipeline()` and `parallel()`, set this explicitly on every agent instead of relying on the global `phase()` call — global phase state can race when many agents start concurrently. |
| `schema` | JSON Schema object | Forces structured output. The agent must conform to this schema; the return value is the validated object, not a string. |
| `model` | `"sonnet"` \| `"opus"` \| `"haiku"` | Override the model for this agent. Omitting inherits the session model. In this repo: omit by default; use `"sonnet"` for mechanical work (search, extraction, routine verification); reserve `"opus"` for steps that genuinely require top-tier reasoning. |
| `isolation` | `"worktree"` | Runs the agent in a fresh git worktree. Use **only** when agents mutate files in parallel and would otherwise conflict. Cost: approximately 200–500 ms plus disk per agent; the worktree is auto-removed if unchanged. |
| `agentType` | `string` | Resolves a custom subagent type from the Agent registry. **WARNING: registry types are environment-specific and NOT portable to a standalone repo.** Do not use `agentType` in workflows intended to run outside this environment. |

### Context isolation requirement

A subagent knows only what its prompt contains. It does not share the coordinator's variables, does not see other agents' results, and does not inherit any implicit state. Pass every file path, data value, and authoritative fact the agent needs directly in the prompt string.

### Examples

```js
// Basic string return
const summary = await agent(
  "Read /src/app.ts and summarize its exported functions. Return a plain list, one per line.",
  { label: "Summarize app.ts", phase: "Discover", model: "sonnet" }
);

// Structured output with schema
const findings = await agent(
  `Audit the following package.json for outdated dependencies:\n\n${packageJsonContent}`,
  {
    label: "Audit packages",
    phase: "Audit",
    model: "sonnet",
    schema: {
      type: "object",
      required: ["packages"],
      properties: {
        packages: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "currentVersion", "severity"],
            properties: {
              name:           { type: "string" },
              currentVersion: { type: "string" },
              severity:       { type: "string", enum: ["low", "medium", "high", "critical"] }
            }
          }
        }
      }
    }
  }
);
// findings is a validated object, not a string

// Null guard
if (!findings) {
  log("Agent was skipped or failed — skipping this package.");
}

// Parallel isolation (file mutation)
const result = await agent(
  "Upgrade all devDependencies in package.json to their latest versions.",
  { label: "Upgrade deps", isolation: "worktree" }
);
```

---

## `parallel(thunks)` — concurrent fan-out with a barrier

```
parallel(thunks: Array<() => Promise<any>>): Promise<Array<any>>
```

Runs an array of zero-argument thunks concurrently and **waits for all of them before returning**. This is a hard barrier — no item in the next stage can start until the last thunk resolves.

Each thunk is a function that returns a Promise. A thunk that throws, or whose agent errors terminally, resolves to `null` in the result array. The `parallel()` call itself never rejects. Filter nulls with `.filter(Boolean)`.

Use `parallel()` **only** when a subsequent step genuinely needs all prior results together — for example, deduplication across the full set, early-exit when the total count is zero, or cross-referencing across all results. "I need to flatten or map first" is not a barrier reason; do that inside a `pipeline()` stage instead.

### Example

```js
const manifests = ["/pkg/a/package.json", "/pkg/b/package.json", "/pkg/c/package.json"];

const results = await parallel(
  manifests.map((path) => async () =>
    agent(`Read ${path} and return its name and version fields as JSON.`, {
      label: `Read ${path}`,
      phase: "Discover",
      model: "sonnet"
    })
  )
);

const valid = results.filter(Boolean);
// valid contains only non-null results
```

---

## `pipeline(items, ...stages)` — multi-stage per-item processing

```
pipeline(items: Array<any>, ...stages: Array<(prev, item, index) => Promise<any>>): Promise<Array<any>>
```

Runs each item through all stages in order, with **no barrier between stages**. Item A can enter stage 3 while item B is still in stage 1. Wall-clock time equals the slowest single-item chain across all stages, not the sum of the slowest per stage.

Each stage callback receives three arguments:
- `prevResult` — the output of the previous stage for this item (or the original item for stage 1).
- `originalItem` — the original item as passed in `items`.
- `index` — the zero-based index of the item.

A stage that throws drops that item to `null` and skips all its remaining stages. The returned array has one entry per original item; dropped items appear as `null`.

`pipeline()` is the **default choice** for any multi-stage work. Reach for `parallel()` only when a real cross-item barrier is needed.

### Example

```js
const packages = [
  { name: "lodash",  path: "/pkg/lodash/package.json" },
  { name: "express", path: "/pkg/express/package.json" }
];

const audited = await pipeline(
  packages,

  // Stage 1: read the manifest
  async (pkg, _orig, i) =>
    agent(`Read ${pkg.path} and return its full contents as a JSON string.`, {
      label: `Read ${pkg.name}`,
      phase: "Discover",
      model: "sonnet"
    }),

  // Stage 2: audit the manifest
  async (manifestText, orig, i) =>
    agent(
      `Audit this package.json for vulnerabilities:\n\n${manifestText}\n\nReturn findings as JSON array.`,
      {
        label: `Audit ${orig.name}`,
        phase: "Audit",
        model: "sonnet",
        schema: {
          type: "object",
          required: ["findings"],
          properties: {
            findings: {
              type: "array",
              items: { type: "object", required: ["id", "severity"], properties: {
                id:       { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] }
              }}
            }
          }
        }
      }
    )
);

const successful = audited.filter(Boolean);
```

---

## `phase(title)` — start a named progress phase

```
phase(title: string): void
```

Starts a named phase; all subsequent `agent()` calls group under it in the progress display until the next `phase()` call.

Inside `pipeline()` or `parallel()`, set `opts.phase` on each `agent()` call directly rather than calling `phase()` globally. Concurrent agents share the global phase state and can race, causing incorrect grouping in the UI.

The `title` string must match a `title` entry in the `meta.phases` array.

### Example

```js
phase("Discover");
const fileList = await agent("List all TypeScript files under /src.", {
  label: "List TS files",
  model: "sonnet"
});

phase("Audit");
// subsequent agents group under "Audit"
```

---

## `log(message)` — emit a progress line

```
log(message: string): void
```

Emits a narrator line visible to the user in the progress display. Use `log()` to announce what the workflow is about to do, to report how many items were found, or — critically — to surface when the workflow is dropping coverage (top-N limits, skipped items, sampling). Never silently cap scope.

### Example

```js
const allFiles = /* ... */;
const TOP = 20;
if (allFiles.length > TOP) {
  log(`Found ${allFiles.length} files; auditing the top ${TOP} by size. ${allFiles.length - TOP} skipped.`);
}
const sample = allFiles.slice(0, TOP);
```

---

## `workflow(nameOrRef, args)` — run a sub-workflow inline

```
workflow(nameOrRef: string, args?: any): Promise<any>
```

Runs another workflow inline as a sub-step. The child workflow shares the parent's concurrency cap, agent counter, abort signal, and token budget.

Nesting is **one level only**. Calling `workflow()` from inside a child workflow throws. Do not nest workflows more than one level deep.

### Example

```js
// Run a named workflow as a step; pass structured args
const report = await workflow("security-scan", { rootPath: "/src", severity: "high" });
log(`Security scan complete: ${report.issueCount} issues found.`);
```

---

## `budget` — token budget introspection

```
budget.total:     number | null
budget.spent():   number
budget.remaining(): number
```

`budget` exposes the run's token target and current consumption.

| Property / Method | Description |
|---|---|
| `budget.total` | The turn's token target. `null` if no target was set. |
| `budget.spent()` | Output tokens consumed across the main loop and all child workflows (a shared pool). |
| `budget.remaining()` | `max(0, total - spent())`. Returns `Infinity` if `budget.total` is `null`. |

The target is a **hard ceiling**: once `spent()` reaches `total`, further `agent()` calls throw. Any budget-bounded loop must guard on `budget.total` before testing `remaining()` — otherwise `remaining()` is `Infinity` and the loop runs to the agent cap.

### Example

```js
// Bounded loop — always guard on budget.total
while (hasMoreWork && budget.total !== null && budget.remaining() > 500) {
  const result = await agent(/* ... */);
  // process result, update hasMoreWork
}

if (!budget.total) {
  log("No token budget set; running without budget guard.");
}
```

---

## `args` — workflow input arguments

```
args: any
```

The value passed as the workflow's `args` input, verbatim. `undefined` if not provided. Pass arrays and objects as real JSON values, not stringified blobs.

### Example

```js
// args is whatever the caller passed, e.g. { rootPath: "/src", maxDepth: 3 }
const { rootPath, maxDepth = 5 } = args ?? {};
log(`Scanning ${rootPath} up to depth ${maxDepth}`);
```

---

## Hard limits

| Limit | Value |
|---|---|
| Concurrent agents per workflow | min(16, cpu cores − 2); excess calls queue |
| Total agents per workflow lifetime | 1000 (runaway-loop backstop) |
| Items per single `parallel()` or `pipeline()` call | 4096 |
| Workflow nesting depth | 1 level (`workflow()` inside a child throws) |

These limits are enforced by the runtime. You may still pass more items to `pipeline()` or `parallel()` than the concurrency cap — excess agents queue and run as slots free.

---

## Prohibited globals — determinism guardrails

Three JavaScript forms are **banned** in the coordinator and throw at parse or run time because they would break deterministic resume:

- `Date.now()` — the static timestamp call
- `Math.random()` — the random number call
- `new Date()` — the no-argument Date constructor

**Workarounds:**

- For timestamps: pass them via `args` from the caller; stamp results after the run ends.
- For randomness: vary an agent's prompt or `label` by its index — that is sufficient to break symmetry across parallel agents.

---

## Schemas — structured output

Passing a JSON Schema object as `opts.schema` to `agent()` forces structured output. The subagent is instructed to call a structured-output tool, and the runtime validates the response against the schema. If validation fails, the model retries automatically. The return value from `agent()` is the validated object — no `JSON.parse`, no error handling required on the coordinator side.

Use schemas whenever a downstream stage depends on typed fields. Schemas eliminate the fragile text-parsing pattern and make pipeline stage contracts explicit.

```js
const schema = {
  type: "object",
  required: ["title", "severity", "filePath"],
  properties: {
    title:    { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    filePath: { type: "string" }
  }
};

const finding = await agent(
  "Identify the most severe security issue in /src/auth.ts and return it.",
  { label: "Find auth issue", schema, model: "sonnet" }
);

// finding.severity is a string, guaranteed
if (finding && finding.severity === "critical") {
  log(`Critical issue: ${finding.title} in ${finding.filePath}`);
}
```

---

## Complete minimal example workflow

This example is minimal but real: it uses `meta`, `phase()`, `agent()` with a schema, and `pipeline()`.

```js
export const meta = {
  name: "ts-export-audit",
  description: "Finds all TypeScript source files, extracts their exports, and flags any that lack JSDoc.",
  phases: [
    { title: "Discover", detail: "List TypeScript files" },
    { title: "Extract",  detail: "Extract exports per file" },
    { title: "Flag",     detail: "Identify undocumented exports" }
  ]
};

// args: { rootPath: string }
const { rootPath = "/src" } = args ?? {};

// Stage 1: discover all TS files
phase("Discover");
const fileListText = await agent(
  `List every .ts file under ${rootPath}, one absolute path per line. Do not include .d.ts files.`,
  { label: "List TS files", phase: "Discover", model: "sonnet" }
);

if (!fileListText) {
  log("Discovery agent failed or was skipped.");
  // nothing to do
} else {
  const files = fileListText.split("\n").map((s) => s.trim()).filter(Boolean);
  log(`Found ${files.length} TypeScript files.`);

  const exportSchema = {
    type: "object",
    required: ["exports"],
    properties: {
      exports: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "hasJsDoc"],
          properties: {
            name:     { type: "string" },
            hasJsDoc: { type: "boolean" }
          }
        }
      }
    }
  };

  const results = await pipeline(
    files,

    // Stage 2: extract exports from the file
    async (filePath, _orig, i) =>
      agent(
        `Read ${filePath} and return every exported symbol (functions, classes, constants). For each, note whether it has a JSDoc comment directly above it.`,
        {
          label: `Extract ${filePath}`,
          phase: "Extract",
          model: "sonnet",
          schema: exportSchema
        }
      ),

    // Stage 3: flag undocumented exports
    async (extracted, originalFile, i) => {
      if (!extracted) return null;
      const undocumented = extracted.exports.filter((e) => !e.hasJsDoc);
      if (undocumented.length === 0) return null; // nothing to flag
      return agent(
        `File: ${originalFile}\nUndocumented exports: ${undocumented.map((e) => e.name).join(", ")}\n\nWrite a one-sentence summary of what is missing and why it matters.`,
        {
          label: `Flag ${originalFile}`,
          phase: "Flag",
          model: "sonnet"
        }
      );
    }
  );

  const flags = results.filter(Boolean);
  log(`${flags.length} files have undocumented exports.`);
  flags.forEach((f) => log(f));
}
```

---

## Sources

- [Official workflow docs](https://code.claude.com/docs/en/workflows)
- [Blog — A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog — Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Subagents reference](https://code.claude.com/docs/en/sub-agents)
- [Skills reference](https://code.claude.com/docs/en/skills)
- [Managed Agents SDK (headless/standalone contrast)](https://platform.claude.com/docs/en/managed-agents/overview)
