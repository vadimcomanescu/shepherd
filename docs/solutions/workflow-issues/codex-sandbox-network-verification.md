---
title: Codex sandbox has no network — dossiers must demand sandbox-safe verification
date: 2026-06-10
category: workflow-issues
module: codex-integration
problem_type: workflow_issue
component: development_workflow
applies_when:
  - "Routing implementation tasks to codex exec"
  - "Writing task dossiers whose verification step is npm run build or npm install"
symptoms:
  - "codex reports 'build did not pass' on correct code"
  - "next/font/google fetch failures inside the codex sandbox"
severity: high
tags: [codex, sandbox, verification, next-js, routing]
---

# Codex sandbox has no network — dossiers must demand sandbox-safe verification

## Context

A stock create-next-app uses `next/font/google`; `npm run build` fetches the
fonts at build time. Codex's `workspace-write` sandbox has no network, so the
build fails on any such project even when the generated code is correct.
`npm install` fails the same way. The executor-router's "self-contained
verification" criterion silently breaks for this whole task class.

## Guidance

When a task is routed to codex, the dossier must specify verification that
works offline:

```
Verify with: npx tsc --noEmit && npm run lint   (and npx vitest run <file> if tests exist)
Do NOT run npm run build (needs network this sandbox lacks) and do NOT run npm install.
```

The orchestrator (or a follow-up step) runs the real `npm run build`
outside the sandbox. If a task NEEDS network-dependent verification or a
dependency install, route it to a Claude executor instead — this is now an
explicit CODEX criterion in `agents/executor-router.md`.

## Why This Matters

Without this, codex either reports honest-but-misleading failures (correct
code, failed verification) or burns its loop retrying an impossible build.
Measured: with tsc+lint instructions, codex verified cleanly in-sandbox and
external builds confirmed every time (4/4 runs).

## When to Apply

Every codex dispatch in a Next.js (or any network-at-build-time) project;
any dossier whose verification implies package installation.

## Examples

Dogfood ledger findings 3 and 6 (`dogfood/LEDGER.md`, PR #22).
