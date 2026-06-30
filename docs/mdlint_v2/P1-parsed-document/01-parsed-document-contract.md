# P1.01 · Define the `ParsedDocument` contract (types)

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Not started** · Design/types task.

## Goal

Define the full `ParsedDocument` TypeScript contract in `@wastech-ctxlint/core` — the single
shape every later consumer reads. No extraction logic yet; this fixes the interface so
P1.02–P1.05 just fill it.

## Sequence

- **Previous:** [P0.08 — Phase exit verification](../P0-foundations/08-exit-verification.md)
  delivered a clean monorepo with the current implementation parser/types relocated into `core`.
- **Next:** [P1.02 — Block structure](02-block-structure.md) implements the headings/sections/
  tables/checklist part of this contract.
- **Depends on:** P0 complete · **Blocks:** all of P1.02–P1.06.

## Inputs (from previous work)

- current `types.ts` (`MarkdownFile`, `MarkdownLink`, `AnchorIndex`, …) now in `core`.
- The four consumer requirements this contract must satisfy:
  [R8](../requirements/02-rules-engine.md), [R9](../requirements/02-rules-engine.md),
  [G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md),
  [D3](../index.md).

## Deliverables / steps

Define (and export) `ParsedDocument` with — at minimum — these fields, each carrying line
positions where applicable:

- `headings: { text, depth, slug, line }[]` — GitHub-style `slug` for anchor resolution.
- `sections: string[]` — heading texts for fast section checks.
- `tables: { headers, rows: { line, cells: Record<header,string> }[], section?, line }[]`.
- `checkItems: { text, checked, section?, line }[]`.
- `links: { rawTarget, text?, anchor?, kind, line, column? }[]` — keep label `text` (G3).
- `images: { rawTarget, line }[]`.
- `imports: { rawTarget, line, column? }[]` — eager `@path.md` (D3/G1).
- `directives: { kind: "disable" | "disable-next-line", ruleIds: string[], line }[]` — R8.
- `content: string`.

Document which field feeds which consumer (rule primitive / graph edge / directive / import).

## Decisions applied

- [R9](../requirements/02-rules-engine.md) primitives · [G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md)
  edges · [R8](../requirements/02-rules-engine.md) directives · [D3](../index.md) imports.

## Exit criteria

- [ ] `ParsedDocument` type exported from core and compiles.
- [ ] Every consumer field above is present with positions.
- [ ] A short field→consumer mapping is documented (in code comments or this file).

## Hand-off to next

P1.02 implements the structural extractors against a frozen contract — no field will move
under it.
