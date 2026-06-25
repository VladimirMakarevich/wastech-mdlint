# P1.03 · References — links, images, anchors, eager `@imports`

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Extract everything reference-like into `ParsedDocument`: Markdown links (with label text and
anchor), images, and eager `@path.md` imports — all with positions and classification. This
is the raw material for the semantic graph.

## Sequence

- **Previous:** [P1.02 — Block structure](02-block-structure.md) established the single-pass
  traversal with section tracking and produced heading slugs (needed for anchor matching).
- **Next:** [P1.04 — Inline-disable directives](04-inline-disable-directives.md) adds the last
  extraction (HTML-comment directives) to the same document.
- **Depends on:** P1.02 (heading slugs, traversal) · **Blocks:** P1.04, P1.06, and the graph
  in [P4](../index.md).

## Inputs (from previous work)

- MVP link/image classification and anchor decoding from `markdown/parse.ts`.
- MVP eager-import regex from `llm/imports.ts`
  (`@path/to/file.md`, `@/root/path.md`).
- Heading slugs from P1.02 (for resolving `file.md#anchor`).

## Deliverables / steps

1. **Links** → `{ rawTarget, text, anchor?, kind, line, column? }`:
   - keep the link **label text** for explainability ([G3](../requirements/03-context-graph.md));
   - split `#anchor`; classify `kind` (local-file / same-file-anchor / external / mailto / other)
     as the MVP does.
2. **Images** → `{ rawTarget, line }` (relative images; for REF-006).
3. **Eager imports** → `{ rawTarget, line, column? }` from the `@path.md` syntax
   ([D3](../index.md)); these become `import` graph edges in P4.
4. Reuse MVP reference-style definition handling and non-ASCII anchor decoding.
5. Keep the extraction in the same single traversal as P1.02.

> **Out of scope here:** resolving anchors against headings, building id-ref edges, and the
> deterministic search index — those are graph/rule concerns in [P4](../index.md). P1 only
> exposes the raw parsed references + heading slugs.

## Decisions applied

- [G1](../requirements/03-context-graph.md) anchor/import edge inputs ·
  [G3](../requirements/03-context-graph.md) link label text · [D3](../index.md) eager imports.

## Exit criteria

- [ ] Links carry label text, anchor, kind, and position.
- [ ] Images and eager imports extracted with positions.
- [ ] Reference-style definitions and non-ASCII anchors handled (MVP parity or better).

## Hand-off to next

P1.04 completes parsing by capturing inline-disable directives; after that the document is
fully populated for the loader (P1.05) and the graph (P4).
