# P4.04 · Deterministic search index + `slice`

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Make `slice` actually find a start node by ID/anchor/heading/path — a real deterministic
index, not table-cell-only matching ([G4](../requirements/03-context-graph.md)).

## Sequence

- **Previous:** [P4.03 — Query layer](03-query-layer.md) (forward traversal).
- **Next:** [P4.07 — CLI graph/slice/impact](07-cli-graph-slice-impact.md).
- **Depends on:** P4.03 + `ParsedDocument` headings/anchors/tables (P1) · **Blocks:** P4.07, P4.08.

## Deliverables / steps

1. Build a deterministic index over: defined IDs (table cells / headings matching
   `idPattern`), heading slugs/anchors, and file paths. Heading/anchor keys use the **canonical
   github-slugger slugs** from `ParsedDocument` ([P1.02 slug contract](../P1-parsed-document/02-block-structure.md),
   audit 5.1) — same dedup (`-1`/`-2`, document order) as REF-002 and anchor edges, so `#heading`
   resolves identically everywhere.
2. `getContextSlice(graph, documents, query, depth=2)`: resolve `query` via the index (exact,
   no fuzzy/LLM), then `query(graph, { start, forward, depth })`.
3. If a value resolves to multiple start files, include all (deterministic order).
4. Keep the semantics **honest** — document exactly "exact ID/anchor/heading/path resolution"
   (no keyword/fuzzy promise) for `--help` and MCP descriptions
   ([M2](../requirements/05-mcp-server.md)).

## Decisions applied

- [G4](../requirements/03-context-graph.md) honest deterministic search.

## Exit criteria

- [ ] `slice REQ-001` resolves whether REQ-001 is a heading, anchor, ID, or path.
- [ ] No fuzzy/substring matching; results deterministic.

## Hand-off to next

P4.07 wires `slice` to the CLI; P7 reuses the same resolution for the MCP `context-slice`
with honest descriptions.
