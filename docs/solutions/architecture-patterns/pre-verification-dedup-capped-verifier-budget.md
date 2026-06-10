---
title: Pre-verification proximity dedup with a capped verifier budget
date: 2026-06-10
category: architecture-patterns
module: workflows
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - "Multiple reviewer agents fan findings into a per-finding verification stage"
  - "A spawn cap or token budget bounds how many findings can be verified"
  - "Findings are merged by heuristic identity (line proximity or title similarity) and duplicates can carry different severities"
tags: [review-pipeline, dedup, verifier-budget, adversarial-verification, dynamic-workflows, agent-spawn-cap]
---

# Pre-verification proximity dedup with a capped verifier budget

## Context

The Quality phase of `workflows/nadia-deliver.js` fans findings from several reviewer agents (Claude personas, a Codex second-model reviewer, inline angle reviewers, a late sweep pass) into per-finding verifier agents. The original design deduped AFTER verification with an exact `file::line::title` fingerprint. That had three compounding costs: duplicate findings each consumed a verifier spawn before the merge, near-identical findings (same defect reported 2 lines apart, or paraphrased titles) never merged at all, and verifier spawns were unbounded — an inflated reviewer roster walked toward the 1000-agent lifetime cap.

The replacement (commit `f9fa09a`, hardened by review-fix commits `db22c28` and `5a03092`) moves dedup BEFORE verification and caps spawns. Getting that correct took one TDD pass (9 red scenarios first) plus 12 adversarially-verified review findings — the hazards below are exactly what a first implementation gets wrong.

## Guidance

**1. Dedup streaming, before verification, with no cross-reviewer barrier.** Run the dedup inside pipeline stage 2 as each reviewer completes, against a shared `kept` accumulator. A duplicate then never consumes a verifier spawn, and you keep `pipeline()` wall-clock (no `parallel()` barrier just to dedup). Coordinator JS is single-threaded, so mutating shared accumulators from concurrently-progressing stage closures is safe — but bucket-winner and drop selection become reviewer-completion-order dependent, which is acceptable only because every drop and every absorption is logged with its `file:line — title` identity (no silent caps).

**2. Merge into the SAME kept object; never a fresh spread.** The verifier promise must resolve to the kept entry itself so severity escalations and persona credits applied by later-completing reviewers are visible to the downstream fixer batch. A `{ ...entry }` spread at any point silently freezes the entry's state at spawn time.

**3. Preserve the absorbed duplicate's wording.** A proximity merge can be a FALSE merge of two nearby defects. Append the duplicate's distinct `detail` and `failure_scenario` to the kept entry (`[dup <persona>: ...]`) so both write-ups still reach the verifier and fixer, not just the first reviewer's.

**4. Title-prefix matching must not degrade to the shorter title.** First attempt: `k = Math.min(30, ta.length, tb.length); ta.slice(0, k) === tb.slice(0, k)`. Review caught that this lets a short generic title ("race condition") absorb every distinct same-file defect whose title it prefixes. Final rule: a real 30-char normalized prefix only when BOTH titles are ≥30 chars; otherwise exact normalized equality. Relatedly, anchor a line-less kept entry at its first duplicate's line so it stops absorbing every later same-file finding through the title branch.

**5. Cap with an exemption — and give the exemption its own ceiling.** Suggested-severity findings draw from `MAX_VERIFY` slots; blocking findings always verify. But an exemption without a ceiling is an unbounded spawn path (reviewers that over-grade severity), so blocking gets its own generous `MAX_BLOCKING_VERIFY` ceiling. Every cap drop is logged with the finding's identity.

**6. Build the revival paths the cap creates.** Once severities can escalate via duplicates, three accounting moves are forced:
- A budget-dropped (never verified) entry escalated to blocking by a later duplicate gets its verifier LATE, and leaves the `budgetDropped` bucket.
- A REFUTED entry hit by a blocking duplicate is re-verified with the merged write-up — the refutation judged the original wording, not the new evidence — and leaves the `refuted` bucket.
- An entry that consumed a suggested slot and later escalates to blocking refunds its slot (it is now cap-exempt), so the escalation does not starve a later suggested finding. This needs a per-entry marker (`suggestedSlot`) — you cannot infer it from severity after the escalation.

**7. A crashed verifier is an infra failure, not a refutation.** "Fail if uncertain" still drops the finding, but counting the crash as `refuted` corrupts the stats (it claims a code-based disproof that never happened) and blocks revival path 6b. Use a separate `verifierFailed` bucket and log the dropped finding's identity.

**8. Make the accounting a tested invariant.** Expose a stats object on the workflow result — `reviewStats = { candidates, verified, refuted, dupes, budgetDropped, verifierFailed }`, `null` when the run halts before Quality — and assert in tests that `candidates === verified + refuted + verifierFailed + dupes + budgetDropped` across every path. Several hazards above (crash-as-refutation, escalation leaving a stale bucket) were caught precisely because tests `deepEqual` the full stats object rather than spot-checking one counter.

**9. A later gap-hunting pass must be told everything already examined.** The sweep's exclusion list initially contained only verified findings, so its few candidate slots were wasted re-deriving known-dead candidates that then died in dedup. Exclude verified, refuted, AND cap-dropped findings, each labeled with why it must not be re-reported.

## Why This Matters

Each hazard fails silently: stats that lie (crash counted as refutation), real defects dropped (false merges, frozen spreads, starved slots), or runaway spawns (uncapped blocking exemption). None crash the run — they corrupt its output, which is the failure mode the repo's workflow principles ("no silent caps", "fail if uncertain") exist to prevent. The next dedup-plus-budget stage written in any workflow here will hit the same nine items.

## When to Apply

- Any workflow stage where N producers emit candidate items, each item costs an agent spawn to validate, and heuristic identity merging happens — review pipelines, claim verification, issue triage.
- Whenever a spawn cap has a severity- or priority-based exemption: the exemption needs its own ceiling and the escalation/refund/revival accounting above.

## Examples

Same-defect rule, before and after the over-merge fix:

```js
// BEFORE (review finding: short titles absorb distinct defects)
const k = Math.min(30, ta.length, tb.length)
return k > 0 && ta.slice(0, k) === tb.slice(0, k)

// AFTER (commit 5a03092)
if (ta.length >= 30 && tb.length >= 30) return ta.slice(0, 30) === tb.slice(0, 30)
return ta.length > 0 && ta === tb // short titles must match exactly
```

Crashed verifier, before and after:

```js
// BEFORE: any falsy/dead verifier counted as refuted
refutedCount++              // a dead verifier counts as refuted — fail if uncertain

// AFTER (commit db22c28): infra failure is its own bucket; finding still drops
if (v) { entry.refuted = true; refutedCount++ }
else {
  verifierFailed++
  log(`Verifier agent died for ${findingRef(entry)} — finding dropped unverified (fail if uncertain)`)
}
```

Test scenarios covering the revival paths: S37–S39, S42, S44–S48 in `workflows/nadia-deliver.test.mjs` (48/48 passing on this branch).

## Related

- `CONTEXT.md` — glossary entries for finding verifier, verdict ladder, sweep, proximity dedup, verify budget
- `docs/workflows/patterns.md` — adversarial-verification pattern and its carved-out recall-biased exception for code-review findings
- Commits: `f9fa09a` (pattern), `db22c28`, `5a03092` (review-driven hardening)
