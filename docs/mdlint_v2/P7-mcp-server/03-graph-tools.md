# P7.03 · `context-graph`, `context-slice`, `impact-analysis` tools

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Expose the graph capabilities as MCP tools over the unified query layer, with honest slice
semantics.

## Sequence

- **Previous:** [P7.01 — Server foundation](01-server-foundation.md) + the graph/query layer
  ([P4.03](../P4-graph/03-query-layer.md), [P4.04](../P4-graph/04-search-index-slice.md),
  [P4.05](../P4-graph/05-impact-analysis.md)).
- **Next:** [P7.05 — Integration tests & docs](05-integration-tests-docs.md).
- **Depends on:** P7.01, P4 · **Parallel with:** P7.02, P7.04.

## Deliverables / steps

1. `context-graph` — `{ configPath?, cwd?, format?: "json"|"summary" }`: build graph →
   structured `{ nodes, edges }` (json) or `formatContextGraphSummary` (summary).
2. `context-slice` — `{ query, depth?, configPath?, cwd? }`: resolve via the deterministic
   index ([P4.04](../P4-graph/04-search-index-slice.md)) → `query` forward → structured
   `{ query, matchType, files[], totalFiles, summary }`. **Description states exact
   ID/anchor/heading/path resolution** — no keyword-search promise
   ([M2](../requirements/05-mcp-server.md)).
3. `impact-analysis` — `{ file, configPath?, cwd? }`: validate file in corpus →
   `classifyImpact` → `relativizeImpact` → structured `{ changedFile, directlyAffected,
   transitivelyAffected, summary }`; out-of-corpus → `{ code, message, hint }`
   ([M6](../requirements/05-mcp-server.md)).
4. Structured output ([M1](../requirements/05-mcp-server.md)); read-only annotations
   ([M7](../requirements/05-mcp-server.md)).

## Decisions applied

- [M1, M2, M6, M7](../requirements/05-mcp-server.md) · reuses [G2](../requirements/03-context-graph.md)
  query layer + [G4](../requirements/03-context-graph.md) index.

## Exit criteria

- [ ] All three tools return structured output matching the CLI contracts.
- [ ] `context-slice` description is honest; out-of-corpus `impact` returns an actionable error.

## Hand-off to next

P7.05 integration-tests these over stdio; P8's `-impact` skill prefers `impact-analysis`.
