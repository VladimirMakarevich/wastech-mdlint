# P4.06 · Refactor GRP rules onto the shared graph + coverage signal

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Fulfill [R5](../requirements/02-rules-engine.md)/[G6](../requirements/03-context-graph.md):
swap the orchestrator-injected graph from the P3 legacy builder to the semantic `ContextGraph`
so GRP rules run on real anchor/id-ref/import edges + explicit cycle data, and add the
[G5](../requirements/03-context-graph.md) coverage signal. GRP rules already consume
`RuleContext.graph` (audit 2.2) — **this task changes the builder, not the rules.**

## Sequence

- **Previous:** [P4.02 — Graph algorithms](02-graph-algorithms.md) (explicit cycles) and the
  GRP rules from [P3.06](../P3-rules/06-grp-rules.md) (currently using a local graph build).
- **Next:** [P4.07 — CLI graph/slice/impact](07-cli-graph-slice-impact.md).
- **Depends on:** P4.02, P3.06 · **Blocks:** P4.08.

## Deliverables / steps

1. In the orchestrator ([P2.05](../P2-rule-engine/05-orchestration-lintfiles.md)) **swap the
   injected builder** from the relocated legacy build to the semantic `buildContextGraph`
   ([P4.01](01-context-graph-model.md)). GRP-001 picks up the richer explicit cycle list
   (P4.02/[G6](../requirements/03-context-graph.md)) and GRP-002 the graph `inDegree`
   (+ `entryPoints`/site-router) **automatically — no rule-code change** (audit 2.2). There is
   no duplicate adjacency to remove: under the injected-graph model the rules never had one.
2. Verify GRP-001/002 produce identical-or-better results now that anchor/id-ref/import edges
   exist; extend fixtures for cycles/orphans that only appear via the new edge types.
3. **Coverage signal** ([G5](../requirements/03-context-graph.md)): warn when on-disk Markdown
   under the repo is linked-to but outside `include`; report node/edge counts + "N files
   outside corpus".

## Decisions applied

- [R5](../requirements/02-rules-engine.md) one graph · [G6](../requirements/03-context-graph.md)
  explicit cycles · [G5](../requirements/03-context-graph.md) coverage signal.

## Exit criteria

- [ ] GRP-001/002 produce identical (or better) results on the semantic graph with no
      rule-code change; the only graph traversal lives in `ContextGraph` (no parallel adjacency
      anywhere).
- [ ] Coverage signal emitted on incomplete `include`.

## Hand-off to next

Cycle/orphan logic now lives in exactly one place; P4.08 tests it; P4.07 surfaces coverage in
the `graph` command output.
