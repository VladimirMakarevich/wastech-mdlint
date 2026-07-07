# P5.01 · `classifyNodes` + `analyzeGraph`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Classify graph nodes into roles and bundle the graph analysis the synthesizer needs.

## Sequence

- **Previous:** [P4.08 — Graph tests](../P4-graph/08-graph-tests.md) delivered a trusted
  `ContextGraph` + algorithms.
- **Next:** [P5.02 — Doc profile](02-doc-profile.md) and [P5.03 — Describe rules](03-describe-rules.md).
- **Depends on:** P4 done · **Blocks:** P5.02, P5.04.

## Deliverables / steps

1. `classifyNodes(graph)` → **exactly one** role per node from `inDegree` (`in`) / `outDegree`
   (`out`), **first match wins** (thresholds decided 2026-07-02, audit 3.3):
   1. **isolated** — `in == 0 && out == 0`.
   2. **hub** — `in >= H`, where `H = compile.hubMinInDegree` (default **3**). Checked before
      entry/leaf so a heavily-referenced terminal doc (e.g. a glossary everything links to) is a
      `hub`, not a `leaf`.
   3. **entry** — `in == 0` (implies `out > 0`) — reading-order root.
   4. **leaf** — `out == 0` (implies `in > 0 && in < H`) — dead-end.
   5. **bridge** — otherwise (`in > 0 && out > 0 && in < H`) — internal connector.

   The set is mutually exclusive and exhaustive. Classification is **degree-only**: `bridge` is a
   degree heuristic, **not** a graph-theoretic cut vertex — P4 ships no articulation-point
   algorithm and P5 must not re-implement one. A **fixed, configurable** threshold `H` keeps roles
   deterministic and corpus-independent (a node's role depends only on its own degrees).

2. `analyzeGraph(graph)` → `{ readingOrder, excludedFromReadingOrder, components, classification }`.
   `topologicalSort` returns `{ order, excluded }` (`graph/graph-algorithms.ts`) — capture **both**:
   `readingOrder = order` and `excludedFromReadingOrder = excluded` (nodes a cycle dropped from the
   order). Also thread `graph.cycles` through so P5.04 can render cycles honestly (G6) rather than
   emitting a silently truncated reading order.
3. Reuse P4 algorithms (no re-implementation).

## Decisions applied

- Reuses [P4](../index.md) graph/algorithms; [R5](../requirements/02-rules-engine.md) one graph.

## Implementation notes

- **Lives in `src/compile/`, not `src/graph/`.** The inputs are graph primitives, but node
  _roles_ are compile semantics that only P5.02/P5.04 consume. Keeping them out of P4's generic
  graph layer stops compile-specific vocabulary from leaking into the reusable graph API.
- **`analyzeGraph` carries `cycles`, even though the illustrative task shape omits it.** The same
  step explicitly requires threading `graph.cycles` through for P5.04, so the shape is internally
  inconsistent without it. Rather than have P5.04 reach back into the raw graph, the analysis
  result is the single hand-off object — cycles are copied (`[...cycle]`) so downstream code
  cannot mutate the graph's own arrays.
- **`classification` is a path-ordered array, not a `Map`.** It mirrors the graph's existing node
  order so callers can line it up with the node list they already have, and it keeps compile
  output JSON-friendly and deterministic — consistent with every other core output
  (`nodes`, `edges`, `components`).
- **Roles are computed from the raw retained-multiplicity degrees on `graph.nodes`, never from a
  deduped adjacency view.** `buildContextGraph` deliberately keeps edge multiplicity in
  `inDegree`/`outDegree`, and the role thresholds are defined against those counts. Recomputing
  degrees from `graph-algorithms.ts`'s reachability-oriented (deduped) views would silently change
  which nodes cross the hub threshold. So `classifyNodes` reads degrees directly while
  `analyzeGraph` still delegates reading order and components to the existing P4 algorithms — one
  degree model for classification, one traversal for everything else.
- **`hubMinInDegree` is exposed as an option now, ahead of the literal `classifyNodes(graph)`
  spec.** P5.05 validates `config.compile.hubMinInDegree`; adding the optional override here lets
  that resolved threshold flow in without reopening this API later. The default stays `3`
  (`DEFAULT_HUB_MIN_IN_DEGREE`), so the zero-arg call shape in the spec is unchanged.
- **`bridge` stays a degree heuristic, not an articulation-point algorithm.** P4 ships no cut-vertex
  algorithm and P5 must not grow one; "bridge" here means only `in > 0 && out > 0 && in < H`.
- **Core-only surface — no CLI or MCP wiring.** This task ships `analyzeGraph`/`classifyNodes` and
  their types from `@wastech-mdlint/core`; "Done" means the classification and analysis contracts
  are stable for P5.02/P5.04 to build on, not that any user-visible `compile` behavior exists yet
  (that arrives in P5.05).

## Exit criteria

- [x] Node roles assigned deterministically.
- [x] `analyzeGraph` returns reading order + components + classification.

## Hand-off to next

P5.02 attaches per-document profiles using these roles; P5.04 renders the architecture
section from them.
