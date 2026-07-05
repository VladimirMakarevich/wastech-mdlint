# P4.05 · Impact analysis (`getImpactSet` / `classifyImpact`)

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Compute the blast radius of changing a file: which docs are directly vs transitively affected.

## Sequence

- **Previous:** [P4.03 — Query layer](03-query-layer.md) (reverse traversal).
- **Next:** [P4.07 — CLI graph/slice/impact](07-cli-graph-slice-impact.md).
- **Depends on:** P4.03 · **Blocks:** P4.07, P4.08.

## Deliverables / steps

1. `getImpactSet(graph, file)` — reverse BFS over `query` with **no depth limit** (full
   transitive closure). The query layer's mandatory visited-set guarantees termination on
   cyclic graphs (audit 5.2); no artificial depth cap (capping would drop genuinely-affected
   files). A hub referenced by almost everything legitimately yields a large set — that is
   correct, and the traversal stays bounded to O(nodes+edges) by the visited-set.
2. `classifyImpact(graph, file)` — `directlyAffected` (with `references` count) +
   `transitivelyAffected` (with `via`).
3. `relativizeImpact(impact, cwd)` for output; reuse `topologicalSort` to produce a reading
   order over the affected subgraph.
4. Validate the input file is in the corpus; clear error + hint if not (ties to
   [M6](../requirements/05-mcp-server.md) when surfaced via MCP).

## Decisions applied

- Reuses [G2](../requirements/03-context-graph.md) query layer; semantic edges
  ([G1](../requirements/03-context-graph.md)) make impact catch ID/anchor/import dependencies,
  not just Markdown links.

## Implementation notes

- **No new traversal or topo-sort: `impact-analysis.ts` is a thin classifier over P4.03/P4.02.**
  `getImpactSet`/`classifyImpact` call `impact()` (reverse `query`) for the closure and
  `topologicalSort` for reading order; they do not walk edges themselves. This keeps the
  architecture invariant — one traversal, one topo-sort, every graph feature reuses them — intact
  rather than growing a fourth bespoke walk.
- **`getImpactSet` excludes the start by filtering `depth > 0`, not by a separate query.** `impact()`
  always includes the start node at depth 0 (query.ts's contract); re-deriving "everything but the
  changed file" as a filter keeps this module from special-casing the traversal itself.
- **`references` retains edge multiplicity, matching the P4.01/P4.02 convention.** Two links from
  the same file count as two references rather than being deduped — consistent with
  `ContextGraphNode.inDegree` and `graph-algorithms.ts`'s documented stance that multiplicity is a
  display concern, not a reachability one.
- **Reading order runs over the affected subgraph, not the whole graph.** The subgraph is the
  changed file plus everything `impact()` found, with edges restricted to endpoints inside that
  set; `cycles: []` is passed to `topologicalSort` because that function only reads
  `nodes`/`edges` — GRP-001 stays the sole owner of cycle _reporting_. A cycle among the affected
  files therefore surfaces honestly as members of `excluded`, not as a silently wrong order.
- **`relativizeImpact`'s `cwd` is repository-relative, not absolute.** The AC fixes the
  `(impact, cwd)` shape but not that choice; repo-relative was picked so core needs no repo-root
  parameter and stays platform-agnostic — a host with an absolute invocation directory converts it
  to repo-relative before calling. The repo root is `cwd: ""`, which maps to identity.
- **`readingOrder` is mapped through `relativizeImpact`, never re-sorted.** It is a topological
  order (predecessors before successors), not a path-sorted array like `directlyAffected` /
  `transitivelyAffected` / `excluded`; re-sorting it alphabetically after relativizing would
  silently discard the topo-sort's actual order whenever it differs from lexical order (caught in
  review — see the regression fixture in `graph-impact.test.ts` where a predecessor `z.md` must
  stay before its successor `a.md`).
- **`ImpactAnalysisError` never guesses a "did you mean" suggestion.** Unlike
  `RuleResolutionError`'s rule-id suggestion, an out-of-corpus file only gets a fixed `.hint`
  sentence about repo-relative POSIX paths and config globs — making the suggestion depend on
  corpus contents would make the error non-deterministic across otherwise-identical inputs.
- **This task ships `classifyImpact`/`getImpactSet`/`relativizeImpact` in `@wastech-mdlint/core`
  only — no CLI or MCP surface.** P4.07 wires the `impact` command and P7's MCP tool wraps
  `relativizeImpact` for cwd-relative JSON; "Done" here means the classification contract is
  stable, not that `impact <file>` is runnable yet.

## Exit criteria

- [x] Direct/transitive sets correct with `references`/`via`.
- [x] Reverse traversal terminates on cyclic graphs (visited-set) and returns the full transitive closure.
- [x] Affected-subgraph reading order produced.
- [x] Out-of-corpus file → actionable error.

## Hand-off to next

P4.07 prints impact + lints the affected files; P7's `impact-analysis` tool wraps this with
cwd-relative JSON.
