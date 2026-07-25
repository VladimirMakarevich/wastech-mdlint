# P12.01 · End-to-end `exclude` coverage across the rule families

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** ·
> Status **Not started**. Audit finding **L-4** (root cause of M-2,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)). Depends on
> [P11.05](../P11-remediation/05-table-primitive-scope.md),
> [P11.08](../P11-remediation/08-init-exclude-anchoring.md).

## Goal

The shared `exclude` option must have end-to-end coverage on every rule family that accepts it. Its
**zero** e2e coverage is exactly why M-2 (`columnUnique` ignoring `exclude`) shipped — this task is
the cheapest prevention of that whole class.

## Problem (from the audit)

`grep -c exclude` across `rules-tbl`, `rules-sec`, `rules-ctx`, `rules-ref`, `rules-grp`, `rules-str`,
`rules-custom`, and `primitives.test.ts` returns **0 in all eight**. The only unit test of the helper
(`rule-utils.test.ts:12-19`) checks `exclude` **together with** `files` — the working combination —
so the broken `exclude`-only path was never exercised. `exclude` is part of the shared file-scope
shape used across the rule families, so a gap in one path (M-2) implies untested siblings.

## Deliverables / steps

1. Add a focused fixture + test per rule family that honors the shared file-scope shape, asserting
   that a matching `exclude` (with **and** without `files`) removes the excluded document from that
   rule's findings. Cover at least: `TBL-006`/`columnUnique`, the `SEC`/`STR` project rules, the
   `REF` project rules, `GRP-002`, `CTX-003`, and a declarative `custom` rule using each affected
   primitive.
2. Include the `exclude`-only case explicitly (no `files`) — that is the M-2 shape and must now pass
   given [P11.05](../P11-remediation/05-table-primitive-scope.md).
3. Keep fixtures small and per-behavior (repo testing rules) so a failure points at one rule's scope
   handling, not a repo snapshot.

## Out of scope

Fixing scope bugs themselves — those are P11 tasks; this task assumes they landed and locks the
behavior in. New `exclude` semantics beyond what the shared shape already defines.

## Exit criteria

- [ ] Every rule family that accepts the file-scope shape has an `exclude` e2e test, including the
      `exclude`-only (no `files`) case.
- [ ] The tests fail against the pre-P11.05 behavior and pass against the fix.
- [ ] `npm run typecheck && npm test` green.
