# P5.01 · `classifyNodes` + `analyzeGraph`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

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
2. `analyzeGraph(graph)` → `{ readingOrder (topo-sort), components, classification }`.
3. Reuse P4 algorithms (no re-implementation).

## Decisions applied

- Reuses [P4](../index.md) graph/algorithms; [R5](../requirements/02-rules-engine.md) one graph.

## Exit criteria

- [ ] Node roles assigned deterministically.
- [ ] `analyzeGraph` returns reading order + components + classification.

## Hand-off to next

P5.02 attaches per-document profiles using these roles; P5.04 renders the architecture
section from them.
