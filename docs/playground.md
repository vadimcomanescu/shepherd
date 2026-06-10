# The validation playground (`nadia-playground`)

A tiny invoice-math Node app used by the `validating-agent-improvements`
skill for A/B behavioral simulations. It lives as a **local sibling checkout
named `nadia-playground`** next to this repo's checkout. It is persistent
infrastructure: never delete it; document every new scenario and its measured
result in its README. This file is the canonical spec so the playground can
be recreated if the checkout is missing.

## Layout

- `package.json` — `"type": "module"`, `"test": "node --test"`
- `lib/money.js` — `round2(x)` (`Math.round(x * 100) / 100`),
  `totalWithTax(subtotal, rate)`, `splitEvenly(total, n)` (integer-cents
  remainder distribution)
- `lib/config.js` — `getApiUrl()`: `API_URL` env var, else parse an untracked
  `.env` file, else throw
- `lib/format.js` — `formatCents(cents)`, `padLabel(label, width)`
- `lib/receipt.js` — `renderReceipt(items, taxRate)`
- `bin/report.js` — untested CLI importing `formatCents` (deliberate: a
  consumer the test suite cannot protect)
- `test/` — `node --test` suite covering everything except `bin/`
- `.gitignore` — `node_modules/`, `.env`, `wt-*/`
- Sim worktrees `wt-<scenario>-<arm><n>/` are disposable; scenario branches
  and `main` are not. Untracked `.env` must be copied into each worktree.

## Scenarios (design + measured results live in the playground README)

- `scenario-a` (branch): `round2` uses `Math.floor` — a reproducible test
  failure whose root cause is in a shared helper, symptom in a caller.
- `scenario-b` (state: `main` + untracked `.env`): tests pass locally, "CI"
  fails for lack of the env var — environment-delta / phantom-fix trap.
- `scenario-c` (branch): a refactor orphans two helpers; one truly dead, one
  still imported by the untested `bin/report.js` — dead-code deletion trap.
- `scenario-d` (branch): `round2` floor bug + a `fix(ci):` commit that
  inline-patched `totalWithTax` (symptom patch) + `applyDiscount` still using
  the broken helper — prior-fix anchoring trap for sequential CI rounds.
- `scenario-e` (state: plain `main`): a TRUE runtime finding that looks false
  from reading — `round2(1.005)` returns 1, not 1.01 (IEEE754:
  `1.005 * 100 === 100.49999999999999`) — execution-vs-reading trap.
  (Design note: 0.615 is NOT a trap value; `0.615 * 100` is exactly 61.5.)
