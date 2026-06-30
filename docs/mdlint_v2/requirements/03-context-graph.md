# v2 Requirements — 03 · Context Graph & Search

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md)
> (Phases **P1** parse, **P4** graph/slice/impact).
>
> Locked v2 requirement; authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Status | Notes |
| --- | --- | --- | --- |
| **G1** | ID / anchor / eager-import edges as first-class | ✅ Accepted | Extend `GraphEdge.type`; promote semantic links into real edges. Ties to [D3](../index.md), [R5/R9](02-rules-engine.md). |
| **G2** | Unified query layer for slice/impact/MCP/skills | ✅ Accepted | One `query(graph, …)` API. Ties to R5. |
| **G3** | Edge metadata (`text`, `rawTarget`) | ✅ Accepted | Explainability for CLI/MCP/`--fix`. |
| **G4** | Honest deterministic ID/anchor/heading index for `slice` | ✅ Accepted | Real index, no fuzzy/LLM. Fixes the "search" misnomer. |
| **G5** | Coverage signal when graph input is incomplete | ✅ Accepted | Warn on linked-to on-disk files outside `include`. |
| **G6** | Explicit cycle detection (reuse the existing Tarjan SCC) | ✅ Accepted | Replaces silent Kahn truncation; feeds `GRP-001`. |
| **G7** | Collapse duplicate edges with `count` | 🔵 Backlog | Next implementation iteration. |
| **G8** | Incremental / cached graph rebuild | 🔵 Backlog | Next iteration; design loader so a cache can slot in. |
| **G9** | `graph` export to Mermaid / DOT | ✅ Accepted | `--format mermaid\|dot` alongside JSON. |

## Detail & rationale

- **G1 — semantic edges (headline).** The spec models only `link`+`image`, though the
  conceptual graph spans links/IDs/anchors/images. v2 extends
  `GraphEdge.type → link | image | anchor | id-ref | import` and materializes:
  - **anchor** edges (`#section` / `file.md#section`) — today parsed then dropped;
  - **id-ref** edges (a table-cell/heading ID referenced from another doc) — replaces
    the side-channel "ID search" hack;
  - **import** edges (`@path/to/file.md` eager imports — the [D3](../index.md) LLM
    feature).

  Result: `slice`/`impact`/`compile` reason over the full dependency reality (e.g.
  impact catches "REQ-001 is referenced in design.md" with no Markdown link). This is
  the core agent value and the spec's own extension point #2.

- **G2 — unified query layer.** One `query(graph, { start, direction, depth, edgeTypes })`
  that `slice`, `impact`, MCP tools, and `compile` all call (spec extension #3). Edge-type
  filtering (from G1) lives here. Removes today's bespoke BFS in slice/impact and the
  re-implemented traversals in graph rules ([R5](02-rules-engine.md)).

- **G3 — edge metadata.** Add `text?` (link/anchor label) and `rawTarget?` (`line`
  already exists) so hosts can explain *why* an edge exists
  (`design.md:42 → via "[see REQ-001]"`). Spec extension #4.

- **G4 — honest deterministic search.** Both the graph spec and the MCP spec flag that
  `slice`'s "keyword search" is really exact path / table-cell match. v2 builds a small
  **deterministic index** over headings + anchors + defined IDs + table cells and returns
  exact matches — no fuzzy/LLM. `slice REQ-001` resolves whether REQ-001 is a heading,
  anchor, or cell. `--help`/docs state the semantics honestly.

- **G5 — coverage signal.** The spec warns an incomplete `include` yields an incomplete
  graph with no signal. v2 emits a diagnostic when on-disk Markdown under the repo is
  linked-to but excluded from `include`, and reports node/edge counts + "N files on disk
  outside the corpus." Prevents silently-wrong impact/orphan results.

- **G6 — explicit cycles.** `topologicalSort` silently returns a shortened array on
  cycles. v2 surfaces cycles as data via SCC/DFS (reusing the current Tarjan
  implementation) and shares it with `GRP-001` ([R5](02-rules-engine.md)). Honest reading
  order + cycle list.

- **G9 — diagram export.** `graph --format mermaid|dot` in addition to JSON. PLAN.md
  intended the graph "for later visualization"; emitting Mermaid/DOT gives a paste-ready
  diagram. Low cost, good DX.

## Backlog (next implementation iteration — not v2)

- **G7 — duplicate-edge collapsing.** The spec keeps every repeated link as a separate
  edge, which inflates `references`/degrees. Proposal for later: collapse to a unique
  `(source, target, type)` edge with a `count` (+ retained lines). Deferred to keep v2
  edge semantics identical to the reference for now.
- **G8 — incremental/cached rebuild.** Graph is rebuilt in full each run. Deferred; G2's
  query layer + a content-hash cache enable this later, especially for `--watch`. Design
  the loader so a cache layer can slot in without API changes.

## Downstream impact

- **Parser (P1):** expose anchors, defined IDs, and `@import` targets so G1 edges can be
  built; keep link label text for G3.
- **Rule engine (P2/P3):** `GRP-001/002` consume the shared graph + cycle data (R5/G6);
  `REF-005`/`id-ref` rules can read id-ref edges instead of re-scanning tables.
- **CLI (P4):** `graph` gains `--format mermaid|dot` (G9); `slice` uses the deterministic
  index (G4); coverage diagnostics surfaced (G5).
- **MCP (P7):** `context-slice` / `impact-analysis` call the unified query layer (G2) and
  report honest match semantics (G4).
- **Compile (P5):** richer edges (G1) improve `referencesTo`/`referencedBy` profiling.
