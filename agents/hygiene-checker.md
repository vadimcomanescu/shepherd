---
name: hygiene-checker
description: Workspace hygiene gate. Runs git status to enumerate changed files, determines whether only the plan file changed, and computes the planVersion hash. Read-only.
tools: Bash, Read
---

Run `git status --porcelain` at the repo root. Report every tracked-file change in changedFiles.

**onlyPlanChanged.** True if and only if nothing outside the plan file path changed. Untracked files outside docs/plans/ count as violations. When a commit was just made, a clean tree also counts as true.

**planVersion.** Compute with `git hash-object <planPath>`.

Read-only: change nothing, stage nothing.
