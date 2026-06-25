# P4.05 · Impact analysis (`getImpactSet` / `classifyImpact`)

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Compute the blast radius of changing a file: which docs are directly vs transitively affected.

## Sequence

- **Previous:** [P4.03 — Query layer](03-query-layer.md) (reverse traversal).
- **Next:** [P4.07 — CLI graph/slice/impact](07-cli-graph-slice-impact.md).
- **Depends on:** P4.03 · **Blocks:** P4.07, P4.08.

## Deliverables / steps

1. `getImpactSet(graph, file)` — reverse BFS over `query`.
2. `classifyImpact(graph, file)` — `directlyAffected` (with `references` count) +
   `transitivelyAffected` (with `via`).
3. `relativizeImpact(impact, cwd)` for output; reuse `topologicalSort` to produce a reading
   order over the affected subgraph.
4. Validate the input file is in the corpus; clear error + hint if not (ties to
   [M6](../requirements/05-mcp-server.md) when surfaced via MCP).

## Decisions applied

- Reuses [G2](../requirements/03-context-graph.md) query layer; semantic edges
  ([G1](../requirements/03-context-graph.md)) make impact catch ID/anchor/import dependencies,
  not just Markdown links.

## Exit criteria

- [ ] Direct/transitive sets correct with `references`/`via`.
- [ ] Affected-subgraph reading order produced.
- [ ] Out-of-corpus file → actionable error.

## Hand-off to next

P4.07 prints impact + lints the affected files; P7's `impact-analysis` tool wraps this with
cwd-relative JSON.
