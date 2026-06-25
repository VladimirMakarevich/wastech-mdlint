# P4.08 · Graph / slice / impact tests & fixtures

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Lock the graph behavior end-to-end so P5 (compile) and P7 (MCP) build on a trusted graph.

## Sequence

- **Previous:** all of P4.01–P4.07.
- **Next:** **Phase P5 — Context compiler & `compile`** (see [roadmap](../index.md)).
- **Depends on:** P4.01–P4.07 · **Blocks:** start of P5.

## Deliverables / steps

1. Unit tests: edge building (incl. anchor/import/id-ref), topo-sort, components, cycles,
   query layer (forward/reverse/edge-type filters), search index resolution.
2. Fixtures: a multi-doc project with links, anchors, imports, an ID chain, and a cycle;
   plus an "outside-corpus" file to assert the coverage signal (G5).
3. e2e: `graph`/`slice`/`impact` over the fixture (human + JSON + Mermaid/DOT); determinism
   check on output ordering.
4. Confirm GRP-002/003 (refactored, P4.06) still pass against the same fixtures.

## Decisions applied

- Determinism · focused fixtures (AGENTS.md) · covers
  [G1–G6, G9](../requirements/03-context-graph.md).

## Exit criteria

- [ ] Graph algorithms + query layer + search index covered by unit tests.
- [ ] e2e graph/slice/impact green; output deterministic.
- [ ] Phase P4 [exit criteria](index.md) satisfied.

## Hand-off to next

P5 consumes the graph (`classifyNodes`/`analyzeGraph`/`extractDocProfile`) to synthesize the
project skill.
