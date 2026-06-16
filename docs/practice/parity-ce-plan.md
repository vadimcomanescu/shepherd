# ce-plan parity matrix

This matrix maps every ce-plan agent, phase, and doctrine element to its shepherd-plan coverage. Each row belongs to exactly one coverage class: **covered**, **covered-stronger**, **intentionally-not-implemented**, or **gap**. The four gaps are enumerated at the bottom with their open/closed status. The six shepherd additions absent from ce-plan follow separately.

Sources: ce-plan from `EveryInc/compound-engineering-plugin` (`skills/ce-plan/SKILL.md`); shepherd-plan from [`../../workflows/shepherd-plan.js`](../../workflows/shepherd-plan.js) and the persona files under [`../../agents/`](../../agents/).

---

## 1. Getting started and setting scope

| ce-plan element | shepherd-plan coverage | Class |
|---|---|---|
| Invoke with description, requirements doc, or old plan; always produces a plan, never bails early | Invoked with a request or origin doc; runs autonomously to completion or to an honest structured halt | covered |
| Output format choice: Markdown or styled HTML | Always one Markdown file | intentionally-not-implemented |
| Re-open an existing plan and update or deepen it in place | Always writes a brand-new plan file; never edits an existing one | intentionally-not-implemented |
| Approach-first checkpoint: stop, plan how to plan, wait for human go-ahead | No checkpoint; autonomous only, so there is no "wait for go-ahead" step | intentionally-not-implemented |
| Non-software routing: trips, study plans, research questions get a different path | If the request is not code, the run halts immediately with a `directPrompt` or structured halt; software-only by design | intentionally-not-implemented |
| Read the request and lock the scope; fill in problem, goals, scope, blockers via Q&A | Reads the request/origin and fills in a required structured form (problem, success criteria, scope, blocking questions); no back-and-forth | covered-stronger (form is enforced by schema) |
| Separate real product blockers (stop) from technical questions answerable during planning | Same split: "must answer before I can plan" causes a structured halt; "I can decide this myself" is recorded as an assumption and the run continues | covered |
| Pick depth tier Lightweight / Standard / Deep; can upgrade it mid-flight after research | Picks depth once at the very start from an estimated unit count; never revisited after research | **gap** (dynamic-depth-upgrade, STILL OPEN -- see [Gap 4](#gap-4-dynamic-depth-upgrade)) |
| Scope-and-forks check: show the scope to the human and wait for confirmation before research | Strategy gate: challenges the scope and key forks internally after research; no human confirmation step | covered (automated, not interactive) |

---

## 2. Research

| ce-plan element | shepherd-plan coverage | Class |
|---|---|---|
| Repo-research agent: study the codebase | `repo-researcher` persona runs in parallel during the Research phase | covered |
| Past-learnings agent: mine past decisions | `learnings-researcher` persona mines `docs/solutions/` via frontmatter metadata | covered |
| Optional Slack search for prior discussion | No Slack; mines the repo's own solved-problems docs instead | intentionally-not-implemented |
| Detect test-first / legacy-hardening work; tag affected units with the execution-posture note | Delivery reads and obeys the execution-posture tag; nothing in shepherd-plan ever sets it | **gap** (test-first/legacy executionNote tagging, STILL OPEN -- see [Gap 2](#gap-2-test-first--legacy-executionnote-tagging)) |
| Decide whether to do outside research; classify intent (landscape vs implementation-guidance) | Same decision gate; `web-researcher` dispatched for landscape or mixed; `external-grounding-researcher` dispatched for implementation-guidance or mixed | covered |
| Bump Lightweight to Standard when research reveals an external-contract touch (public API, env vars, CI, shared types) | No such upgrade; depth tier was locked at intake | **gap** (dynamic-depth-upgrade, STILL OPEN -- see [Gap 4](#gap-4-dynamic-depth-upgrade)) |
| Map user/data/control flows and edge cases (Standard/Deep only) | `flow-analyzer` runs at standard and deep tiers; skipped and logged at lightweight | covered |

---

## 3. Structuring and writing the plan

| ce-plan element | shepherd-plan coverage | Class |
|---|---|---|
| Break work into commit-sized units with goal, files, dependencies, approach, test scenarios | Same unit fields; additionally machine-checks for dependency loops and for two units editing the same file without a declared dependency | covered-stronger |
| List affected users, developers, operations, and other teams (one explicit upfront step) | Covered across the review lenses; not a single dedicated upfront step | covered |
| Add a technical-design diagram when the shape needs one | Adds diagrams when they help | covered |
| Verify a diagram is actually present after writing | No presence check | intentionally-not-implemented (minor; shepherd's structural checkers cover structural correctness, not diagram presence) |
| Write the plan document using a fixed section list | `plan-author` persona writes the document using the same fixed section list (deliberately kept compatible with `ce-plan` format) | covered |

---

## 4. Review and quality

| ce-plan element | shepherd-plan coverage | Class |
|---|---|---|
| Author self-review against a checklist | `plan-editor` must enumerate every one of 14 named failure-mode classes before choosing READY or REVISED | covered-stronger |
| Doc-review pass: a second pass to clean up clarity | Seven independent review lenses (scope, feasibility, coherence, security, product, design, adversarial) run in parallel; a 7-item release checklist that can halt the run | covered-stronger |
| Adversarial checking inside doc-review (one reviewer persona) | Independent skeptic agent re-checks every important claim against the real code; requires a 2-of-3 majority vote; defaults to reject-if-unsure | covered-stronger |
| Score section confidence; dispatch fresh research to strengthen weak-but-coherent sections | Review loop only identifies and fixes defects; it does not enrich a section that is internally consistent but under-researched | **gap** (thin-section-enrichment, STILL OPEN -- see [Gap 1](#gap-1-thin-section-enrichment)) |
| Route risky sections to dedicated specialists (data-integrity, performance/capacity, deployment, architecture) | Seven review lenses are all generalists; no lens owns data-migration safety, performance/capacity, or rollout/rollback in depth | **gap** (risk-specialists, STILL OPEN -- see [Gap 3](#gap-3-risk-specialists)) |
| Confirm plan covers the original request (self-review re-read) | Blocking origin-coverage gate: walks every required item from the original request; halts the run if any item is not addressed | covered-stronger |

---

## 5. Handoff

| ce-plan element | shepherd-plan coverage | Class |
|---|---|---|
| Handoff menu: start work, deeper review, make an issue, open in Proof web app; interactive choice | Returns a machine-readable run summary (`planPath`, `planVersion`, `nextStep`, `residualFindings`); feeds directly into shepherd-deliver via a manual operator handoff | covered (different shape: human menu vs. automatic structured handoff) |

---

## Coverage summary

| Class | Count |
|---|---|
| covered-stronger | 8 |
| covered | 12 |
| intentionally-not-implemented | 7 |
| gap | 4 |

---

## The four gaps

### Gap 1: thin-section-enrichment

**Status: STILL OPEN.** ce-plan scores each section's confidence after writing the draft and dispatches fresh research to strengthen the weakest sections, even sections that are internally coherent. Shepherd's review loop finds and fixes defects; it does not enrich a section that is consistent but under-researched. A decision with plausible-sounding-but-unverified reasoning, or a named pattern without a current-docs check, can pass every shepherd review lens. The adversarial skeptic and the up-front research partially mitigate this, but the dedicated enrichment pass does not exist.

### Gap 2: test-first / legacy executionNote tagging

**Status: STILL OPEN.** Both tools support a per-unit `executionNote` field carrying the execution posture ("write the test first," or "characterize the old behavior before changing it"). Shepherd-deliver reads this field and behaves accordingly. The problem is nothing in shepherd-plan ever sets it: a legacy-hardening or risky-refactor job reaches the implementer with an empty field and defaults to the standard posture. ce-plan detects the signals during research (signs of legacy code, test-first indicators) and tags the affected units.

### Gap 3: risk-specialists

**Status: STILL OPEN.** For high-stakes work, ce-plan routes risky sections to dedicated specialist reviewers: data-integrity for migrations, performance for scaling, deployment for rollout/rollback. Shepherd has seven good general lenses (scope, feasibility, coherence, security, product, design, adversarial) but none owns data-migration safety, performance/capacity, or rollout verification in depth. On a plan touching a database migration or a scaling concern, no lens on shepherd's review side has that as its job. (Note: shepherd-deliver's Quality phase does dispatch `ce-data-migration-reviewer` and `ce-adversarial-reviewer` during code review, but that is post-implementation, not planning-time.)

### Gap 4: dynamic-depth-upgrade

**Status: STILL OPEN.** Shepherd picks the depth tier (Lightweight / Standard / Deep) once at intake, from an estimate of how many units the work will be, before research has run. ce-plan can upgrade Lightweight to Standard mid-flight when research reveals the change touches an external contract (public API, env vars, CI, shared types), turning on deeper flow analysis. A job that looked small at intake but crosses a system boundary stays at the small tier in shepherd and skips that analysis.

---

## Six shepherd additions absent from ce-plan

These are shepherd capabilities that exist in ce-plan's planning flow not at all, or only in a weaker form. They are the normative "covered-stronger" class above and apply regardless of which gaps remain open.

1. **Adversarial refutation.** An independent skeptic agent re-checks every important claim and decision against the actual code. Needs a 2-of-3 majority vote to keep a claim. Defaults to reject-if-unsure. ce-plan's adversarial check is one reviewer persona inside doc-review, not an independent verification pass with a majority gate.

2. **KTD arbitration.** After the adversarial refutation pass, a Keep / Trim / Drop arbitration step reconciles the skeptic's findings with the review lenses' findings, decides which fixes are blocking, and prevents fix churn. ce-plan has no equivalent.

3. **Plan-editor verdict with failure-mode enumeration.** The `plan-editor` persona must enumerate every one of 14 named failure-mode classes before returning a READY or REVISED verdict. A READY verdict with incorrect evidence counts is discarded. ce-plan's doc-review pass reviews for clarity; it does not require an enumerated failure-mode sweep.

4. **Structural checkers (machine-enforced, not prose review).** The coordinator runs automatic checks: dependency-loop detection (no unit can transitively depend on itself), two-units-editing-the-same-file detection (requires a declared dependency between them), dangling-requirement-reference detection (every R-ID cited in units must exist in the requirements section), and a downstream-parse check (the plan file must be parseable by shepherd-deliver's parser before release). ce-plan has no equivalent machine checks; its structural review is inside the doc-review persona.

5. **Gate battery.** A release checklist that can halt the run: the plan must pass the `plan-editor` READY verdict, the structural checkers, the origin-coverage gate (walks every required item from the original request and fails if any is not addressed), and the downstream-parse check. All gates must pass before the plan is released. ce-plan's quality checks are review personas, not halt gates.

6. **Autonomous halts.** Three honest exits before a plan is produced: (a) a trivial request exits at intake with a ready-to-use `directPrompt` (execute directly, no plan needed), (b) a blocking unknown produces a structured halt whose `nextStep` tells the operator what to resolve, (c) a non-code request produces a structured halt with `reason: non-code`. ce-plan always produces a plan; it never bails early.

---

## Intentionally omitted ce-plan capabilities (not defects)

These are ce-plan features shepherd does not implement on purpose. They are not gaps to close.

- **Multi-purpose planning.** ce-plan handles trips, study plans, research questions, and other non-software goals. Shepherd is a code-plan engine by design. Non-code requests are a structured halt, not an attempt.
- **Interactive checkpoints.** The approach-first checkpoint (stop and plan how to plan, then wait for go-ahead), the resume/deepen-in-place flow, and the handoff menu (start work / deeper review / make an issue / open in Proof) all require a human to wait and respond. Shepherd is autonomous; these would be no-ops. ce-plan itself turns all of them off when running headless.
- **Slack research.** ce-plan can optionally search Slack for prior discussion of the problem. Shepherd mines the repo's own `docs/solutions/` instead. Slack is an optional integration for ce-plan and is not part of shepherd's scope.
- **HTML output.** ce-plan can render the plan as a styled HTML file. Shepherd always produces a single Markdown file, which is the format shepherd-deliver's parser expects.
- **In-place plan re-open and deepen.** ce-plan can read an existing plan and update or deepen it. Shepherd always starts fresh; the versioned handoff (`planVersion` content hash) ensures deliver never acts on a stale copy of an edited plan.
