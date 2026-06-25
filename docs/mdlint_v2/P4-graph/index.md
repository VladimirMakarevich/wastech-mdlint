# Phase P4 — ContextGraph + graph / slice / impact

> Roadmap: [v2 Index](../index.md) · Phase **P4** · Size **M** · Status **Not started** ·
> Reuse from MVP: **High**.
>
> **Goal:** make the document graph a first-class primitive with **semantic edges**, a
> **unified query layer**, and **honest deterministic search**, then expose `graph`, `slice`,
> and `impact` on the CLI — and refactor the GRP rules onto the one shared graph.

## Why this phase exists

The MVP graph models only link/image edges and slice does table-cell-only "search". P4
implements the [context-graph requirements](../requirements/03-context-graph.md): semantic
edges (ID/anchor/import, [G1](../requirements/03-context-graph.md)), one query layer
([G2](../requirements/03-context-graph.md)), a real ID/anchor/heading index
([G4](../requirements/03-context-graph.md)), explicit cycles
([G6](../requirements/03-context-graph.md)), a coverage signal
([G5](../requirements/03-context-graph.md)), and Mermaid/DOT export
([G9](../requirements/03-context-graph.md)). It also fulfills
[R5](../requirements/02-rules-engine.md): GRP rules stop re-implementing traversal and consume
this graph. See the [context-graph requirements](../requirements/03-context-graph.md).

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P4.01](01-context-graph-model.md) | `ContextGraph` model + `buildContextGraph` (semantic edges, metadata) | M | P3 done |
| [P4.02](02-graph-algorithms.md) | Topo-sort, components, explicit cycles | S | P4.01 |
| [P4.03](03-query-layer.md) | Unified query layer | M | P4.02 |
| [P4.04](04-search-index-slice.md) | Deterministic ID/anchor/heading index + `slice` | M | P4.03 |
| [P4.05](05-impact-analysis.md) | `impact` (`getImpactSet` / `classifyImpact`) | M | P4.03 |
| [P4.06](06-grp-refactor-coverage.md) | Refactor GRP rules onto shared graph + coverage signal | M | P4.02 |
| [P4.07](07-cli-graph-slice-impact.md) | CLI `graph`/`slice`/`impact` + Mermaid/DOT export | M | P4.04, P4.05 |
| [P4.08](08-graph-tests.md) | Graph/slice/impact tests & fixtures | M | all above |

## Sequence

```
(P3.09) ─► P4.01 ─► P4.02 ─┬─► P4.03 ─┬─► P4.04 ─┐
                           │          └─► P4.05 ─┼─► P4.07 ─► P4.08 ─► (Phase P5)
                           └─► P4.06 ───────────┘
```

## Decisions applied

- [G1–G6, G9](../requirements/03-context-graph.md) · [R5](../requirements/02-rules-engine.md)
  unify GRP rules · ([G7/G8 are backlog](../requirements/03-context-graph.md)).

## Phase exit criteria

- [ ] `ContextGraph` has typed edges (`link|image|anchor|id-ref|import`) with `line`/`text`.
- [ ] One query layer powers `slice` and `impact`; GRP rules use the same graph (R5).
- [ ] `slice` resolves a real ID/anchor/heading/path index (G4); semantics honest in `--help`.
- [ ] `impact` reports direct/transitive (+`via`) and lints the affected subgraph.
- [ ] Explicit cycle list (G6) and coverage signal (G5) surfaced.
- [ ] `graph` exports JSON + Mermaid/DOT (G9).

## What P4 unblocks

- **P5** — `compile` profiles richer edges (`referencesTo`/`referencedBy`).
- **P7** — MCP `context-graph`/`context-slice`/`impact-analysis` wrap this query layer.
