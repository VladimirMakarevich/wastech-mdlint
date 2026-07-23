# P10.05 · Deepen parser & per-rule tests

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** ·
> Status **Not started**. Audit findings **L-13**, **L-14** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Fill the parser (P1.06) and per-rule test gaps so behaviors that work today are guarded against
regression, matching the coverage the phase plans called for.

## Problem (from the audit)

**Parser (L-13, vs P1.06 deliverables):**
- Reference-style **image** definitions are handled (`parse-document.ts:305-314`) but untested —
  only reference-style *links* are tested (`parse-document.test.ts:119`).
- CJK is only partly covered: headings/slugs tested (`:30`) and non-ASCII anchor decoding via
  Cyrillic (`:129`), but no CJK-content-scanning or CJK-anchor-in-link case.
- The loader determinism test compares only key **ordering** (`load-documents.test.ts:97`), not
  byte-identical `ParsedDocument` values across loads.

**Per-rule depth (L-14):** SEC-002 has a single order case (no `level`/section-scoped inversion);
REF-004/005/006, CTX-003, GRP-003 each have ~1 scenario; there is no dedicated `rules-size` /
`rules-str` test file. Option branches like `section`, `level`, `caseSensitive` are unevenly
exercised.

## Deliverables / steps

1. Parser: add tests for reference-style images, a CJK-content/anchor-in-link case, and a
   byte-identical `ParsedDocument`-value determinism assertion across two loads.
2. Rules: add edge cases for SEC-002 (`level`, section-scoped inversion), REF-004/005/006,
   CTX-003, GRP-003; add focused `rules-size`/`rules-str` coverage.
3. Prefer small, scenario-specific fixtures (one behavior per failure), per the testing rules.

## Exit criteria

- [ ] Reference-style images, CJK content/anchor, and value-level loader determinism are tested.
- [ ] Each named rule has at least one edge-case test beyond the smoke pass/fail pair.
- [ ] `npm test` green.
