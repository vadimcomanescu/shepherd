# Verification and honesty doctrine

This is the spine of the practice. Shepherd is two coordinator scripts (`shepherd-plan` produces a plan document, `shepherd-deliver` drives that plan to a pull request), and both are built on one rule: **no agent's self-report is ground truth.** Anything downstream logic depends on must survive an independent, fresh-context verifier that is prompted to REFUTE it, and anything that cannot be confirmed is surfaced loudly, never dropped silently.

If you are new here, read the one-line orientation and follow the links: the two verifier personas live in [`./fleet.md`](./fleet.md), the dynamic-workflow substrate that makes "verifier agents" a primitive lives in [`../workflows/README.md`](../workflows/README.md), and the plan and deliver pipelines that invoke this machinery are detailed in [`./plan.md`](./plan.md) and [`./deliver.md`](./deliver.md).

---

## Thesis

A workflow that asks an agent "did you fix it?" and writes down "yes" has learned nothing the agent did not already believe. Self-reports drift, hallucinate, and round optimistically. So Shepherd treats every consequential claim as a hypothesis and spawns a separate agent, with a fresh context window, told to disprove it. The verifier reads the actual code or the actual commits, never the producer's reasoning. A claim is trusted only when an adversary fails to break it.

Two consequences follow, and both are load-bearing:

- **Fail if uncertain.** When the verifier cannot settle the question, the default is to act as though the claim is false. The exact meaning of "false" differs by side (see below), but the principle is constant: uncertainty is never silently resolved in the claim's favor.
- **Nothing is dropped quietly.** Every coverage loss, unverified drop, unaudited claim, capped finding, and confirmed-but-unfixed defect is recorded durably (in the run summary, the logs, or the PR body). Silent truncation is a defect, not a tidiness.

The governing rule is CLAUDE.md principle 4, mirrored as principle 5 in [`../workflows/README.md`](../workflows/README.md):

> Verify adversarially; default to "fail if uncertain". For findings that must be trusted, spawn independent verifier agents prompted to REFUTE. Require a majority. If uncertain, fail, do not silently pass. One carved-out exception: code-review findings are graded by the recall-biased finding-verifier persona (uncertain lands on PLAUSIBLE, never REFUTED) because dropping a real defect costs more than keeping an uncertain one; the mitigation is verdict-conditional fixing.

That one carved-out exception is the whole subtlety of this doc. The practice runs the doctrine with **two opposite defaults**, and which default applies where is decided entirely by a cost asymmetry.

---

## Two halves with opposite defaults

```
                    cost of the wrong call                default-on-uncertainty
  ----------------  -----------------------------------   -----------------------
  PLAN side         a false finding triggers REWORK on     drop it
  (precision)       a plan no engineer has acted on yet    (skeptical-refuter -> refuted)

  DELIVER side      a false drop SHIPS a real defect into   keep it
  (recall)          a PR that merges                        (finding-verifier -> PLAUSIBLE)
```

The asymmetry is the reason. On the plan side, a finding that turns out to be noise costs an engineer a rework cycle on a document. That is expensive, and the plan has not committed anyone to anything yet, so the cheaper mistake is to drop an unconfirmed finding. On the deliver side, a finding that turns out to be real but was dropped ships a defect into code that is about to merge. That is the expensive mistake, so the cheaper one is to keep an unconfirmed finding and fix it conservatively.

Same doctrine, inverted defaults, chosen deliberately. The glossary states the intent plainly: the finding-verifier is "a deliberate variant of the skeptical refuter scoped to review findings only" ([`../../CONTEXT.md`](../../CONTEXT.md)).

### PLAN side: precision-biased

The plan side runs inside the Review phase of `workflows/shepherd-plan.js`. Its verifier is the **skeptical-refuter** persona (`agents/skeptical-refuter.md`), which actively tries to refute one finding or claim against the actual code and, per its own brief, defaults to refuted when it cannot confirm the claim is real:

> Default to refuted=true if you cannot confirm it is real: an unverified finding that triggers work is more expensive than a dropped one.

The refuter is read-only (`Read, Grep, Glob, Bash`) and settles deterministic runtime claims by executing them (inline `node -e` / `python -c` or a `mktemp -d` scratch outside the shared worktree) rather than reading, because "Reading predicts; execution decides whether the behavior OCCURS." Severity doubt alone is not a refutation.

How the verdicts gate the run:

| Finding species | Verifiers | Halts the run? | Mechanism |
|-----------------|-----------|----------------|-----------|
| Normal gating finding (P0/P1, or a promoted manual error) | one `skeptical-refuter` (pipeline) | no | dropped or kept |
| Halt-class finding (P0 + manual + empty `suggestedFix`) | three `skeptical-refuter` (parallel) | yes, on 2-of-3 | the only finding type that can stop the run |
| KTD challenge (`claim-refuted`) | one refuter, then three arbiters (parallel) | yes, on 2-of-3 | arbitrates the decision itself |

- **A single refuter drops or keeps a normal gating finding, fail-closed.** The single-finding refuters run on a `pipeline()` (one verdict independently flips one finding, no barrier needed). A gating finding survives only if its refuter returns and `!v.refuted`. If the refuter returns `v.refuted`, it is dropped and logged. If the refuter **dies** (null verdict), the finding is also dropped, "per fail-closed default" (`workflows/shepherd-plan.js`, the `refute-r{r}-f{i}` dispatch). Note the general "require a majority" principle is realized here as an asymmetry: a single refuter is enough to drop or keep a normal finding, but a 2-of-3 majority is required to HALT the whole run.

- **Halt-class findings require a 2-of-3 majority to sustain.** The only finding species that can stop the run is `isHaltClass = severity === 'P0' && autofixClass === 'manual' && suggestedFix === ''`. It is evaluated BEFORE single refutation: three `skeptical-refuter` agents run in `parallel()`, and the run halts only if `sustainedVotes >= 2` (votes where `v && !v.refuted`). Nulls count as refuted here, "fail-closed on the runtime side, conservative against halting." This is the inverse fail-closed sense from the single-finding path: a dead verifier still cannot block the run.

- **KTD checks use referent-explicit verdicts and arbitrate the decision itself.** A Key Technical Decision (KTD) is challenged with `KTD_VERDICT_SCHEMA`, whose verdict enum is explicitly about the quoted claim, not a wrapped finding: `['claim-correct', 'claim-refuted', 'unverifiable']`. A **failed refutation attempt is `claim-correct`**, not `claim-refuted`; `claim-refuted` requires concrete contradicting evidence; and if the refuter can neither confirm nor refute the decision from code and docs, the verdict MUST be `unverifiable`. The prompt states the override directly: "Fail-if-uncertain here means surface, not auto-block." An `unverifiable` KTD is routed to Open Questions (`pendingDocEntries` + `openQuestions`) and continues; it does not block.

  This referent-explicit schema exists to kill a real bug. The inline comment in `workflows/shepherd-plan.js` records it: a refuter "wrote 'cannot be refuted' as its reason yet returned 'refuted'", and it was **observed live, twice**. The old enum never said WHAT was being sustained or refuted (the claim, or the refutation attempt), so stacked negations inverted the verdict. The fix is to make every verdict name its referent in words, and to arbitrate the DECISION ITSELF rather than a finding that wraps a negation of the decision.

- **Claim-refuted KTDs escalate to a 2-of-3 arbitration of the decision.** A `claim-refuted` verdict does not halt on the single refuter's word. It triggers three parallel arbiters using `KTD_ARBITRATION_SCHEMA` (`['ktd-is-wrong', 'ktd-is-right', 'cannot-tell']`), judging the plan's decision directly. The comment names this "the second inversion surface ('refute the refutation' stacks negations): arbiters judge THE DECISION itself ... never a wrapped finding." The run halts only if `wrongVotes >= 2`. Design intent, verbatim from the code: "no single refuter's verdict halts the run, and no confirmed-wrong KTD can reach 'ready'."

- **`refutedKtdOverflow` beyond the per-run allowance voids any READY exit.** KTD arbitration is allowed only `KTD_HALT_CAP` times per run (3 on standard/deep, 1 on lightweight). Beyond that, a refuted KTD is not silently dropped: it increments `refutedKtdOverflow`, is routed to Open Questions, recorded as a `dropped-cap` residual with reason "KTD halt-majority allowance exhausted", and a non-zero `refutedKtdOverflow` **voids any READY editor exit**. The editor's READY verdict is gated on `refutedKtdOverflow === 0` among its other conditions, and an explicit branch logs the void with the note "No later round can clear this state, the loop deliberately rides to the cap halt."

- **Refuters get positional data + locked context, never the author's reasoning.** Every plan-side prompt factory takes only positional finding/claim data plus the locked `CONFIRMED_INTENT` and `CODEBASE_CONTEXT` blocks. The prompts NEVER carry the author's or any prior agent's free-text reasoning, and the personas receive the document PATH, then read the document themselves. This is the independence guarantee in code: a verifier cannot inherit the very reasoning it is meant to challenge.

### DELIVER side: recall-biased

The deliver side runs inside the Quality phase of `workflows/shepherd-deliver.js`. Its verifier is the **finding-verifier** persona (`agents/finding-verifier.md`), which grades each code-review finding on a three-state ladder against the integration worktree:

| Verdict | Meaning | Survives? |
|---------|---------|-----------|
| CONFIRMED | concrete triggering inputs/state named AND the offending line quoted | yes |
| PLAUSIBLE | the DEFAULT for realistic-but-unproven runtime states (consistent with the code, trigger not constructible) | yes |
| REFUTED | the refutation is constructible from the code (a disproving line, invariant, or guard quoted) | no |

The rubric is recall-biased by design: "a dropped real problem costs more than a kept uncertain one, so uncertainty lands on PLAUSIBLE, never on REFUTED." Operationally, a finding survives unless the verifier returns an explicit `REFUTED` (`if (v && v.verdict !== 'REFUTED')` keeps the entry; "confirmed" findings carried to fixing are kept entries with a truthy verdict). Both CONFIRMED and PLAUSIBLE flow to the fixer.

The mitigation that makes "keep on uncertainty" safe is **verdict-conditional fixing**. Each surviving finding carries its verdict into the fixer's brief, which applies the policy verbatim:

- **CONFIRMED findings: fix unless you can prove from the code that the finding is wrong** (and if skipped, state exactly why it is provably wrong).
- **PLAUSIBLE findings: fix only when the fix is local and behavior-preserving**, otherwise skip it and cite the verifier's evidence in the skip reason.

This is the load-bearing pairing: recall-biased keeping is only acceptable because a kept-but-uncertain finding can never trigger a large, behavior-changing edit. The worst a PLAUSIBLE finding can do is a small, local, behavior-preserving fix, or get skipped with its evidence written into the PR body.

> `MAX_BLOCKING_VERIFY` (50) is a **dispatch-time** cap, not a hard guarantee. It bounds how many blocking-severity verifiers spawn on the first pass, but a finding the proximity-dedup pass later escalates to blocking gets its verifier immediately, bypassing the cap (the budget-dropped entry leaves the `budgetDropped` bucket and is re-queued). Treat 50 as a soft ceiling on a typical roster, not an absolute limit on blocking verifications.

---

## A crashed verifier is not a refutation

A verifier that dies is an infrastructure failure, not evidence. Conflating the two corrupts the practice in two directions: it lies about coverage (you did not verify the finding, you lost the agent), and it can block the revival path that a later duplicate would otherwise trigger.

So both sides separate the two. On the deliver side, a genuine code-based `REFUTED` is recorded into `reviewDrops.refuted` with the verifier's evidence and marked so a later blocking duplicate can revive it. A **dead** verifier instead increments a separate `verifierFailed` bucket and drops the finding (fail if uncertain), with the explicit instruction "never report infra failure as a refutation." The plan side mirrors this: a dead single-finding refuter drops the finding per the fail-closed default but is not a `roundRefuted` refutation by code-based evidence.

The accounting is a tested invariant. The pre-verification dedup solution doc records the hazard ("A crashed verifier is an infra failure, not a refutation") and the fix that split `verifierFailed` out of the refuted count, with the invariant `candidates === verified + refuted + verifierFailed + dupes + budgetDropped`. The before-state once counted a dead verifier as refuted; that was a bug.

---

## The honesty layer past verification

Verification proves a finding is real. The honesty layer proves the work that came after the finding is also real. The pattern is the same fresh-context-auditor shape applied to claims of completion, and the glossary names it the **Self-report audit**: an agent's claim about completed work is checked by a separate fresh-context agent against observable state, and a dead auditor leaves a durable marker rather than silent trust ([`../../CONTEXT.md`](../../CONTEXT.md)).

- **The fix audit.** Fixer "fixed" lists are self-reports, not facts. One fresh-context auditor (`audit-fixes`, sonnet) re-reads the actual commits per file (`git log --oneline -- <file>`, then `git show`) and reports any claim with no backing commit. Unsupported claims are demoted to residuals with the reason "fixer claimed fixed, but the audit found no supporting commit". The auditor judges only from commits it read in this session and changes nothing.
- **The fail-closed audit fallback.** A dead fix-audit agent, or an audit skipped at the token-budget floor, leaves a durable `UNAUDITED` residual (`fixAudit.unaudited`) rather than silently trusting the claims. It surfaces as a PR line: "(UNAUDITED) N review-fix claim(s) were never independently audited ... verify the 'fix: address review findings' commits by hand."
- **The ship-gate recheck.** The push is the one irreversible step, and validation's `testsPass`/`lintPasses` are a single agent's self-report. So a fresh-context agent (`gate-recheck`, sonnet) re-runs the test and lint commands at the ship boundary and reports strictly from the exit codes it observes this session. A contradiction (`!shipGate.testsPass || !shipGate.lintPasses`) or a dead recheck **fails closed**: the branch is left unpushed.
- **Validation audited against this-session exit codes.** The validation agent reports satisfied/partial/unmet per requirement and is told to "Audit every verdict you report against a tool result from THIS session, `testsPass` and `lintPasses` come strictly from the exit codes of the commands you ran above, never from memory, expectation, or a prior agent's report."
- **The Self-report audit across the whole tail.** The same shape covers ship "pushed"/PR-state claims and compound "documented"-path claims (`audit-compound`), each checked against observable state (git/gh output, files on the branch). Unsupported claims demote to residuals or are corrected to the observed state.

### Residuals: the durability mechanism

A **residual** is how the honesty doctrine becomes observable to a human. A confirmed-but-unfixed finding, an UNVERIFIED drop, a COVERAGE GAP, an unmet requirement, an UNAUDITED claim, or an unresolved CI failure is written verbatim into the PR body. Under the autopilot contract, a residual is never silently dropped and never prompts the operator. Concrete PR-body lines, quoted as the coordinator literally emits them (the separators inside these code spans are the code's, not this doc's prose):

- `(<severity>, <verdict>) <file> — <title>: <reason>` for confirmed-but-unfixed findings.
- `(UNVERIFIED) <key> — refuter produced no verdict; dropped fail-closed without verification` for `verifierDied` drops.
- `(COVERAGE GAP) reviewer <key> produced no result — its entire review perspective is missing from this PR's quality gate` for a dead reviewer (a dead reviewer is "NOT a clean reviewer: its whole perspective is gone").
- `(UNAUDITED) N review-fix claim(s) were never independently audited` for a skipped or dead fix audit.

The loud-cap rule is the plan-side equivalent. Gating findings beyond `FINDING_REFUTER_CAP` per round are routed to documentation WITHOUT verification, logged, and recorded as `dropped-cap` residuals; KTD claims beyond `KTD_CAP` are surfaced in the run summary's `openQuestions`. No bound on coverage is silent.

---

## Second-model review

Same-family review rationalizes away the things the authoring model already believes. So when Codex is usable, the reviewer roster adds a different model family. The **codex-reviewer** persona (`agents/codex-reviewer.md`) runs the Codex CLI (`codex exec`) read-only over the integration diff (`git diff <base>...HEAD`), hunting "logic errors, broken edge cases, contract violations, and risky changes a reviewer from the authoring model family might rationalize away." It is a mechanical protocol operator: it performs no review judgment itself and modifies nothing (it even verifies the worktree is untouched and restores anything Codex changed).

Crucially, Codex's findings are not trusted for being Codex's. They face the **same** Claude `finding-verifier` as the Claude persona reviewers, on the same verdict ladder, under the same verdict-conditional fixing. The comment in `workflows/shepherd-deliver.js` states it: "its findings face the same Claude verifier." That is cross-model in both directions: a different family produces candidates, and a Claude verifier grades them, while Claude personas produce candidates the same verifier grades. The codex-reviewer's prompt enforces the same producer-wide rule as the Claude reviewers ("Pass every candidate with a nameable failure scenario through, do not silently drop half-believed candidates; an independent verifier judges them next"), keeping the producer wide and the verifier narrow on both sides.

---

## See also

- [`./fleet.md`](./fleet.md): the two verifier personas (`skeptical-refuter`, `finding-verifier`) and the rest of the agent fleet.
- [`./plan.md`](./plan.md): the Review phase that runs plan-side refutation and KTD arbitration.
- [`./deliver.md`](./deliver.md): the Quality, Validate, and Ship phases that run deliver-side verification, the fix audit, and the ship-gate recheck.
- [`../workflows/README.md`](../workflows/README.md): the dynamic-workflow substrate: principle 5 (verify adversarially) and the adversarial-verification pattern this doctrine instantiates.
- [`../../CONTEXT.md`](../../CONTEXT.md): the glossary entries for every term used here (Adversarial verification, Skeptical refuter, Finding verifier, Verdict ladder, Self-report audit, Residual).
