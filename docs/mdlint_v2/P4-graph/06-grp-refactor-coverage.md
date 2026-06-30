# P4.06 · Refactor GRP rules onto the shared graph + coverage signal

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Fulfill [R5](../requirements/02-rules-engine.md): GRP rules consume the one `ContextGraph`
instead of re-implementing traversal, and add the [G5](../requirements/03-context-graph.md)
coverage signal.

## Sequence

- **Previous:** [P4.02 — Graph algorithms](02-graph-algorithms.md) (explicit cycles) and the
  GRP rules from [P3.06](../P3-rules/06-grp-rules.md) (currently using a local graph build).
- **Next:** [P4.07 — CLI graph/slice/impact](07-cli-graph-slice-impact.md).
- **Depends on:** P4.02, P3.06 · **Blocks:** P4.08.

## Deliverables / steps

1. Refactor **GRP-001** to consume the explicit cycle list (P4.02/[G6](../requirements/03-context-graph.md)).
2. Refactor **GRP-002** to use `inDegree` from the shared graph (+ `entryPoints`/site-router).
3. Pass the shared graph via `RuleContext.graph` (wired in [P2.05](../P2-rule-engine/05-orchestration-lintfiles.md));
   remove the duplicate adjacency logic.
4. **Coverage signal** ([G5](../requirements/03-context-graph.md)): warn when on-disk Markdown
   under the repo is linked-to but outside `include`; report node/edge counts + "N files
   outside corpus".

## Decisions applied

- [R5](../requirements/02-rules-engine.md) one graph · [G6](../requirements/03-context-graph.md)
  explicit cycles · [G5](../requirements/03-context-graph.md) coverage signal.

## Exit criteria

- [ ] GRP-001/002 produce identical (or better) results using the shared graph; no duplicate
      traversal code remains.
- [ ] Coverage signal emitted on incomplete `include`.

## Hand-off to next

Cycle/orphan logic now lives in exactly one place; P4.08 tests it; P4.07 surfaces coverage in
the `graph` command output.
