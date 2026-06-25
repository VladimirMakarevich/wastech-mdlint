# P4.03 · Unified query layer

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

One traversal API that `slice`, `impact`, MCP, and compile all call — no more bespoke BFS per
consumer ([G2](../requirements/03-context-graph.md)).

## Sequence

- **Previous:** [P4.02 — Graph algorithms](02-graph-algorithms.md).
- **Next:** [P4.04 — Search index + slice](04-search-index-slice.md) and
  [P4.05 — Impact](05-impact-analysis.md) build on it.
- **Depends on:** P4.02 · **Blocks:** P4.04, P4.05; later consumed by MCP (P7) and compile (P5).

## Deliverables / steps

1. `query(graph, { start, direction: "forward"|"reverse", depth, edgeTypes? })` returning a
   deterministic, sorted visited set + traversal metadata (depth/`via`).
2. `edgeTypes` filter leverages the typed edges from P4.01 (e.g. follow only `import` edges,
   or all but `image`).
3. Both `slice` (forward) and `impact` (reverse) are thin wrappers over this.

## Decisions applied

- [G2](../requirements/03-context-graph.md) unified query layer.

## Exit criteria

- [ ] `query` supports forward/reverse, depth limits, and edge-type filtering.
- [ ] Output is deterministic and carries `via`/depth metadata.

## Hand-off to next

P4.04 resolves a start node then calls `query` forward; P4.05 calls it reverse for blast
radius.
