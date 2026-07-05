# P4.04 · Deterministic search index + `slice`

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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

## Implementation notes

- **`idRef` is an optional 5th parameter, not part of the AC-documented signature.** AC1 requires
  resolving IDs matching `idPattern`, which lives only in config, not in `ParsedDocument` or
  `ContextGraph`. `getContextSlice(graph, documents, query, depth = 2, idRef?)` keeps `depth` in
  its documented 4th position with its default and adds `idRef` after it — the same shape
  `buildContextGraph`'s own optional `idRef` already uses (ID resolution is opt-in per host, not a
  hard dependency of the graph or the index). A host that never loads config still gets
  path/heading/anchor resolution; it only loses ID resolution.
- **Cross-category precedence is a deliberate, fixed choice, not part of the spec.** A leading `#`
  is always an anchor/heading-slug lookup and never falls through; otherwise the order is path →
  ID → heading, and the first category with a match wins outright rather than merging or ranking
  across categories. Real collisions are rare — paths carry `.md`/`/`, IDs match `idPattern`, and
  slugs are lowercased — so fixing the order once keeps `slice REQ-001` deterministic without
  needing a scoring heuristic, which would reopen the fuzzy-matching door this task is closing.
- **"No fuzzy/substring/LLM matching" means plain `Map`/`Set` lookups only.** `resolveQuery` does
  exact string equality against the index; there is no scoring, no partial match, and no ranking.
  `SLICE_RESOLUTION_DESCRIPTION` is exported from `search-index.ts` specifically so P4.07's
  `--help` text and P7's MCP tool description quote this same honest sentence instead of drifting
  into separately worded (and possibly over-promising) copy.
- **This task ships the resolution + slice logic in `@wastech-mdlint/core` only — no CLI or MCP
  surface.** `getContextSlice` is a pure library function; P4.07 wires it to the `slice` command
  and P7 wires the same resolution into the MCP `context-slice` tool. "Done" here means the
  resolution contract (index shape, precedence, `ContextSliceResult`) is stable, not that
  `slice REQ-001` is runnable from the CLI yet.

## Exit criteria

- [x] `slice REQ-001` resolves whether REQ-001 is a heading, anchor, ID, or path.
- [x] No fuzzy/substring matching; results deterministic.

## Hand-off to next

P4.07 wires `slice` to the CLI; P7 reuses the same resolution for the MCP `context-slice`
with honest descriptions.
