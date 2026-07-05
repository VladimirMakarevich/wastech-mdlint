# P4.02 · Graph algorithms — topo-sort, components, explicit cycles

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

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

## Implementation notes

- **"Reuse the existing Tarjan implementation" means reading `graph.cycles`, not relocating it.**
  P4.01's `buildContextGraph` already runs Tarjan and stores the canonicalized, deduped cycle list
  on the graph (G6). `topologicalSort`/`formatContextGraphSummary` consume that field directly
  instead of re-running SCC or extracting a standalone `getCycles` out of the builder — moving a
  frozen, already-correct algorithm would be pure churn. Downstream consumers (P4.03, P4.06,
  GRP-001) should keep reading `graph.cycles` rather than expecting a separate cycle accessor from
  this module.
- **In-degree is deduped before Kahn's runs, degree fields are not.** `ContextGraphNode.inDegree`
  intentionally retains edge multiplicity (P4.01 constraint — two `A→B` links are two references).
  Feeding that raw count into Kahn's would strand a node behind a duplicated edge at a permanent
  in-degree ≥ 1, misreporting it as cycle-excluded. The algorithms build a private deduped
  adjacency/in-degree view for reachability purposes only; `formatContextGraphSummary`'s entry-point
  and hub numbers still use the retained-multiplicity fields, since those are display counts, not
  reachability tests. Collapsing multiplicity globally stays G7 backlog.
- **`excluded` is deliberately broader than "the cycle members."** It is every node
  `topologicalSort` never emits — a cycle's own nodes plus anything reachable only through them.
  This is the G6 honesty fix the task calls for: the prior behavior silently truncated the topo
  array with no record of what was dropped or why. Pair `excluded` with `graph.cycles` to explain
  *which* cycle caused a given exclusion.

## Exit criteria

- [x] Topo-sort + components correct and deterministic.
- [x] Cycles returned as explicit data; reading order reports what was excluded.

## Hand-off to next

P4.03 builds the traversal/query layer; P4.06 feeds the cycle list to GRP-001.
