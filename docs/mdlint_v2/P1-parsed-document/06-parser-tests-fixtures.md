# P1.06 · Parser tests & fixtures

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Lock the parser behavior with focused fixtures and unit tests so P2+ build on a trusted
`ParsedDocument`.

## Sequence

- **Previous:** [P1.05 — loadDocuments()](05-load-documents.md) finished the loader; all
  parser fields are now produced.
- **Next:** **Phase P2 — Rule engine & new config model** (see [roadmap](../index.md)).
- **Depends on:** P1.01–P1.05 · **Blocks:** confident start of P2.

## Inputs (from previous work)

- The full parser + loader from P1.02–P1.05.
- current fixture pattern under `test/fixtures/*` (carried into `core`).

## Deliverables / steps

1. Fixtures (focused, not the real repo docs — per [AGENTS.md](../../../AGENTS.md) testing
   guidance) covering: tables with keyed cells + sections, checklist items, required/ordered
   sections, links with labels + anchors, images, eager `@imports`, inline-disable comments,
   and reference-style definitions.
2. **CJK fixture** to confirm non-ASCII headings/slugs/anchors and content scanning.
3. **Determinism test:** parsing the same input twice yields byte-identical `ParsedDocument`;
   `loadDocuments` yields stable map ordering.
4. Unit tests per extractor (headings/slugs, tables, checklist, links/anchors, imports,
   directives) and a loader integration test.

## Decisions applied

- Focused-fixture testing (AGENTS.md) · determinism · covers the [R9](../requirements/02-rules-engine.md)
  primitive sources and [G1](../requirements/03-context-graph.md) edge inputs.

## Exit criteria

- [ ] Each extractor has unit coverage; loader has an integration test.
- [ ] CJK fixture passes (slugs/anchors/content).
- [ ] Determinism test green.
- [ ] Phase P1 [exit criteria](index.md) fully satisfied.

## Hand-off to next

Phase P2 starts with a frozen, well-tested `ParsedDocument` and `loadDocuments()`: the rule
engine maps its primitive vocabulary directly onto these fields and consumes `directives` for
inline suppression.
