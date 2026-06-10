# Dogfood ledger — routing measurements

## Executive summary (for reviewing the executor-router/ce-work-deterministic diff)

26 measured dispatches over one day (~$14 API-equivalent). The drafted rubric was validated three ways: 15 A/B experiment dispatches across 6 feature classes, a 6/6 retrospective back-test, and 8/8 first-try-correct live-routed units that built an entire multi-user feature for ~$2.19 with zero rework. Core results:

1. **Tier separation comes from ambiguity × size, not the risk label.** Haiku matched bigger models on every well-specified small task (f1–f3); Opus won decisively only when design decisions were left open (f4: blind 7.5 vs 4.5).
2. **Risk escalates the verification tier, not just the executor tier.** On auth work, haiku and sonnet tied 7/7 functionally — the security difference (6.5 vs 4.0) was only visible to a blind security review (f5).
3. **Codex gpt-5.5's niche is mechanical pattern-clones with sandbox-safe (no-network) verification**, where parallel waves absorb its 4–5× wall time; effort `high` never beat `medium`; its printed token count understates true usage 6.5×.
4. **Fable's planning premium is real where plan errors cascade** (f7 plans: blind 8.0 vs opus 6.0 at 1.7× cost — fable caught a soundness gap and two grounding discrepancies opus missed). Never route fable to execution.

The full findings (1–22), per-dispatch rows, and the final routing table are below.

Cost rates ($/MTok in,out): fable-5 10/50 · opus-4.8 5/25 · sonnet-4.6 3/15 · haiku-4.5 1/5 · codex-gpt-5.5 ~1.25/10 (assumed API-equivalent; subscription marginal cost $0).

| # | Date | Feature | Executor / model (effort) | Tokens in | Tokens out | Est. cost | Correctness | Notes |
|---|------|---------|---------------------------|-----------|------------|-----------|-------------|-------|
| 1 | 2026-06-10 | f1 todos page+API | codex gpt-5.5 (medium) | 470,626 (403,584 cached) | 5,793 (1,126 reasoning) | ~$0.19 | 5/5 | ~3.5 min wall. In-sandbox `npm run build` failed (no network for next/font Google Fonts); code itself correct, verified externally |
| 2 | 2026-06-10 | f1 todos page+API | claude sonnet-4-6 | 21 + 198,481 cache-read + 33,094 cache-write | 2,626 | ~$0.22 | 5/5 | 42 s wall, 10 tool uses. Build verified in-run |

| 3 | 2026-06-10 | f2 toggle/delete + optimistic UI | claude haiku-4-5 | 55 + 260,884 cache-read + 50,961 cache-write | 1,420 | ~$0.10 | 6/6 | 49 s wall, 10 tool uses. Extracted shared store module unprompted; rollback present |
| 4 | 2026-06-10 | f2 toggle/delete + optimistic UI | codex gpt-5.5 (medium) | 331,125 (276,864 cached) | 3,978 (836 reasoning) | ~$0.14 | 6/6 | ~2.5 min wall. tsc+lint in-sandbox verification (per finding 3) worked; build verified externally |

| 5 | 2026-06-10 | f3 JSON-file persistence, safe concurrent writes | claude haiku-4-5 | 75 + 327,444 cache-read + 85,187 cache-write | 3,097 | ~$0.15 | 8/8 | 33 s wall, 14 tool uses |
| 6 | 2026-06-10 | f3 JSON-file persistence, safe concurrent writes | claude sonnet-4-6 | 28 + 329,678 cache-read + 54,968 cache-write | 4,352 | ~$0.37 | 8/8 | 76 s wall, 13 tool uses |
| 7 | 2026-06-10 | f3 JSON-file persistence, safe concurrent writes | codex gpt-5.5 (high) | 690,662 (650,112 cached) | 7,365 (2,733 reasoning) | ~$0.21 | 8/8 | ~3.5 min wall. Touched page.tsx beyond dossier scope (lint appeasement) |

| 8 | 2026-06-10 | f4 search/filter, URL state (AMBIGUOUS dossier) | claude haiku-4-5 | 122 + 385,486 cache-read + 59,108 cache-write | 8,141 | ~$0.15 | build ✓; quality 4.5/8 | 75 s, 13 tool uses, 388-line diff. Lost: URL not source of truth, no a11y, debounce-in-state rerender, unused ref |
| 9 | 2026-06-10 | f4 search/filter, URL state (AMBIGUOUS dossier) | claude opus-4-8 | 36,999 + 197,752 cache-read + 68,755 cache-write | 5,550 | ~$0.85 | build ✓; quality 7.5/8 | 73 s, 6 tool uses, 195-line diff. URL as source of truth, full a11y, clear-filters affordance, canonical-URL hygiene |
| 10 | 2026-06-10 | f4 blind comparative grading | claude sonnet-4-6 (grader) | 10 + 13,445 cache-read + 48,620 cache-write | 2,194 | ~$0.22 | n/a | measurement overhead; arms anonymized |

| 11 | 2026-06-10 | f5 auth middleware (risk-high, WELL-SPECIFIED) | claude haiku-4-5 | 102 + 1,666,833 cache-read + 73,529 cache-write | 7,455 | ~$0.30 | func 7/7; security 4.0/7 | 104 s, 33 tool uses. Hand-rolled length-leaking "constant-time" compare; catch-all matcher + dead code; misleading security comments |
| 12 | 2026-06-10 | f5 auth middleware (risk-high, WELL-SPECIFIED) | claude sonnet-4-6 | 30 + 642,402 cache-read + 108,816 cache-write | 5,552 | ~$0.68 | func 7/7; security 6.5/7 | 100 s, 17 tool uses. timingSafeEqual on padded buffers; crypto.subtle.verify; surgical matcher |
| 13 | 2026-06-10 | f5 blind security grading | claude opus-4-8 (grader) | 36,858 + 50,238 cache-read + 72,792 cache-write | 5,292 | ~$0.79 | n/a | found shared backslash open-redirect gap both arms missed |

| 14 | 2026-06-10 | f6 data-layer extraction + vitest tests (cross-cutting) | claude sonnet-4-6 | 45 + 704,695 cache-read + 64,910 cache-write | 6,980 | ~$0.56 | tests 7/7; build ✓; regression ✓ | 132 s, 24 tools. Found+fixed latent init race from f3 |
| 15 | 2026-06-10 | f6 data-layer extraction + vitest tests (cross-cutting) | codex gpt-5.5 (xhigh) | 1,206,488 (1,141,504 cached) | 17,308 (9,350 reasoning) | ~$0.40 | tests 7/7; build ✓; regression ✓ | ~8 min wall, 1.22M total tokens. Also fixed the init race. Drive-by edit to page.tsx (lint), reported honestly |

Correctness rubric f1 (5 pts): build passes; GET [] ; POST valid→201+todo; POST invalid→400+error; /todos page 200.
Correctness f6: 7/7 vitest suite (incl. fresh-store concurrent adds), build, full auth+CRUD regression. Both arms independently caught the f3 concurrent-initialization race the burst test had missed.
Security rubric f5 (7 pts, blind-graded by opus): open-redirect on `from`; constant-time pw compare; HMAC verify quality; cookie lifecycle; matcher exactness; secret hygiene; security-surface code quality. Functional rubric f5 (7 pts, scripted): redirect w/ from; api 401; wrong pw 401; cookie flags; valid cookie 200; tampered 401; expired 401.
Quality rubric f4 (8 pts, blind-graded): URL source of truth; back/forward sanity; no history flooding; filter composition + canonical URL; Suspense correctness; empty states; a11y; integration quality.
Correctness rubric f3 (8 pts): build; missing file→[]; persists across restart; PATCH/DELETE intact; 10-parallel-POST burst loses nothing; corrupt JSON→[] 200; temp+rename atomicity; serialized writes. All verified by running, not inspection (except atomicity pattern).
Correctness rubric f2 (6 pts): build; PATCH toggle→200 done:true; PATCH bad id→404; DELETE→204; DELETE bad id→404; /todos page 200. Optimistic rollback checked by code inspection.

## Findings

1. **Trivial well-specified feature: Sonnet 4.6 ≈ Codex-medium on cost (~$0.20 both), Sonnet ~5× faster wall-clock and verifies in-harness.** Both fully correct.
2. **Codex's printed "tokens used" understates real usage 6.5×** — it reports uncached-input + output only (72,835 vs 476,419 total). Use the session jsonl (`~/.codex/sessions/.../rollout-*.jsonl`, `total_token_usage`) for honest accounting.
3. **Codex sandbox cannot run `npm run build` on a stock create-next-app** (no network → next/font/google fetch fails). The executor-router's "self-contained verification" criterion silently breaks for Next.js-with-Google-Fonts tasks routed to codex; either verification happens outside codex or the dossier must say "verify with tsc+lint only".
4. Claude-side cost is dominated by cache writes+reads of the big system prompt (~230k); output was only 2.6k. Marginal cost of routing small tasks to Sonnet is low and mostly fixed.

5. **Haiku 4.5 clears small well-scoped behavioral changes** (f2: 6/6, ~$0.10, 49 s — cheapest and fastest arm so far). It even extracted a shared store module unprompted. One sample; reliability ceiling unknown.
6. The tsc+lint-only verification instruction fixes codex's sandbox problem (finding 3) — codex f2 verified clean in-sandbox and the external build confirmed it.

7. **f3 (risk surface: concurrency + error handling) did not separate the tiers** — haiku, sonnet, codex-high all 8/8 under adversarial verification (restart persistence, 10-parallel burst, corrupt file). Cost: haiku $0.15 < codex-high $0.21 < sonnet $0.37. Speed: haiku 33 s < sonnet 76 s < codex ~3.5 min.
8. **Nominal "risk" alone doesn't justify model escalation when the dossier is well-specified and the diff is small.** The discriminator must be ambiguity and/or task size, not the risk label. (Caveat: all dossiers so far are tightly specified — which matches what ce-work-deterministic's task-splitter produces, so this evidence transfers.)
9. Codex-high drifted slightly out of scope (modified page.tsx to appease lint). First scope deviation observed in any arm.

### Routing implications so far (3 experiments — consistent)
- **Haiku 4.5 is 3-for-3 perfect** (19/19 rubric points) across trivial → behavioral-change → risk-surface tasks, always cheapest and fastest. For well-specified dossiers with small diffs, haiku is the rational default executor.
- Sonnet's premium (~2.5× haiku) bought nothing measurable yet; treat sonnet as the fallback when haiku fails or the dossier exceeds a few files.
- Codex (medium or high) has not beaten the cheaper Claude tier on any axis at this task size; high effort tripled its context churn (698k total tokens). Its remaining candidate niche: large mechanical multi-file loops (test at f6).
- Next discriminator to probe: **ambiguity**. f4 will ship a deliberately under-specified dossier (the router's CLAUDE-routing criterion) and A/B haiku vs opus to test whether judgment tasks separate tiers.

10. **Ambiguity DOES separate tiers (f4).** Blind grading: opus 7.5/8 vs haiku 4.5/8. Haiku's build passed and the feature "works", but it mirrored URL state into local state (URL not source of truth), shipped zero a11y, and left debris (debounce timer in useState → rerender per keystroke, unused ref). Opus produced half the diff (195 vs 388 lines), used half the tool calls (6 vs 13), same wall time, and made the senior-engineer calls unprompted.
11. **Opus premium on an ambiguous small task: ~5.7× haiku ($0.85 vs $0.15) — and worth it there**, since haiku's output would cost a review-and-fix cycle exceeding the delta.
12. Measurement overhead exists: each blind grading pass ≈ $0.22 (sonnet). Use only when arms genuinely need comparative judgment.

### Routing implications (4 experiments — getting solid)
- **The routing key is ambiguity × size, not risk label.**
  - Well-specified + small diff (≤ ~3 files): **haiku-4-5** (4-for-4 on correctness at this class).
  - Well-specified + larger or unfamiliar surface: **sonnet-4-6**.
  - Ambiguity "some"/"high", UI/UX judgment, design decisions left open: **opus-4-8** — measurably better decisions, not just style.
  - Fable 5: never for execution (per user constraint; nothing measured here contradicts it).
- Codex gpt-5.5: no win yet at any effort on small tasks (slower, never cheaper than the right Claude tier, one scope deviation). Last candidate niche: large mechanical multi-file work — f6 decides.
- Still untested: f5 (auth middleware, risk-high well-specified — does sonnet suffice where rubric says escalate?), f6 (cross-cutting refactor — codex xhigh vs sonnet).

13. **Risk-high tasks separate haiku from sonnet — at the security-review layer, not the functional layer (f5).** Both arms passed all 7 scripted functional checks (redirects, 401s, cookie flags, tamper rejection). Blind opus security grading: sonnet 6.5/7 vs haiku 4.0/7. Haiku hand-rolled a length-leaking "constant-time" comparator (the canonical anti-pattern) with a comment claiming it prevents timing attacks, and used a catch-all matcher with dead code; sonnet reached for timingSafeEqual on padded buffers and crypto.subtle.verify.
14. **Functional tests alone are insufficient to score risk-surface tasks** — haiku would have scored 7/7 without the security review. Routing rubric AND verification depth must escalate together on risk.
15. **Both arms missed the backslash open-redirect** (`/\evil.com` normalizes to `//evil.com`) — even sonnet's auth code wants a security-reviewer pass. Grader (opus, $0.79) earned its cost by finding it.
16. Process note: my first tamper test was a no-op (sed replaced the last hex char with the same char) and produced a FALSE failure for haiku. Refuted before recording. Verification scripts need their own sanity checks.
17. Haiku's iteration churn rises with task complexity: 33 tool uses / 1.67M cache-read on f5 vs 10-14 on f1-f3. Its cost advantage shrinks as tasks harden ($0.30 vs sonnet's $0.68 here; was 2.5× cheaper on f3).

### Routing implications (5 experiments)
- Confirmed tiering for the end deliverable:
  - Well-specified, small, low/medium risk → **haiku-4-5**.
  - Risk surface (auth/payments/migrations/external contracts) → **sonnet-4-6 minimum**, PLUS a security/quality review pass (grader tier: opus for security).
  - Ambiguity/judgment → **opus-4-8**.
  - Fable 5 → never for execution.
- Codex: f6 (cross-cutting refactor, codex's last candidate niche) still pending.

18. **f6: codex-xhigh finally matched sonnet on quality in its niche** (cross-cutting mechanical refactor + tests): both 7/7 tests, build, regression, and both independently fixed the latent f3 init race. Cost ~$0.40 (codex, API-equivalent) vs ~$0.56 (sonnet), but ~8 min vs 2.2 min wall and 1.22M total tokens of churn.
19. **Codex's API-equivalent cost is an accounting fiction on subscription** (marginal $0). Its real routing trade-offs are: ~4× wall time, in-sandbox verification limits (no network → no next build, no npm install), and a habit of small out-of-scope drive-bys (2 of 4 runs).
20. Test-writing tasks double as bug-finders: both f6 arms surfaced a real race the f3 implementation tier shipped and my scripted verification missed.

| 16 | 2026-06-10 | f7 PLANNING: multi-user migration plan | claude opus-4-8 | 24,805 + 382,167 cache-read + 135,247 cache-write | 8,489 | ~$1.37 | plan quality 6.0/8 | 110 s, 15 tools. Caught the POSIX-only ensureDataDir; but header-trust auth model contained an unsound assertion (Next middleware does NOT auto-strip inbound x-user-id), in-place migration without read-back verify, open registration unguarded |
| 17 | 2026-06-10 | f7 PLANNING: multi-user migration plan | claude fable-5 | 36,627 + 214,701 cache-read + 93,548 cache-write | 11,499 | ~$2.33 | plan quality 8.0/8 | 168 s, 6 tools. Caught Next 16.2.9 (brief said 15) + AGENTS.md docs mandate; route-level cookie re-verify over header-trust; verify-before-destroy migration + deploy-window analysis; REGISTRATION_DISABLED kill-switch |
| 18 | 2026-06-10 | f7 blind plan grading | claude opus-4-8 (grader) | 49,411 + 155,895 cache-read + 164,138 cache-write | 1,001 | ~$1.38 | n/a | verified both plans' claims against the real code |

| 19 | 2026-06-10 | f7-U1 session lib (risk: crypto → rubric routed SONNET) | claude sonnet-4-6 | 24 + 238,612 cache-read + 50,418 cache-write | 3,500 | ~$0.31 | 12/12 tests; tsc clean | 61 s. LIVE rubric routing |
| 20 | 2026-06-10 | f7-U2 password lib (risk: crypto → rubric routed SONNET) | claude sonnet-4-6 | 21 + 202,343 cache-read + 27,166 cache-write | 2,794 | ~$0.20 | 16/16 tests; tsc clean | 56 s. LIVE rubric routing |
| 21 | 2026-06-10 | f7-U3 users store (mechanical clone, sandbox-safe verify → rubric routed CODEX medium) | codex gpt-5.5 (medium) | 195,820 (172,416 cached) | 3,385 | ~$0.08 | 6/6 tests; tsc clean | ~5 min wall. No drive-bys this time — correctly refused to touch pre-existing lint failure outside scope |

| 22 | 2026-06-10 | f7-U4 middleware swap (auth risk → SONNET) | claude sonnet-4-6 | 19 + 164,079 cache-read + 49,624 cache-write | 1,803 | ~$0.26 | tsc ✓; 12/12 dep tests | 34 s. LIVE rubric routing |
| 23 | 2026-06-10 | f7-U5 register + login rewrite (auth risk → SONNET) | claude sonnet-4-6 | 26 + 231,233 cache-read + 49,402 cache-write | 2,427 | ~$0.29 | tsc ✓; 41/41 suite | 44 s. Dummy-scrypt timing guard implemented correctly |
| 24 | 2026-06-10 | f7-U6 per-user stores + route auth (data-integrity risk → SONNET) | claude sonnet-4-6 | 36 + 504,155 cache-read + 55,694 cache-write | 5,350 | ~$0.44 | tsc ✓; 51/51 suite incl. untouched store tests | 90 s. UUID-validated paths; singleton exports deleted so TS catches missed consumers |

21. **Live validation of the rubric (f7 wave 1): 3 concurrent units, 3 different routed executors, 41/41 combined tests + build green, zero rework, ~$0.59 total.** Codex's niche confirmed in practice: mechanical pattern-clone with vitest-only verification — and parallel waves absorb its 5× wall-time. Combined with the back-test, the deliverable rubric is now validated both retrospectively and in live operation.
21b. **Wave 2 (units 4–6, all sonnet per rubric, concurrent): 51/51 tests, build green, 12/12 E2E multi-user functional pass, zero rework, ~$0.99, 90 s wall.** Across both waves: 6 units, 6 first-try successes, $1.58 total — the rubric routed every unit to the cheapest tier that produced correct code.

| 25 | 2026-06-10 | f7-U7 auth UI (small, clone-pattern → HAIKU) | claude haiku-4-5 | 56 + 304,545 cache-read + 70,016 cache-write | 4,782 | ~$0.14 | tsc ✓; 51/51 suite | 43 s. LIVE rubric routing |
| 26 | 2026-06-10 | f7-U8 migration script (data-integrity risk → SONNET) | claude sonnet-4-6 | 34 + 465,132 cache-read + 69,551 cache-write | 4,719 | ~$0.47 | tsc ✓; 57/57 suite incl. 6 script tests | 113 s. Inlined scrypt w/ compat enforced by verifyPassword-based test |

21c. **Wave 3 + final acceptance: real migration run succeeded** (legacy user created, 1 todo migrated with copy-verify-then-bak, second run refused exit 1, migrated user logs in and sees the legacy todo, /login and /register render). **f7 complete: 8 units, 8 first-try successes, ~$2.19 execution total, zero rework — the entire feature was built by the rubric's routing.** Second false-positive of the session caught before recording (pipe ate the script's exit code), reinforcing finding 16: verification scripts need their own sanity checks.

22. **Back-test of the drafted rubric (sonnet simulator, $0.04, 6 s): 6/6 sensible routes.** T1/T2→haiku, T4→opus, T5→sonnet, T6→codex-xhigh+sonnet-fallback — all match the measured optimum. T3→sonnet is one tier above what haiku empirically achieved (8/8) — deliberate safe-side escalation on data-integrity risk. The no-network-verification criterion correctly forced T1–T5 to claude and allowed T6 to codex.

### FINAL routing table (6 features, 11 measured dispatches)
| Task profile | Route | Evidence |
|---|---|---|
| Well-specified, small diff, low/medium risk | **haiku-4-5** | f1-f3: 4-for-4, always cheapest+fastest |
| Well-specified, risk surface (auth/payments/data) | **sonnet-4-6** + security review (opus grader) | f5: func tied 7/7, security 6.5 vs 4.0 |
| Well-specified, cross-cutting/multi-file | **sonnet-4-6** (codex-xhigh viable when wall-time is free, e.g. parallel waves on subscription) | f6: quality tie; sonnet 4× faster |
| Ambiguity "some"/"high", design judgment, UX | **opus-4-8** | f4: blind 7.5 vs 4.5 |
| Extremely important planning / hardest intellectual work | **fable-5** (never execution) | f7 measured: blind plan grade 8.0 vs opus 6.0 at 1.7× cost; fable caught a real soundness gap in the opus plan (header-trust w/o strip) plus two grounding discrepancies (Next 16.2.9, AGENTS.md mandate). Premium justified where plan errors cascade into execution. Routine/small-feature planning: opus remains adequate |
| Codex effort mapping when used | medium for small mechanical; xhigh only for cross-cutting (high never showed value over medium) | f1/f2 vs f3 vs f6 |
