# P4.01 · `ContextGraph` model + `buildContextGraph` (semantic edges)

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Build the first-class `ContextGraph` with **semantic edges** and **edge metadata**, extending
the MVP graph builder.

## Sequence

- **Previous:** [P3.09 — Rule tests & cutover](../P3-rules/09-rule-tests-and-cutover.md)
  completed the rule engine; the MVP graph build is already in `core`.
- **Next:** [P4.02 — Graph algorithms](02-graph-algorithms.md).
- **Depends on:** P3 done + `ParsedDocument` references/anchors/imports (P1) · **Blocks:** all of P4.

## Inputs (from previous work)

- MVP `graph/build.ts` (in core), `ParsedDocument.{links,images,imports}` + heading slugs (P1).

## Deliverables / steps

1. `GraphNode { filePath, inDegree, outDegree }`;
   `GraphEdge { source, target, type: "link"|"image"|"anchor"|"id-ref"|"import", line, text?, rawTarget? }`
   ([G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md)).
2. `buildContextGraph(documents, { exclude?, entryPoints?, siteRouter? })`
   ([R5](../requirements/02-rules-engine.md)): resolve relative links/images; materialize
   **anchor** edges (heading-slug match), **import** edges (`@path.md`), and **id-ref** edges
   (table-cell/heading IDs referenced elsewhere, using config `idPattern`).
3. Skip self-refs/missing targets; keep deterministic sorting of nodes/edges.
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
