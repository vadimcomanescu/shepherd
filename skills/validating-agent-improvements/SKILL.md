---
name: validating-agent-improvements
description: Validate a proposed improvement to a workflow coordinator or agent persona before shipping it — playground A/B simulation for behavior changes, deterministic harness for data-flow changes, evidence transfer for repeats of a proven mechanism. Use whenever a change to a coordinator, persona, or their data flow claims a behavioral or correctness improvement that has not been observed yet.
---

You are validating a claim of the form "this change to a coordinator, an
agent persona, or their data flow improves behavior or correctness." Claims
like this are cheap to make and expensive to be wrong about. Do not ship one
unvalidated.

## Pick the validation mode

1. **Data-flow / observability change** (no agent-visible prompt changes:
   schemas, logging, result fields, residual routing) -> the deterministic
   harness IS the simulation. Stub the agents, execute the real coordinator,
   assert the information flows. No playground sim adds anything.
2. **Prompt or persona change** (any text an agent will read) -> playground
   A/B simulation. Behavior claims need observed behavior.
3. **Repeat of a mechanism already measured** (same structure: e.g. grounding
   another sequential contextless dispatch with prior outcomes) -> evidence
   transfer is acceptable IF the change is bounded, fail-loud in its worst
   case, and doctrine-backed — and ONLY with a skeptical refuter explicitly
   instructed to attack the transfer claim. If the refuter breaks the
   analogy, run the sim.

## Design the A/B

- One isolated git worktree per run, from the playground repo: a local
  sibling checkout named `nadia-playground` (next to this repo's own
  checkout). It is persistent infrastructure — never delete it; document new
  scenarios in its README. If it is missing on this machine, recreate it
  from the canonical spec in this repo at `docs/playground.md` before
  validating anything.
- Untracked files (`.env`) do not propagate to worktrees — copy them into
  each one.
- Identical briefs and the SAME model in both arms; the only variable is the
  text under test, inlined between persona/instruction tags.
- 2 runs per arm minimum; a 1-run delta is an anecdote.
- Judge on artifacts (commits, diffs, test results, report content), not on
  whether the agent sounded confident.

## Design the trap — where most validations fail

- A trap works only when the right answer requires information the agent
  CANNOT derive from the visible failure alone (a gitignored file, a
  symptom-patched helper, an IEEE754 result). Competent baselines pass weak
  traps: a reference-check trap failed 0/2 to differentiate; a
  symptom-patch trap produced a clean 0/2 -> 2/2 gradient.
- Execute your trap values before trusting them. Reasoning said
  `round2(0.615)` misrounds; running it said otherwise — the trap itself was
  wrong. If your trap claim is about runtime behavior, run it.
- Instruction wording is part of the experiment: weak wording ANCHORS (an
  agent told about a prior fix mirrored it instead of diagnosing afresh).
  Iterate wording against the sims (v1 -> v2) and keep the measured version.

## Report honestly

- A null result is a result. If baselines already do the right thing, say so
  in the PR and do not ship the behavior claim — then look one level up:
  sims that refute a prompt rule often expose a coordinator-side gap in
  passing (discarded reports, missing grounding). Ship the confirmed gap.
- Reframing is legitimate when the data demands it (e.g. "induces execution"
  -> "guard-rails the execution that demonstrably already happens"), but the
  PR must state the original claim, the observed data, and the reframe.

## Review before shipping

- Minimum angles: a skeptical-refuter run on the full improvement claim
  (default to refuted; give it the diff, the old version, the dispatch sites,
  and explicit attack angles) plus a correctness review of the diff — two
  independent angles; scale to N refuters with a majority rule when the
  claim is high-stakes (repo principle 4). Add a standards review when
  frontmatter/descriptions change — descriptions are load-bearing for
  dispatch.
- Apply every Important finding, then send the revised diff back to the same
  reviewer for a one-line-per-finding closing verdict. Suggested wordings
  from reviewers are adopted, not paraphrased, unless you state why.
- Always on a branch in its own worktree; check `git merge-tree` against
  every open PR branch before opening yours; stack on the conflicting PR
  rather than racing it, and state the merge order in the PR body.

## The PR body is part of the validation

State: the gap (with the old code/text quoted), the sources, the validation
mode and its data (per-arm tallies, not adjectives), every review finding and
its resolution, known residual risks, and merge-order notes. A reader must be
able to re-run your validation from the body alone.
