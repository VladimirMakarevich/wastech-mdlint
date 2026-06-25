# P5.02 · `extractDocProfile`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Build a per-document profile: outline, table schemas (with detected ID patterns), and
reference relationships from the graph.

## Sequence

- **Previous:** [P5.01 — Graph analysis](01-graph-analysis.md) (roles + analysis).
- **Next:** [P5.04 — Synthesize](04-synthesize.md).
- **Depends on:** P5.01 + `ParsedDocument` (P1) + graph edges (P4) · **Blocks:** P5.04.

## Deliverables / steps

1. `extractDocProfile(doc, graph)` → `{ role, outline, tableSchemas, idPattern?,
   referencesTo, referencedBy }`.
2. `outline` from headings; `tableSchemas` from table headers; `idPattern` detected from
   column values (e.g. `REQ-001` → `REQ-NNN`).
3. `referencesTo`/`referencedBy` from the semantic graph edges
   ([G1](../requirements/03-context-graph.md)) — so id-ref/anchor/import relationships show up,
   not just Markdown links.

## Decisions applied

- Richer profiling from semantic edges ([G1](../requirements/03-context-graph.md)).

## Exit criteria

- [ ] Profiles include outline, table schemas, detected ID pattern, and refs in/out.
- [ ] ID-pattern detection handles common `PREFIX-NNN` forms.

## Hand-off to next

P5.04 renders the "Document Architecture" / "Document Types" sections from these profiles.
