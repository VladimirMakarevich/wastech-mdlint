# P12.05 · Recursive DFS depth — document the bound or guard it

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Finding **SC-3**
> ([`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md), Low, needs
> confirmation).

## Goal

Either document the practical corpus-size assumption the recursive graph/import traversals rely on, or
make the hottest one iterative so a pathologically deep chain surfaces as a structured result rather
than an opaque stack overflow.

## Problem (from the audit)

Four traversals recurse with no explicit depth guard:

- `strongConnect` (`packages/core/src/graph/build-context-graph.ts:282`)
- `walk` (`packages/core/src/graph/build-context-graph.ts:343`)
- eager-import `visit` (`packages/core/src/engine/rules/llm.ts:66`, self-call `:112`)
- rule-inference cycle sampler `visit` (`packages/core/src/discovery/rule-inference.ts:284`)

v2 rebuilds the graph non-incrementally and states no corpus-size bound. A single component of many
thousands of documents could exceed the Node call stack, and an uncaught
`RangeError: Maximum call stack size exceeded` would surface as an opaque crash rather than a
structured diagnostic. Almost certainly fine for realistic repos — hence _needs confirmation_.

## Deliverables / steps

1. Decide whether very large corpora (single components in the thousands) are in scope for v2.
2. **If not:** document the practical corpus-size assumption next to each recursion site (a short
   why-comment) and in the relevant requirement/glossary note, so the limitation is stated plainly
   (per the roadmap's "honesty in docs" principle) rather than latent.
3. **If yes:** convert the hottest traversal (`strongConnect`) to an explicit worklist stack, and
   ensure a depth/stack overflow is caught and reported as a structured diagnostic rather than an
   uncaught `RangeError`.
4. If practical, add a test with a deep synthetic chain asserting a structured outcome (either correct
   handling or a clear diagnostic), not a raw crash.

## Out of scope

Rewriting all four traversals unless (3) is chosen; only `strongConnect` is the hottest candidate.
Incremental graph rebuilds (backlog G8).

## Exit criteria

- [ ] The corpus-size assumption is either documented at each recursion site (and in docs) or removed
      by making `strongConnect` iterative.
- [ ] A deep chain produces a structured outcome, not an uncaught `RangeError` (if the guard path is chosen).
- [ ] `npm run typecheck && npm test && npm run build` green.
