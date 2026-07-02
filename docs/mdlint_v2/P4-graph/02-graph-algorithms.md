# P4.02 · Graph algorithms — topo-sort, components, explicit cycles

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Provide the core graph algorithms, with **explicit cycle data** instead of silently truncated
topo order.

## Sequence

- **Previous:** [P4.01 — ContextGraph model](01-context-graph-model.md).
- **Next:** [P4.03 — Query layer](03-query-layer.md) and [P4.06 — GRP refactor](06-grp-refactor-coverage.md).
- **Depends on:** P4.01 · **Blocks:** P4.03, P4.06.

## Deliverables / steps

1. `topologicalSort(graph)` — Kahn's algorithm with a sorted zero-in-degree queue.
2. `getComponents(graph)` — undirected BFS connected components, sorted **by size descending,
   then by the component's lexicographically-smallest node path (repo-relative POSIX) ascending**
   (audit — P4 component-sort gap) — deterministic across filesystems.
3. **Explicit cycles** ([G6](../requirements/03-context-graph.md)): SCC/DFS (reuse the existing
   Tarjan implementation now in `core`) returning the cycle list as data — not just a shorter
   topo array. Shared with GRP-001 (P4.06). **Edge multiplicity & cycles (audit — P4 edge-dedup
   gap):** duplicate edges do not multiply cycles — SCC is defined over node reachability, so
   several `A→B` edges plus a `B→A` form **one** cycle (the SCC `{A,B}`), reported once (GRP-001
   canonicalizes). Edge multiplicity is retained only for `references`/degree counts; collapsing
   duplicates is [G7 backlog](../requirements/03-context-graph.md).
4. `formatContextGraphSummary(graph)` — counts, entry points (`inDegree === 0`), top hubs.

## Decisions applied

- [G6](../requirements/03-context-graph.md) explicit cycles (reuse the existing Tarjan implementation).

## Exit criteria

- [ ] Topo-sort + components correct and deterministic.
- [ ] Cycles returned as explicit data; reading order reports what was excluded.

## Hand-off to next

P4.03 builds the traversal/query layer; P4.06 feeds the cycle list to GRP-001.
