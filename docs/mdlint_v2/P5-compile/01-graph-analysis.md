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

1. `classifyNodes(graph)` → role per node: `entry | hub | leaf | isolated | bridge` from
   `inDegree`/`outDegree` rules.
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
