# P5.02 · `extractDocProfile`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Build a per-document profile: outline, table schemas (with detected ID patterns), and
reference relationships from the graph.

## Sequence

- **Previous:** [P5.01 — Graph analysis](01-graph-analysis.md) (roles + analysis).
- **Next:** [P5.04 — Synthesize](04-synthesize.md).
- **Depends on:** P5.01 + `ParsedDocument` (P1) + graph edges (P4) · **Blocks:** P5.04.

## Deliverables / steps

1. `extractDocProfile(doc, graph, options?)` → `{ role, outline, tableSchemas, idPattern?,
   referencesTo, referencedBy }`.
2. `outline` from headings; `tableSchemas` from table headers; `idPattern` detected from
   column values (e.g. `REQ-001` → `REQ-NNN`).
3. `referencesTo`/`referencedBy` from the semantic graph edges
   ([G1](../requirements/03-context-graph.md)) — so id-ref/anchor/import relationships show up,
   not just Markdown links.

## Decisions applied

- Richer profiling from semantic edges ([G1](../requirements/03-context-graph.md)).

## Implementation notes

- `extractDocProfile` accepts the same optional analysis options as [P5.01](01-graph-analysis.md)
  so `role` stays aligned with the configured `compile.hubMinInDegree` threshold once P5.05
  threads compile config into the pipeline.
- `referencesTo` / `referencedBy` stay as the raw semantic graph edges rather than a grouped
  path-only summary. P5.04 can collapse them for prose later, but keeping the original edge shape
  here preserves `type`, `line`, `text`, `rawTarget`, and repeated references so compile does not
  discard graph signal before the synthesizer decides what to surface.
- `outline` and `tableSchemas` are flat source-order projections, not a nested outline tree or a
  second parsed-table model. The compile layer only needs a stable structural summary, and
  re-shaping parser output here would create a second contract to keep in sync for little gain.
- `idPattern` is intentionally conservative: it is inferred from table-cell tokens only, and a
  document gets a value only when every detected family normalizes to the same `PREFIX-NNN` shape.
  Mixed prefixes or digit widths return `undefined` on purpose, because the profile contract has a
  single document-wide slot and a guessed "winner" would be less honest than no pattern at all.

## Exit criteria

- [x] Profiles include outline, table schemas, detected ID pattern, and refs in/out.
- [x] ID-pattern detection handles common `PREFIX-NNN` forms.

## Hand-off to next

P5.04 renders the "Document Architecture" / "Document Types" sections from these profiles.
