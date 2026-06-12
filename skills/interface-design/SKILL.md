---
name: interface-design
description: Doctrine for designing and reviewing module boundaries, public interfaces, and seam placement. Use when you are designing or reviewing a module boundary, public interface, or seam placement.
---

Read this before authoring or reviewing any module boundary, public interface,
or seam placement. Treat interface design as load-bearing architecture: the
shape you expose determines what callers must know, what future changes cost,
and where the system can absorb pressure.

Do not optimize for surface neatness alone. Optimize for a boundary that hides
the right knowledge, carries real behavior, and can be defended against the
domain model already recorded in this repo.

## Deep modules (Ousterhout)

- Prefer a deep module: a small interface that unlocks much behavior behind it.
- Judge depth by caller burden, not by implementation size. A one-method API
  that leaks ordering, storage, retries, or lifecycle rules is shallow.
- Push complexity inward when the module can own it coherently. Do not make
  every caller rediscover the same policy.
- Keep the interface narrow only when the hidden implementation remains capable;
  a tiny facade over scattered obligations is just indirection.

## Design-it-twice (Ousterhout)

- Produce two opposed sketches before committing to a boundary. Make them
  different in where knowledge lives, not just different in names.
- Compare the sketches on caller knowledge, change cost, error surface,
  testability, and deletion pressure.
- Keep the sketch that makes the common path boring and the exceptional path
  explicit. Reject the one that needs folklore to use safely.
- If neither sketch is convincing, design a third. The point of design-it-twice
  is to make tradeoffs visible before the first interface hardens.

## Interface completeness (Ousterhout, Mattpocock)

- Treat the interface as everything a caller must know: signatures, invariants,
  ordering, ownership, error cases, performance expectations, and allowed
  states.
- Use type-level design, in Mattpocock's sense, to make invalid states and
  illegal calls unrepresentable where the language gives you that leverage.
- Define errors out of existence before documenting them. If every caller must
  remember the same precondition, move the precondition behind the boundary.
- Practice information hiding deliberately. Hide decisions that may change;
  expose only concepts the caller already owns or the domain requires.

## Seam placement (adapter reality)

- Name seams only where substitution is real. One adapter is a hypothetical
  seam; two adapters prove a real seam.
- Make seams slightly general-purpose: enough to cover the real adjacent use
  cases, not enough to become a platform.
- Apply the deletion test explicitly. If deleting the seam would only remove
  ceremony and leave the behavior clearer, delete it or fold it inward.
- Place seams where policies meet mechanisms, not where a class or file happens
  to become long.

## Domain-driven boundaries (DDD)

- Put seams at domain boundaries. Do not split a concept because a technical
  layer is convenient if the ubiquitous language says the concept is whole.
- Draw ubiquitous language from `CONTEXT.md`. Use the names the domain already
  uses before inventing abstractions.
- Treat ADRs in `docs/adr/` as settled decisions. Do not relitigate recorded
  tradeoffs while designing an interface; work inside them or write a new ADR.
- Prefer boundaries that let domain rules speak plainly. Infrastructure,
  persistence, and framework concerns should support the language, not rename
  it.

## Review posture

- Ask what the caller must know to use this safely. Every hidden assumption is
  part of the interface whether or not it appears in the signature.
- Ask what would change if the implementation were replaced. Stable boundaries
  protect domain meaning, not incidental code shape.
- Ask whether the next adapter, caller, or variant is real. If it is only
  imagined, keep the design smaller until evidence appears.
