# P4.01 · `ContextGraph` model + `buildContextGraph` (semantic edges)

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Build the first-class `ContextGraph` with **semantic edges** and **edge metadata**, extending
the current implementation graph builder.

## Sequence

- **Previous:** [P3.09 — Rule tests & cutover](../P3-rules/09-rule-tests-and-cutover.md)
  completed the rule engine; the current implementation graph build is already in `core`.
- **Next:** [P4.02 — Graph algorithms](02-graph-algorithms.md).
- **Depends on:** P3 done + `ParsedDocument` references/anchors/imports (P1) · **Blocks:** all of P4.

## Inputs (from previous work)

- current `graph/build.ts` (in core), `ParsedDocument.{links,images,imports}` + heading slugs (P1).

## Deliverables / steps

1. `GraphNode { filePath, inDegree, outDegree }`;
   `GraphEdge { source, target, type: "link"|"image"|"anchor"|"id-ref"|"import", line, text?, rawTarget? }`
   ([G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md)).
2. `buildContextGraph(documents, { exclude?, entryPoints?, siteRouter?, idRef? })`
   ([R5](../requirements/02-rules-engine.md)): resolve relative links/images; materialize
   **anchor** edges (heading-slug match), **import** edges (`@path.md`), and **id-ref** edges.
   **id-ref discovery is column-based (decided 2026-07-02, audit 5.5):** defined IDs come from
   the declared `definitions`/`idColumn` columns (+ headings), the **same model as REF-005** —
   `idPattern` validates the token *within* those cells, it does not scan arbitrary cells. The
   graph therefore receives `idRef: { idPattern, definitions, idColumn }` (from REF-005-style
   config); with no such config, no id-ref edges are built. Resolve defined IDs via the shared
   `extractDefinedIds(doc, idRef)` helper over the parsed `tables`/`headings` (audit 2.1) — no
   re-parse; `ParsedDocument` has no `ids` field.
3. **One edge per source construct**, typed per the taxonomy in
   [requirements/03](../requirements/03-context-graph.md) (audit 2.5): a `#fragment` makes it
   `anchor`, otherwise `link`; `image`/`import`/`id-ref` by their own construct. Skip
   self-refs (incl. same-file `#frag` anchors) and missing targets; keep deterministic sorting
   of nodes/edges.
4. (Edge de-dup with `count` is [G7 backlog](../requirements/03-context-graph.md) — keep
   reference multiplicity for now.)

## Decisions applied

- [G1](../requirements/03-context-graph.md), [G3](../requirements/03-context-graph.md),
  [R5](../requirements/02-rules-engine.md) routing/exclude inputs.

## Exit criteria

- [ ] Edges carry type + line (+ text); anchor/import/id-ref edges materialized.
- [ ] `buildContextGraph` accepts exclude/entryPoints/siteRouter.
- [ ] Deterministic node/edge ordering.

## Hand-off to next

P4.02 runs algorithms over this graph; P4.06 lets GRP rules consume it instead of building
their own.
