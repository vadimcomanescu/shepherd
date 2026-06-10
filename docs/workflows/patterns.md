# Orchestration and quality patterns

> Audience: AI coding agents authoring or modifying dynamic workflows in this repo.
> Every claim below is grounded in the SPEC. If a behavior is not here, it is not guaranteed.

---

## The PIPELINE-BY-DEFAULT rule

`pipeline()` is the default primitive for any multi-stage work over a collection of items. Use it unless a stage genuinely cannot start until all prior-stage results exist across the entire set.

```js
// Default shape for multi-stage work
const results = await pipeline(
  items,
  async (item, originalItem, index) => {
    return await agent(`Stage 1: analyze ${item}`, { phase: "analyze", label: `analyze-${index}` });
  },
  async (analysis, originalItem, index) => {
    return await agent(`Stage 2: summarize ${analysis}`, { phase: "summarize", label: `summarize-${index}` });
  },
);
```

`pipeline()` runs each item through all stages independently with **no barrier between stages**. Item A can be in stage 3 while item B is still in stage 1. Wall-clock time equals the slowest single-item chain, not the sum of slowest-per-stage across all items.

Every stage callback receives three arguments: `(prevResult, originalItem, index)`. A stage that throws drops that item to `null` and skips its remaining stages. Filter drops with `.filter(Boolean)`.

---

## When a barrier is actually justified

Reach for `parallel()` — which IS a barrier, awaiting all thunks before returning — only when a stage genuinely needs **all** prior-stage results together. The three valid reasons:

1. **Dedup or merge across the full set.** You cannot deduplicate without seeing every candidate first.
2. **Early-exit on zero.** If the count after a stage is zero, there is nothing to continue with and the run should halt.
3. **Cross-referencing other results.** A ranking or consistency check that requires seeing the entire set simultaneously.

### Anti-justifications — these do NOT warrant a barrier

- "I need to flatten the array first." Flattening is a coordinator operation on already-resolved variables; no barrier needed.
- "I need to map or filter the results." Same — do it in a pipeline stage or in plain JS on resolved arrays.
- "I want to log progress between stages." `log()` is a coordinator call; put it between pipeline calls, not inside a parallel barrier.
- "The next stage is different." Different downstream logic is handled by branching inside a stage callback, not by a barrier.

```js
// CORRECT: barrier only for dedup across the full set
const raw = await pipeline(items, generateCandidates);
const unique = await agent(`Deduplicate these candidates: ${JSON.stringify(raw.filter(Boolean))}`, {
  schema: { type: "array", items: { type: "string" } },
  label: "dedup",
});
```

---

## Canonical patterns

### Classify-and-act

A classifier agent routes each item by task type; downstream agents handle only the class they were built for. The classifier is the only agent that decides the route; the coordinator switches on its output.

```js
export const meta = {
  name: "classify-and-act",
  description: "Route items by type to specialized agents",
  phases: [
    { title: "classify", detail: "Determine item type" },
    { title: "act", detail: "Run type-specific handler" },
  ],
};

const results = await pipeline(
  items,
  async (item, _orig, i) => {
    const classification = await agent(
      `Classify this item as one of [bug, feature, chore]: ${item}`,
      { phase: "classify", label: `classify-${i}`, schema: { type: "object", properties: { type: { type: "string" } }, required: ["type"] } },
    );
    return { item, type: classification?.type };
  },
  async ({ item, type }, _orig, i) => {
    if (!type) return null;
    const prompts = {
      bug: `Fix the bug: ${item}`,
      feature: `Implement the feature: ${item}`,
      chore: `Complete the chore: ${item}`,
    };
    return await agent(prompts[type] ?? `Handle: ${item}`, { phase: "act", label: `act-${i}` });
  },
);
```

### Fan-out-and-synthesize

Split the problem into many independent sub-problems, run one agent per sub-problem in parallel, then pass all results to a single synthesis agent.

The coordinator must pass all intermediate results explicitly to the synthesis agent — the synthesizer has no access to the coordinator's variables and cannot see other agents' work.

```js
export const meta = {
  name: "fan-out-and-synthesize",
  description: "Analyze many items in parallel and merge",
  phases: [
    { title: "fan-out", detail: "Per-item analysis" },
    { title: "synthesize", detail: "Merge all analyses" },
  ],
};

phase("fan-out");
const analyses = (
  await parallel(
    items.map((item, i) => async () =>
      agent(`Analyze: ${item}`, { phase: "fan-out", label: `analyze-${i}` }),
    ),
  )
).filter(Boolean);

phase("synthesize");
const report = await agent(
  `Synthesize these analyses into a single report:\n${analyses.join("\n\n")}`,
  { label: "synthesize" },
);
```

### Adversarial verification

Independent verifier agents scrutinize each finding against a rubric and are explicitly prompted to **refute** it. A finding survives only if fewer than a majority of verifiers refute it. When uncertain, verifiers must default to refute.

Exception — code-review findings: the finding-verifier persona is deliberately recall-biased (uncertain lands on PLAUSIBLE, never REFUTED) because dropping a real defect costs more than keeping an uncertain one. The mitigation is verdict-conditional downstream handling: PLAUSIBLE findings may only receive local, behavior-preserving fixes.

**Refute-by-majority shape:** spawn N independent verifiers per finding, count refutations, and drop the finding if refutations >= ceil(N / 2).

```js
export const meta = {
  name: "adversarial-verification",
  description: "Kill findings that cannot survive independent scrutiny",
  phases: [
    { title: "generate", detail: "Produce candidate findings" },
    { title: "verify", detail: "Adversarial verification per finding" },
    { title: "filter", detail: "Keep majority-surviving findings" },
  ],
};

const VERIFIER_COUNT = 3;

phase("generate");
const findings = await agent("List all security issues in the codebase. Read the relevant files.", {
  schema: { type: "array", items: { type: "string" } },
  label: "generate",
});

phase("verify");
const verified = (
  await parallel(
    (findings ?? []).map((finding, fi) => async () => {
      const verdicts = await parallel(
        Array.from({ length: VERIFIER_COUNT }, (_, vi) => async () =>
          agent(
            `You are an adversarial reviewer. Your job is to REFUTE this finding if you can: "${finding}". ` +
            `Examine the evidence. If you cannot confirm it with certainty, you MUST refute it. ` +
            `Reply with JSON { "refute": true/false, "reason": "..." }`,
            {
              phase: "verify",
              label: `verify-${fi}-${vi}`,
              schema: {
                type: "object",
                properties: { refute: { type: "boolean" }, reason: { type: "string" } },
                required: ["refute"],
              },
            },
          ),
        ),
      );
      const refutations = verdicts.filter(Boolean).filter((v) => v.refute).length;
      const majority = Math.ceil(VERIFIER_COUNT / 2);
      if (refutations >= majority) return null; // killed by majority
      return finding;
    }),
  )
).filter(Boolean);

phase("filter");
log(`Verified ${verified.length} of ${(findings ?? []).length} findings survived adversarial review.`);
```

### Generate-and-filter

Generate many candidates, evaluate each against a rubric, deduplicate, and keep only those that pass. Deduplication requires a barrier because it needs the full candidate set.

```js
export const meta = {
  name: "generate-and-filter",
  description: "Generate candidates, filter by rubric, deduplicate",
  phases: [
    { title: "generate", detail: "Produce candidates" },
    { title: "filter", detail: "Evaluate against rubric" },
    { title: "dedup", detail: "Remove duplicates from survivors" },
  ],
};

phase("generate");
const candidates = (
  await parallel(
    Array.from({ length: 10 }, (_, i) => async () =>
      agent(`Generate a solution variant for the problem. Variant index: ${i}`, {
        phase: "generate",
        label: `gen-${i}`,
      }),
    ),
  )
).filter(Boolean);

phase("filter");
const passing = (
  await parallel(
    candidates.map((candidate, i) => async () => {
      const verdict = await agent(
        `Evaluate this candidate against the rubric. Rubric: [correctness, performance, readability]. ` +
        `Candidate:\n${candidate}\nReply with JSON { "pass": true/false, "reason": "..." }`,
        {
          phase: "filter",
          label: `filter-${i}`,
          schema: { type: "object", properties: { pass: { type: "boolean" }, reason: { type: "string" } }, required: ["pass"] },
        },
      );
      return verdict?.pass ? candidate : null;
    }),
  )
).filter(Boolean);

// Dedup requires the full passing set — barrier is justified here
phase("dedup");
const unique = await agent(
  `Deduplicate this list, keeping the best representative of each distinct approach:\n${JSON.stringify(passing)}`,
  { schema: { type: "array", items: { type: "string" } }, label: "dedup" },
);
log(`Kept ${(unique ?? []).length} unique candidates from ${passing.length} passing (${candidates.length} generated).`);
```

### Tournament

N agents attempt the same task in different ways. Pairwise judging eliminates losers; the final survivor is the winner. The coordinator holds the bracket in plain variables.

```js
export const meta = {
  name: "tournament",
  description: "N attempts, pairwise judging picks a winner",
  phases: [
    { title: "attempt", detail: "Independent attempts at the task" },
    { title: "judge", detail: "Pairwise elimination" },
  ],
};

phase("attempt");
const attempts = (
  await parallel(
    Array.from({ length: 4 }, (_, i) => async () =>
      agent(`Solve the problem using approach ${i}. Problem: ${args.problem}`, {
        phase: "attempt",
        label: `attempt-${i}`,
      }),
    ),
  )
).filter(Boolean);

phase("judge");
let survivors = attempts;
let round = 0;
while (survivors.length > 1) {
  const pairs = [];
  for (let i = 0; i < survivors.length - 1; i += 2) {
    pairs.push([survivors[i], survivors[i + 1], i]);
  }
  const bye = survivors.length % 2 === 1 ? survivors[survivors.length - 1] : null;

  const winners = (
    await parallel(
      pairs.map(([a, b, i]) => async () => {
        const verdict = await agent(
          `Judge these two solutions. Pick the better one. Reply with JSON { "winner": "A" or "B" }.\n` +
          `A:\n${a}\n\nB:\n${b}`,
          {
            phase: "judge",
            label: `judge-r${round}-${i}`,
            schema: { type: "object", properties: { winner: { type: "string" } }, required: ["winner"] },
          },
        );
        return verdict?.winner === "B" ? b : a;
      }),
    )
  ).filter(Boolean);

  survivors = bye ? [...winners, bye] : winners;
  round++;
}

const winner = survivors[0] ?? null;
```

### Loop-until-done / loop-until-dry

Keep spawning work until a real stop condition is met — not a fixed count. Valid stop conditions: no new findings for K consecutive rounds, no errors remain, or the budget is exhausted.

**Guard budget loops on `budget.total`.** If no token target is set, `budget.remaining()` is `Infinity` and the loop runs to the agent cap (1000 agents).

```js
export const meta = {
  name: "loop-until-dry",
  description: "Iterate until no new issues are found for K rounds",
  phases: [
    { title: "scan", detail: "Find issues" },
    { title: "fix", detail: "Fix discovered issues" },
  ],
};

const MAX_DRY_ROUNDS = 3;
let dryRounds = 0;
let allFixed = [];

// Guard: only loop if a token budget was set
if (!budget.total) {
  log("No token budget set — running a single pass to avoid runaway loop.");
}

while (dryRounds < MAX_DRY_ROUNDS && (budget.total ? budget.remaining() > 0 : allFixed.length === 0)) {
  phase("scan");
  const issues = await agent(
    `Scan the codebase for remaining issues. Previously fixed: ${JSON.stringify(allFixed)}. ` +
    `Return an empty array if none remain.`,
    { schema: { type: "array", items: { type: "string" } }, label: `scan-round-${dryRounds}` },
  );

  if (!issues || issues.length === 0) {
    dryRounds++;
    log(`Dry round ${dryRounds}/${MAX_DRY_ROUNDS} — no new issues found.`);
    continue;
  }

  dryRounds = 0; // reset on new findings
  phase("fix");
  const fixes = (
    await parallel(
      issues.map((issue, i) => async () =>
        agent(`Fix this issue: ${issue}`, { phase: "fix", label: `fix-${i}` }),
      ),
    )
  ).filter(Boolean);
  allFixed = allFixed.concat(fixes);
}
```

### Multi-modal sweep

Run parallel agents where each searches by a different strategy — by container, by content type, by entity, by time range. Combine results in the coordinator after the barrier.

The barrier is justified here because synthesis requires the full result set from all search strategies.

```js
export const meta = {
  name: "multi-modal-sweep",
  description: "Search across multiple strategies in parallel, then synthesize",
  phases: [
    { title: "sweep", detail: "Parallel multi-strategy search" },
    { title: "synthesize", detail: "Merge all findings" },
  ],
};

phase("sweep");
const strategies = [
  { label: "by-container", prompt: "Search for issues by examining each service container in the repo." },
  { label: "by-content",   prompt: "Search for issues by scanning file contents for known bad patterns." },
  { label: "by-entity",    prompt: "Search for issues by listing all entities (users, orders, payments) and checking each." },
  { label: "by-time",      prompt: "Search for issues introduced in the last 30 commits." },
];

const findings = (
  await parallel(
    strategies.map(({ label, prompt }) => async () =>
      agent(prompt, { phase: "sweep", label }),
    ),
  )
).filter(Boolean);

phase("synthesize");
const report = await agent(
  `Merge these search results from four independent strategies into a deduplicated findings report:\n\n` +
  findings.map((f, i) => `Strategy ${i + 1}:\n${f}`).join("\n\n"),
  { label: "synthesize" },
);
```

### Completeness critic

After a generation pass, spawn a critic agent whose sole job is to ask "what is missing?" The critic's answer becomes the next round of work. This can be used once or looped.

```js
export const meta = {
  name: "completeness-critic",
  description: "Critic identifies gaps; gaps become next-round work",
  phases: [
    { title: "generate", detail: "Initial generation" },
    { title: "critique", detail: "Identify missing coverage" },
    { title: "fill-gaps", detail: "Address gaps found by critic" },
  ],
};

phase("generate");
const initialResults = (
  await parallel(
    items.map((item, i) => async () =>
      agent(`Analyze: ${item}`, { phase: "generate", label: `gen-${i}` }),
    ),
  )
).filter(Boolean);

phase("critique");
const gaps = await agent(
  `You are a completeness critic. Here is the full analysis produced so far:\n\n` +
  initialResults.join("\n\n") +
  `\n\nWhat important topics, edge cases, or items are MISSING from this analysis? ` +
  `Return a list of specific gaps. Return an empty array if coverage is complete.`,
  {
    schema: { type: "array", items: { type: "string" } },
    label: "critic",
  },
);

if (!gaps || gaps.length === 0) {
  log("Critic found no gaps — coverage is complete.");
} else {
  log(`Critic identified ${gaps.length} gap(s). Filling them now.`);
  phase("fill-gaps");
  const gapResults = (
    await parallel(
      gaps.map((gap, i) => async () =>
        agent(`Fill this gap in the analysis: ${gap}`, { phase: "fill-gaps", label: `gap-${i}` }),
      ),
    )
  ).filter(Boolean);

  // Coordinator holds the combined result in a plain variable
  const fullResults = [...initialResults, ...gapResults];
  log(`Final coverage: ${fullResults.length} items (${initialResults.length} initial + ${gapResults.length} gaps).`);
}
```

---

## Quality rules

These rules apply to every workflow in this repo. Violating them produces silent failures, runaway costs, or untrustworthy results.

### No silent caps — log what you drop

If the workflow bounds coverage (top-N, no-retry, sampling), call `log()` to record what was dropped and why. Silent truncation hides coverage gaps from the user.

```js
const TOP_N = 20;
if (items.length > TOP_N) {
  log(`Capping analysis to top ${TOP_N} of ${items.length} items. ${items.length - TOP_N} items skipped.`);
}
const subset = items.slice(0, TOP_N);
```

### Bounded loops — real stop conditions

Every `while` loop must terminate on a concrete condition. Accepted stop conditions: no new findings for K consecutive rounds, no errors remain, or the token budget is exhausted. A loop that runs "until done" without a counter or budget check will hit the 1000-agent hard cap.

Guard any budget-based loop on `budget.total` — if no target is set, `budget.remaining()` returns `Infinity`.

```js
// WRONG — no stop condition
while (true) { /* spawns agents until hard cap */ }

// CORRECT
const K = 3;
let dryRounds = 0;
while (dryRounds < K && (!budget.total || budget.remaining() > 0)) {
  // ...
}
```

### Ground context-less agents

A subagent knows only what its prompt says. It cannot see the coordinator's variables, other agents' results, or any file not named in its prompt. Pass every agent the data it needs — file paths to read, authoritative facts, prior results — explicitly in the prompt string.

```js
// WRONG — agent has no idea what "the results" are
await agent("Summarize the results.");

// CORRECT — pass the data
await agent(`Summarize these results:\n${JSON.stringify(previousResults)}`);
```

### Verify adversarially

For findings that must be trusted, spawn independent verifier agents prompted to **refute**, require a majority to confirm, and default to "fail if uncertain." Do not let a single agent's confidence stand as ground truth. (Code-review findings are the carved-out exception — see the adversarial-verification pattern above.)

### Scale to the ask

A quick check gets a few agents. A comprehensive audit gets a larger pool plus adversarial verification and synthesis. Do not run a tournament or completeness-critic loop for a single-file lint check. Do not skip adversarial verification for security-critical findings.

### Forbidden coordinator operations

The coordinator is plain JavaScript — **not TypeScript**. Type annotations, interfaces, and generics fail to parse. The following are also forbidden in the script body and will fail at runtime:

- `Date.now()` — throws at parse/run time (deterministic-resume constraint).
- `Math.random()` — throws at parse/run time.
- `new Date()` (no-argument form) — throws at parse/run time.
- Any filesystem read/write, shell execution, git command, or network request.

Work around timestamp needs by passing timestamps via `args`. Work around randomness by varying an agent's prompt or label by its index.

### Model policy

- Default: omit `model` — inherit the session model.
- Grunt work (search, fetch, extraction, mechanical authoring, routine verification): `model: "sonnet"`.
- Steps that genuinely need top-tier reasoning: `model: "opus"`.

---

## Sources

- [Official workflow docs](https://code.claude.com/docs/en/workflows)
- [Blog — A harness for every task: dynamic workflows in Claude Code](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)
- [Blog — Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Skills](https://code.claude.com/docs/en/skills)
- [Managed Agents SDK (headless/standalone contrast)](https://platform.claude.com/docs/en/managed-agents/overview)
