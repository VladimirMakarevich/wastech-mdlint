# P10.05 · Deepen parser & per-rule tests

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** ·
> Status **Done**. Audit findings **L-13**, **L-14** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Fill the parser (P1.06) and per-rule test gaps so behaviors that work today are guarded against
regression, matching the coverage the phase plans called for.

## Problem (from the audit)

**Parser (L-13, vs P1.06 deliverables):**

- Reference-style **image** definitions are handled (`parse-document.ts:305-314`) but untested —
  only reference-style _links_ are tested (`parse-document.test.ts:119`).
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

- [x] Reference-style images, CJK content/anchor, and value-level loader determinism are tested.
- [x] Each named rule has at least one edge-case test beyond the smoke pass/fail pair.
- [x] `npm test` green.

## Implementation notes

Test-only change; no parser or rule behavior was modified.

- `packages/core/test/parse-document.test.ts` — added a reference-style image test (closes the
  "images … untested" half of L-13) and a new `describe("parseDocument · CJK content and
anchors", ...)` block with a CJK table/checklist content-scanning case and a CJK
  percent-encoded-anchor decode case.
- `packages/core/test/load-documents.test.ts` — added an additive test asserting
  `JSON.stringify` equality of full `ParsedDocument` values across two loads, alongside (not
  replacing) the existing key-order determinism test.
- `packages/core/test/rules-sec.test.ts` — added SEC-002 `level` filtering and `section`-scoped
  inversion cases.
- `packages/core/test/rules-ref.test.ts` — added REF-004 `dependencySection` override, REF-005
  heading-as-definition widening (audit 5.5), and REF-006 multi-id cell tokenization cases.
- `packages/core/test/rules-ctx.test.ts` — added a CTX-003 `section`-scoped alias-scanning case.
- `packages/core/test/rules-grp.test.ts` — added a GRP-003 3-stage chain case exercising the
  `idColumn`-omitted stage-skip branch.
- `packages/core/test/rules-size.test.ts` (new) and `packages/core/test/rules-str.test.ts` (new)
  — dedicated option-branch coverage for SIZE-001 (lines/tokens metrics, pass case, override
  precedence and per-metric fallback) and STR-001 (glob-satisfied pass case, independent
  multi-miss reporting), left `rules-proof.test.ts`'s and `rules-sec.test.ts`'s existing
  end-to-end smoke tests for these rules untouched.

Verified with `npm run typecheck`, `npm test` (614 tests passing), and `npm run build`.
