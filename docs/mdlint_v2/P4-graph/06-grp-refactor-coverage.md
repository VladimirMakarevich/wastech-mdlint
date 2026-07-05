# P4.06 · Refactor GRP rules onto the shared graph + coverage signal

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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

## Implementation notes

- **The actual delta was narrower than "swap the injected builder" implies.** `lint-files.ts` had
  already injected the semantic `buildContextGraph` since P4.01, and anchor/import edges already
  materialized from the parse with no config — so GRP-001/002 were already reading the richer
  graph before this task started. The one real gap was `id-ref` edges: `buildContextGraph`
  supported an `idRef` option, but nothing in the orchestrator could supply it, so id-ref edges
  never actually reached the injected graph. This task closes exactly that gap; GRP rule code is
  untouched, confirming the "no rule-code change" claim rather than assuming it.
- **`settings.idRef` is a new shared setting, not a change to REF-005.** REF-005 already accepts
  an `{ idPattern, definitions, idColumn }` shape as rule options, but rule options are validated
  and closed over by the time the orchestrator builds the graph — there is no way to read them
  back out of a resolved rule. Rather than reach into REF-005's private state, `idRef` was added
  as its own `ResolvedSettings` field, mirroring how `siteRouter` is already shared between REF
  rules and the graph builder. Trade-off: a project that wants both REF-005 traceability and
  id-ref graph edges configures the same ID shape in two places — accepted as explicit and
  discoverable rather than coupling the graph builder to one specific rule's options.
- **The coverage signal checks every resolvable candidate, not just the one the graph would pick.**
  `buildContextGraph`'s edge resolution stops at the first candidate present in the corpus
  ("first match wins"). `computeGraphCoverage` instead evaluates every root-relative/router
  candidate a target could resolve to, flagging each on-disk, non-corpus Markdown file it finds.
  A single link can therefore both produce a normal graph edge (via one candidate) and appear in
  `filesOutsideCorpus` (via another candidate for the same link) — intentional, since the signal's
  job is surfacing every plausible on-disk match outside `include`, not just the one the graph
  happened to resolve to.
- **Coverage ships core-only in this task — no CLI/lint-output surface yet.**
  `computeGraphCoverage` (node/edge counts + `filesOutsideCorpus`) lives in `@wastech-mdlint/core`
  with unit tests only; it is not wired into `LintResult` or any command output. "Done" here means
  the signal and its contract are correct and stable, not that it is user-reachable yet — that is
  P4.07's job.
- **Target-candidate resolution was centralized for the graph/coverage pair only.** The
  root-relative/router resolution logic duplicated between `build-context-graph.ts` and the new
  coverage module was extracted into `path-resolve.ts`'s `resolveTargetCandidates`, refactored to
  be behavior-preserving (guarded by the existing `build-context-graph.test.ts` suite unchanged).
  REF-001/002's `primitives/reference.ts` still inlines the same logic — left alone here to keep
  this task's refactor scoped; migrating the primitives onto the same helper is a future cleanup,
  not required for this task's acceptance criteria.

## Exit criteria

- [x] GRP-001/002 produce identical (or better) results on the semantic graph with no
      rule-code change; the rules and hosts build no parallel adjacency — they read the one shared
      `ContextGraph`. (Core itself keeps a few internal deduped-adjacency views for topo-sort/SCC/
      query — `buildAdjacency`, `buildDedupedViews`, `detectCycles`; those are expected per-algorithm
      structures, not a parallel graph. See [P4.02](02-graph-algorithms.md)/[P4.03](03-query-layer.md).)
- [x] Coverage signal emitted on incomplete `include`.

## Hand-off to next

Cycle/orphan logic now lives in exactly one place; P4.08 tests it; P4.07 surfaces coverage in
the `graph` command output.
