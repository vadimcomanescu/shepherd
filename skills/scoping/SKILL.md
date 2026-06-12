---
name: scoping
description: Use whenever you are bounding a plan's scope, deciding what is in or out, or handling mid-work discoveries that tempt scope creep.
---

You are setting the boundary of a piece of work before it becomes execution.
Read this skill before scoping work, the same way CLAUDE.md mandates reading
`docs/workflows/README.md` before workflow work. Treat scope as a contract,
not as a mood.

Scoping doctrine here is sourced from Shape Up (Basecamp): set an appetite,
shape the solution to fit it, and protect quality by choosing what not to do.

## Set the appetite

- State the appetite before listing tasks. Appetite, not estimate, sets the
  budget for the plan.
- Translate appetite into a work boundary: what must be true by the end, what
  can be omitted, and what proof is enough.
- Do not inflate the appetite because the current code looks messy. Messy code
  is risk evidence, not permission to widen the plan.
- If the appetite is too small for the desired outcome, shrink the outcome or
  ask for a new decision. Do not silently overrun it.

## Draw no-go lines

- Name explicit no-go functionality. Use concrete nouns, such as "no billing
  changes", "no workflow executor edits", or "no migration of existing agents".
- Keep no-go lines visible in the plan and in handoff notes so future agents
  do not rediscover them as optional extras.
- Treat a no-go as an exclusion, not a backlog hint. Only convert it into work
  when the user or issue explicitly changes the scope.
- When a no-go blocks the main promise, say so early and force the tradeoff
  into the open.

## Cut scope

- Cut scope, not quality. Preserve tests, verification, error handling, and
  clear interfaces before preserving nice-to-have behavior.
- Prefer a smaller complete slice over a larger partial slice. A narrower
  outcome with working proof beats a broad sketch.
- Remove optional surfaces first: extra formats, polish-only variants,
  secondary commands, alternate integrations, and convenience flows.
- Keep the core promise intact. If cutting changes what the user is actually
  getting, rename the outcome instead of pretending it is equivalent.

## Route discoveries

- Route tangential discoveries to a deferred list. Do not absorb them into the
  current scope because they are nearby or interesting.
- Record why each deferred item is outside the appetite: blocked by no-go,
  unrelated to the proof, too large for the slice, or dependent on another
  decision.
- Preserve each deferred item's R-ID. Requirement identifiers survive deferral
  so traceability does not break when the work moves later.
- If a deferred item exposes a real defect in the current slice, split the
  defect from the enhancement. Fix only what is required for the scoped
  promise.

## Close the scope

- Before execution, restate the appetite, in-scope outcome, no-go list,
  deferred list, and verification gate in one compact note.
- During execution, compare new work against that note. If it does not serve
  the scoped promise, defer it.
- At handoff, report what was delivered and what was deferred by R-ID. Do not
  leave scope changes implicit in a diff or chat transcript.
