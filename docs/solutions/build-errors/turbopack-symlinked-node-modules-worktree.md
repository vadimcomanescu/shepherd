---
title: Turbopack build fails on symlinked node_modules in a git worktree
date: 2026-06-10
category: build-errors
module: scratch-app-harness
problem_type: build_error
component: tooling
symptoms:
  - "FATAL: An unexpected Turbopack error occurred"
  - "TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root"
root_cause: config_error
resolution_type: environment_setup
severity: medium
tags: [turbopack, next-js, git-worktree, symlink, node-modules]
---

# Turbopack build fails on symlinked node_modules in a git worktree

## Problem

To run two agents on the same repo concurrently, a git worktree was created
and `node_modules` symlinked from the main checkout
(`ln -s <main>/node_modules <worktree>/node_modules`). `npx tsc` and `vitest`
worked fine, but `npm run build` (Next.js 16 / Turbopack) panicked.

## Symptoms

- `Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid, it points out of the filesystem root`
- A panic log written to `$TMPDIR/next-panic-*.log`

## What Didn't Work

- Symlinking the whole `node_modules` directory — Turbopack resolves the
  symlink to a path outside what it considers the project filesystem root and
  refuses.

## Solution

Don't build in the symlinked worktree. Either:

1. Run only sandbox-safe verification in the worktree (`tsc --noEmit`, `lint`,
   `vitest run`) and do the real `npm run build` in the main checkout after
   merging/checking out the branch there; or
2. Give the worktree its own real `node_modules` (`npm ci` in the worktree).

Option 1 was used: the worktree agent verified with tsc+lint+vitest, then the
branch was checked out in the main tree (real node_modules) and built there.

## Why This Works

Turbopack walks the project filesystem and treats a symlink that escapes the
project root as invalid by design; tools that resolve modules per-file (tsc,
vitest) follow the symlink without caring about a project root.

## Prevention

When parallelizing agents with worktrees on a Next.js/Turbopack repo, plan the
build step to run where `node_modules` is real. Webpack-based builds don't hit
this; Turbopack does.
