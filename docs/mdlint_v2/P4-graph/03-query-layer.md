# P4.03 · Unified query layer

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

One traversal API that `slice`, `impact`, MCP, and compile all call — no more bespoke BFS per
consumer ([G2](../requirements/03-context-graph.md)).

## Sequence

- **Previous:** [P4.02 — Graph algorithms](02-graph-algorithms.md).
- **Next:** [P4.04 — Search index + slice](04-search-index-slice.md) and
  [P4.05 — Impact](05-impact-analysis.md) build on it.
- **Depends on:** P4.02 · **Blocks:** P4.04, P4.05; later consumed by MCP (P7) and compile (P5).

## Deliverables / steps

1. `query(graph, { start, direction: "forward"|"reverse", depth?, edgeTypes? })` returning a
   deterministic, sorted visited set + traversal metadata (depth/`via`). **Cycle-safe by
   construction (audit 5.2):** an internal `visited` set expands each node **at most once**, so
   traversal always terminates even on cyclic graphs (GRP-001 _reports_ cycles but does not
   remove them). `depth` is **optional** — a number bounds hops (`slice` uses `depth: 2`);
   omitted ⇒ traverse to exhaustion (full closure, used by `impact`).
2. `edgeTypes` filter leverages the typed edges from P4.01 (e.g. follow only `import` edges,
   or all but `image`).
3. Both `slice` (forward) and `impact` (reverse) are thin wrappers over this.

## Decisions applied

- [G2](../requirements/03-context-graph.md) unified query layer.

## Implementation notes

- **A second, direction-aware adjacency builder is intentional, not a fork of P4.02's.**
  `graph-algorithms.ts`'s `buildDedupedViews` is untyped, forward-only, and has no predecessor
  direction — it can answer "does A reach B" but not "walk backward from B, following only
  `import` edges." `query.ts` builds its own typed adjacency for that reason; this _is_ the unified
  layer G2 asks for; `slice`/`impact`/MCP/compile call `query`, not each other's traversal code.
- **`edgeTypes: undefined` vs `edgeTypes: []` is a real behavioral fork, not an edge case.** Omitting
  the option follows every edge type; passing an empty array follows none and returns just the start
  node. The distinction matters once callers build this option from user input (e.g. a CLI flag
  that may or may not be supplied) — collapsing the two would silently turn "no filter requested"
  into "match nothing."
- **`via` is a predecessor node path, not an edge reference.** Diamond-shaped reachability (two
  paths into the same node) needs a tie-break; the first predecessor reached at the current BFS
  level — processed in sorted order — claims the node, so `via` is always the smallest predecessor
  at minimal depth. Richer edge metadata (which specific link claimed the node) is deferred until
  P5/P7 have a concrete need for it (YAGNI), not because it is technically hard to add.
- **No CLI or MCP surface ships with this task.** `query`/`slice`/`impact` are pure library
  functions in `@wastech-mdlint/core`; P4.04 and P4.05 build the `slice`/`impact` command and report
  surfaces on top of them, and P7 wires MCP the same way. Documenting them here as "Done" means the
  traversal contract is stable, not that they are user-reachable yet.

## Exit criteria

- [x] `query` supports forward/reverse, depth limits, and edge-type filtering.
- [x] Output is deterministic and carries `via`/depth metadata.

## Hand-off to next

P4.04 resolves a start node then calls `query` forward; P4.05 calls it reverse for blast
radius.
