# P4.08 · Graph / slice / impact tests & fixtures

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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
4. Confirm GRP-001/002 (refactored, P4.06) still pass against the same fixtures.

## Decisions applied

- Determinism · focused fixtures (AGENTS.md) · covers
  [G1–G6, G9](../requirements/03-context-graph.md).

## Implementation notes

- **No new unit tests for edge building/topo-sort/components/query filters/search-index
  resolution.** P4.01–P4.06 already ship a dedicated suite per module (`build-context-graph`,
  `graph-algorithms`, `graph-query`, `search-index-slice`, `graph-coverage`, `graph-render`).
  Re-testing that surface here would duplicate coverage instead of adding it; P4.08's net-new
  work is the shared fixture and the e2e/GRP confirmation the earlier tasks couldn't exercise on
  their own (a real CLI invocation, all four `graph` formats, and GRP-001/002 firing through the
  actual config-load → `lintFiles` path rather than a hand-built `ConfiguredRule`).
- **One committed fixture (`packages/cli/test/fixtures/graph-project/`), not a per-test temp
  dir.** `graph`/`slice`/`impact`/`lint` never write to the corpus they analyze, so unlike
  `cli.test.ts`'s throwaway `mkdtemp` repos, a single on-disk project can be reused as `cwd`
  across every test in `graph.e2e.test.ts` — and reusing the _same_ corpus for the GRP-001/002
  confirmation is what makes "still pass against the same fixtures" (this task's AC) a literal
  fact rather than an approximation.
- **`design.md` is deliberately reachable only through its outgoing `id-ref` edge, not through
  any link.** It exists to prove `impact requirements.md`'s reverse traversal picks up an
  id-ref-only reference; giving it an inbound link (e.g. from `guide.md`) would have pulled it
  into the `slice guide.md --depth 1` result and broken that test's exact file list instead. The
  side effect — `design.md` has in-degree 0, so GRP-002 flags it as a second orphan alongside
  `orphan.md` — is accepted rather than papered over: GRP-002's answer is correct (nothing does
  link to it), and the confirmation test asserts orphan.md's specific finding rather than an
  exclusive orphan set, so the extra warning doesn't weaken what's being locked down.
- **Determinism is checked two ways, not one.** Running `graph --format json` twice and
  requiring byte-identical stdout catches any accidental Map/Set-iteration-order dependency
  end-to-end; separately asserting the `nodes`/`edges` arrays already come back sorted locks in
  the ordering contract `graph-render.ts` documents, so a regression there fails at the CLI
  boundary and not just in a core-level unit test.

## Exit criteria

- [x] Graph algorithms + query layer + search index covered by unit tests.
- [x] e2e graph/slice/impact green; output deterministic.
- [x] Phase P4 [exit criteria](index.md) satisfied.

## Hand-off to next

P5 consumes the graph (`classifyNodes`/`analyzeGraph`/`extractDocProfile`) to synthesize the
project skill.
