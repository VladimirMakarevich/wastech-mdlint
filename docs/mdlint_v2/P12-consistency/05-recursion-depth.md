# P12.05 · Recursive DFS depth — document the bound or guard it

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Finding **SC-3** (Low, needs confirmation) from the `p9-09` deep audit, whose report was removed from the tree in `d96b64c`. Neither surviving audit restates it, so the Problem section below is its record.

## Goal

Either document the practical corpus-size assumption the recursive graph/import traversals rely on, or make the hottest one iterative so a pathologically deep chain surfaces as a structured result rather than an opaque stack overflow.

## Problem (from the audit)

Four traversals recurse with no explicit depth guard:

- `strongConnect` (`packages/core/src/graph/build-context-graph.ts:282`)
- `walk` (`packages/core/src/graph/build-context-graph.ts:343`)
- eager-import `visit` (`packages/core/src/engine/rules/llm.ts:66`, self-call `:112`)
- rule-inference cycle sampler `visit` (`packages/core/src/discovery/rule-inference.ts:284`)

v2 rebuilds the graph non-incrementally and states no corpus-size bound. A single component of many thousands of documents could exceed the Node call stack, and an uncaught `RangeError: Maximum call stack size exceeded` would surface as an opaque crash rather than a structured diagnostic. Almost certainly fine for realistic repos — hence _needs confirmation_.

## Deliverables / steps

1. Decide whether very large corpora (single components in the thousands) are in scope for v2.
2. **If not:** document the practical corpus-size assumption next to each recursion site (a short why-comment) and in the relevant requirement/glossary note, so the limitation is stated plainly (per the roadmap's "honesty in docs" principle) rather than latent.
3. **If yes:** convert the hottest traversal (`strongConnect`) to an explicit worklist stack, and ensure a depth/stack overflow is caught and reported as a structured diagnostic rather than an uncaught `RangeError`.
4. If practical, add a test with a deep synthetic chain asserting a structured outcome (either correct handling or a clear diagnostic), not a raw crash.

## Out of scope

Rewriting all four traversals unless (3) is chosen; only `strongConnect` is the hottest candidate. Incremental graph rebuilds (backlog G8).

## Exit criteria

- [x] The corpus-size assumption is either documented at each recursion site (and in docs) or removed by making `strongConnect` iterative.
- [x] N/A — "A deep chain produces a structured outcome, not an uncaught `RangeError`" was conditional on the guard path, which was not chosen. Past the documented bound the run still raises an uncaught `RangeError`; see below.
- [x] `npm run typecheck && npm test && npm run build` green.

## Implementation notes

- **Direction: document the bound (step 2), not the iterative rewrite (step 3).** Two reasons beyond this phase being scoped test-and-docs-only. First, an iterative `strongConnect` would not remove the assumption: `cyclePath`'s `walk` recurses to SCC size and the eager-import `visit` recurses to the size of one entrypoint's transitive import set, so the same note gets written anyway while taking on real Tarjan-regression risk. Second, "report a structured diagnostic instead of `RangeError`" has nowhere to go — `ContextGraph` (`packages/core/src/graph/context-graph-types.ts`) has no diagnostics channel, so that half of step 3 is a public-contract change well outside an S task.
- **What the bound actually is.** `strongConnect`'s stack depth is the longest _simple DFS path inside one connected component_, bounded by that component's node count — not by the length of an authored chain. A densely cross-linked component descends about as deep as a linear chain of the same size, so the honest assumption is the audit's: no single connected component of many thousands of documents. The accurate half of "corpus size is not the limit" is kept — the root loop restarts at each unvisited node, so many small components unwind the stack between them regardless of total corpus size. `cyclePath`'s `walk` is the same shape one level down: bounded by SCC size, not by cycle length.
- **Measured before documenting.** A throwaway probe built an N-deep linear chain of `ParsedDocument`s — the simplest shape that reaches full depth, so the figures below are an order of magnitude for the general case, not a threshold — called `buildContextGraph`, and bisected N for `RangeError`:
  - Cold Node 24 main thread: overflow at **~4,800 nodes** (deepest OK ~4,750), for both the acyclic chain (`strongConnect` only) and the chain closed by a back edge (which also drives `walk`).
  - The same probe under Vitest: overflow at ~6,500.
  - The acyclic/cyclic asymmetry seen on a first pass (~4,750 vs ~9,600) is a **JIT-warmup artifact**, not a structural difference — reversing the order moved the low number to the cyclic case. Whichever traversal runs cold overflows first, so ~4,750 is the honest order-independent floor and is the number quoted in the docs.
  - Overflow is a genuine `RangeError`, not some other failure mode.
- **Pinned depth: 1,000** (`packages/core/test/build-context-graph.test.ts`), a ~4.75x margin under the cold floor so the test cannot sit near the cliff on a different platform or JIT state. Both graphs build in well under a second, so no `testTimeout` override is needed. No test asserts a crash at some larger depth — the exact limit is stack-size dependent and would be flaky.
- **Two recursions the audit did not list are excluded deliberately:** the directory walks in `packages/core/src/discovery/repo-scan.ts` and `packages/core/src/discovery/workspace-packages.ts`. Their depth is filesystem nesting, which the OS bounds far below the call stack, so they carry no corpus-size assumption to document.
- **`rule-inference.ts` already discharged its own site**; its comment was sharpened to name _stack depth_ explicitly (its DFS only ever walks sampled files) so the audit item is visibly closed rather than looking unaddressed.
- **Docs state the bound in the reader's terms:** no single connected component of many thousands of documents, with the measured chain figure given as an order of magnitude and the "many small components are fine" carve-out kept. Recorded in `docs/guide/context-graph.md` (`## Limitations`), `README.md` (`## Limitations`), the `Cycle / SCC` glossary entry, G6 in [requirements/03-context-graph.md](../requirements/03-context-graph.md), and LLM-001's `## Notes` for the eager-import case.
