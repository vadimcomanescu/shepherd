---
title: Verification scripts produce false verdicts — sanity-check the check itself
date: 2026-06-10
category: best-practices
module: agent-verification
problem_type: best_practice
component: testing_framework
applies_when:
  - "Writing shell-based verification for agent-produced code"
  - "Scoring correctness in measurement or A/B harnesses"
severity: high
tags: [verification, false-positive, shell, exit-codes, adversarial-testing]
---

# Verification scripts produce false verdicts — sanity-check the check itself

## Context

Two verification bugs in one measurement session, both mine, both nearly
recorded as findings about the code under test:

1. **No-op mutation:** a cookie-tamper test used `sed 's/.$/0/'` to corrupt an
   HMAC — but the signature already ended in `0`, so the "tampered" cookie was
   identical and the server's 200 looked like broken verification. The code
   was correct; the test mutated nothing.
2. **Pipe ate the exit code:** `node migrate.mjs | tail -1; echo exit=$?`
   reported `exit=0` for a script that correctly aborted with exit 1 — `$?`
   was `tail`'s status. The refusal worked; the harness said it didn't.

## Guidance

- Make mutations provably different: derive the tampered value by checking the
  original (`case "$ck" in *f) t="${ck%?}0";; *) t="${ck%?}f";; esac`), or
  assert `[ "$t" != "$ck" ]` before using it.
- Never read `$?` after a pipeline stage you didn't mean to measure; run the
  command unpiped (redirect to a file) or use `pipefail`/`PIPESTATUS`.
- Before recording a surprising FAIL against generated code, attempt to refute
  your own test first — re-run with the inputs printed, confirm the mutation
  is real, confirm the exit code belongs to the right process.

## Why This Matters

In a measurement harness, a false FAIL silently corrupts the dataset that
routing/cost decisions are built on; in CI it burns a rework loop on correct
code. Both bugs here were caught only because the verdicts looked anomalous
against other evidence.

## When to Apply

Every scripted check whose verdict will be recorded, especially negative-path
security tests (tamper/expiry/refusal) where "rejected" is the pass condition.

## Examples

Dogfood ledger findings 16 and 21c (`dogfood/LEDGER.md`, PR #22).
