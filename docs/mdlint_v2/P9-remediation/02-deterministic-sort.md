# P9.02 · Replace `localeCompare` with a deterministic sort

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **M-4** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Guarantee that document load order is identical across locales, ICU versions, and operating
systems — the user-visible determinism contract of the loader (P1.05).

## Problem (from the audit)

`loadDocuments` sorts results with `left.localeCompare(right)`
(`packages/core/src/markdown/load-documents.ts:171`). `String.prototype.localeCompare` with no
locale/options is implementation- and ICU-locale-defined; ordering of mixed-case, punctuation,
and the CJK/Unicode paths the project explicitly supports can differ between environments. The
existing determinism test (`load-documents.test.ts:97-108`) only re-runs on one machine, so it
cannot catch cross-environment drift.

## Deliverables / steps

1. Replace the `localeCompare` sort with a deterministic comparison — code-point order
   (`a < b ? -1 : a > b ? 1 : 0`) is the simplest; a pinned-locale collator is acceptable if a
   specific ordering is desired, but it must be explicit.
2. Audit sibling sorts for the same pattern (e.g. `projectFiles` in `lint-files.ts:78` also uses
   `localeCompare`) and align them to the same deterministic rule so ordering is consistent
   everywhere user-visible order is part of the contract.
3. Add an assertion covering non-ASCII / mixed-case ordering so the intended order is pinned by a
   test rather than by the host locale.

## Exit criteria

- [x] No `localeCompare` on any determinism-critical output path (loader keys, `projectFiles`).
- [x] A test pins the ordering of a fixture containing non-ASCII + mixed-case names.
- [x] `npm test` green.

## Implementation notes

- **Code-point comparison, not a pinned-locale collator.** The two acceptable options were a
  plain relational comparator and an explicit `Intl.Collator` with a fixed locale. We took the
  relational one: it needs no ICU data, no new dependency (a stated constraint), and its result
  is fixed by the ECMAScript spec rather than by whatever ICU version a host ships. The cost is
  that ordering is not human-locale-aware (ASCII uppercase before lowercase, non-ASCII by code
  point) — an acceptable trade for output that must be byte-stable and diffable everywhere.
- **One shared comparator, applied everywhere ordering is user-visible.** The audit named the
  loader and `projectFiles`, but the same `localeCompare` pattern had spread across the graph,
  compile, discovery/init, registry, skills, and rule paths. Rather than fix the two named
  spots, the change routes every such sort through a single `compareStrings`
  (`packages/core/src/deterministic-sort.ts`), so "user-visible order is code-point order" is
  enforced in one place instead of re-derived per call site. It is exported from `core` so hosts
  and tests assert against the exact production comparator rather than re-implementing it.
- **Scope held to comparators.** Only sort comparators changed; the set of documents discovered
  and their contents are untouched, per the task constraint.
