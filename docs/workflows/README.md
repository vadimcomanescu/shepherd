# Dynamic Workflows in this Repo — Index and Core Principles

**Nadia is itself built as a dynamic workflow.** These principles are load-bearing, not background reading.

---

## What a Dynamic Workflow Is

A dynamic workflow is a JavaScript script that orchestrates many subagents at scale. Claude writes the script for the task; a runtime executes it in the background while the main session stays responsive.

The defining principle: **the plan moves into code, not the model's context.** The script holds the loop, the branching, and the intermediate results. The main session's context holds only the final answer.

The philosophy is "a harness for every task" — instead of a fixed multi-agent structure, the script encodes exactly the structure the task needs. Every workflow is custom-shaped to its problem. There is no one-size template.

```js
// The coordinator script holds all control flow.
// Agents do all real work. The coordinator does none.
export const meta = {
  name: "example-workflow",
  description: "Illustrates the coordinator/agent split",
  phases: [
    { title: "Gather", detail: "Read inputs" },
    { title: "Synthesize", detail: "Merge findings" },
  ],
};

phase("Gather");
const findings = await pipeline(
  filePaths,
  (path, _orig, i) => agent(`Read ${path} and extract all TODO comments. Return a JSON array of strings.`, {
    label: `read-${i}`,
    phase: "Gather",
    model: "sonnet",
    schema: { type: "array", items: { type: "string" } },
  })
);

phase("Synthesize");
const report = await agent(
  `Deduplicate and group these TODO items: ${JSON.stringify(findings.flat())}`,
  { label: "synthesize" }
);

log(report);
```

---

## Core Principles

These are the rules that govern every workflow written in this repo. Follow them without exception.

**1. The coordinator does no I/O.**
The coordinator cannot read files, write files, run shell commands, access git, or make network requests. It has no access to the filesystem, the Node.js API, or any external system. Every real-world action belongs to an agent.

The coordinator script is **plain JavaScript, not TypeScript**. Type annotations, interfaces, and generics fail to parse. Do not write TypeScript in coordinator scripts.

```js
// WRONG — coordinator trying to read a file
const src = fs.readFileSync("src/index.ts", "utf8"); // throws — no fs

// RIGHT — delegate to an agent
const src = await agent("Read src/index.ts and return its full contents.", {
  label: "read-index",
  model: "sonnet",
});
```

**2. `pipeline()` by default.**
`pipeline()` is the default primitive for multi-stage work. Reach for `parallel()` only when a stage genuinely needs ALL prior-stage results together — dedup across the full set, early-exit when the count is zero, or cross-referencing the complete result set. "I need to flatten, map, or filter" is not a barrier reason; do it inside a pipeline stage.

```js
// pipeline: item A can be in stage 2 while item B is still in stage 1
const results = await pipeline(
  items,
  (item, _orig, i) => agent(`Analyze: ${item}`, { label: `analyze-${i}`, phase: "Analyze", model: "sonnet" }),
  (analysis, orig, i) => agent(`Verify this analysis is correct. Actively try to refute it:\n${analysis}`, {
    label: `verify-${i}`,
    phase: "Verify",
    model: "sonnet",
  })
);
```

**3. Move intermediate state out of context.**
Aggregation lives in script variables, not in an agent's context. Do not ask an agent to accumulate results across turns. The coordinator's variables are the accumulator.

```js
// Accumulate in script variables, not in a follow-up agent prompt
const allFindings = results.filter(Boolean).flat();
// then pass allFindings to a synthesis agent
```

**4. Ground context-less agents.**
Each agent starts with a fresh, empty context window. It cannot see the coordinator's variables or other agents' work. Pass every agent exactly the data, paths, and facts it needs — inline in its prompt.

```js
// WRONG — agent cannot see `filePath` from coordinator scope
const result = await agent("Summarize the file you just read.");

// RIGHT — pass the data explicitly
const result = await agent(
  `Summarize the following source file.\n\nPath: ${filePath}\n\nContents:\n${fileContents}`,
  { label: "summarize" }
);
```

**5. Verify adversarially.**
For findings that must be trusted, spawn independent verifier agents prompted to REFUTE the finding. Require a majority. Default to "fail if uncertain."

```js
const verifications = await parallel(
  findings.map((f) => () =>
    agent(
      `You are a skeptical reviewer. Try to REFUTE this finding. ` +
      `If you cannot, say "CONFIRMED". Finding:\n${f}`,
      { label: `verify-${f.id}`, model: "sonnet" }
    )
  )
);
const confirmed = findings.filter((_, i) => verifications[i]?.includes("CONFIRMED"));
```

**6. No silent caps.**
If the workflow bounds coverage — top-N, no-retry, sampling — `log()` what was dropped so the user knows the result is partial.

```js
const MAX = 50;
if (files.length > MAX) {
  log(`Capped at ${MAX} files; skipped ${files.length - MAX} files.`);
}
const sample = files.slice(0, MAX);
```

**7. Bounded loops.**
Any loop-until-done or loop-until-dry pattern must have a real stop condition. Guard budget loops on `budget.total`; do not rely on `budget.remaining()` alone because it is `Infinity` when no token target is set.

```js
// Guard the loop with a hard iteration cap AND a budget check
let round = 0;
while (round < 10 && (!budget.total || budget.remaining() > 0)) {
  const newFindings = await agent("Find issues not yet in this list: " + JSON.stringify(known));
  if (!newFindings || newFindings.length === 0) break;
  known.push(...newFindings);
  round++;
}
```

**8. Model policy for this repo.**
Omit the `model` option by default to inherit the session model. For grunt work — search, fetch, extraction, mechanical authoring, routine verification — set `model: "sonnet"`. Reserve `model: "opus"` for steps that genuinely need top-tier reasoning.

```js
// Grunt work — extraction agent
const extracted = await agent("Extract all import statements from this file:\n" + src, {
  model: "sonnet",
  label: "extract-imports",
});

// High-reasoning step — architectural judgment
const verdict = await agent(
  "Given these architectural trade-offs, recommend the best approach:\n" + tradeoffs,
  { label: "architect" } // inherits session model; use opus only if genuinely needed
);
```

---

## When to Use a Workflow vs a Subagent vs a Skill

| Dimension | Subagent (single Agent/Task) | Skill | Workflow |
|---|---|---|---|
| **Who decides next step** | Claude, turn by turn | Claude, following instructions | The script |
| **Where results live** | Claude's context window | Claude's context window | Script variables |
| **Agents per run** | A few per turn | A few per turn | Dozens to hundreds |
| **Orchestration artifact** | None | Skill file | The script itself |
| **Use when** | One focused task mid-turn | Instructions Claude follows | More agents than a conversation can coordinate; orchestration worth codifying; quality patterns (adversarial, tournament) that should run before reporting |
| **Resumable** | No | No | Yes — same `scriptPath` + `resumeFromRunId` replays cached results |
| **Background execution** | No | No | Yes — runtime executes it; main session stays responsive |

A workflow is the right choice when the task needs more agents than one conversation can coordinate, when the orchestration is worth codifying and repeating, or when a quality pattern — adversarial verification, tournament comparison — must run before a result is reported.

---

## Banned Behaviors (three JavaScript forms that throw at runtime)

Three JavaScript forms are prohibited because they would break deterministic resume:

- `Date.now()` — throws at parse/run time
- `Math.random()` — throws at parse/run time
- `new Date()` (no-argument constructor) — throws at parse/run time

Work around `Date.now()` by passing timestamps via `args` and stamping results after the run. Work around `Math.random()` by varying an agent's prompt or label by its index.

---

## The `meta` Export

The `meta` export must be the **first statement** in the script. It must be a pure object literal — no variables, function calls, spreads, or interpolation. `name` and `description` are required. `phases` is an array of `{ title, detail }` objects used for the progress display; use the same titles in your `phase()` calls.

```js
// Correct — pure literal, first statement
export const meta = {
  name: "audit-dependencies",
  description: "Audits all dependencies for known vulnerabilities",
  phases: [
    { title: "Scan", detail: "Check each dependency" },
    { title: "Verify", detail: "Adversarially verify findings" },
    { title: "Report", detail: "Synthesize final report" },
  ],
};
```

---

## Map and Index

| Document | Description |
|---|---|
| [coordinator.md](coordinator.md) | The coordinator contract in full: what it is, what it cannot do, the `meta` export rules, plain-JavaScript constraints, and the banned runtime forms. |
| [primitives.md](primitives.md) | Every primitive — `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, `budget`, `args` — with their signatures, return types, null-on-error semantics, and usage examples. |
| [constraints.md](constraints.md) | Hard limits (concurrency cap, 1000-agent lifetime cap, 4096-item limit, one-level nesting), execution model (background run, resume, auto-approved edits, cost), and what those limits mean for workflow design. |
| [patterns.md](patterns.md) | Canonical patterns — classify-and-act, fan-out-and-synthesize, adversarial verification, generate-and-filter, tournament, loop-until-done, multi-modal sweep, completeness critic — each with a concrete code example. |

---

## Sources

- [Official docs — Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Blog — A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog — Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Subagents docs](https://code.claude.com/docs/en/sub-agents)
- [Skills docs](https://code.claude.com/docs/en/skills)
- [Managed Agents SDK](https://platform.claude.com/docs/en/managed-agents/overview)
