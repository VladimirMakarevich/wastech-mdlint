# P12.03 · Quadratic hot paths in compile / text-position

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Audit finding **L-5** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

Remove the two documented super-linear hot paths, or record an explicit corpus-size assumption so the
cost is a known trade-off rather than a latent surprise.

## Problem (from the audit)

- **`compile/doc-profile.ts:93`** calls `classifyNodes(graph, options)` for **every** document, then
  `:122-127` filters `graph.edges` twice — `O(N²) + O(N·E)` for `compileContext`. `classifyNodes`
  over the whole graph is independent of the current document, so it is recomputed N times.
- **`engine/text-position.ts:5-16`** `findLineNumber` scans from offset zero on every call, and is
  called **once per match** — so anchoring M matches in a document is `O(M · L)`.

Neither is a correctness bug; both are avoidable cost that grows with corpus/document size.

## Deliverables / steps

1. **`doc-profile.ts`:** hoist the document-independent `classifyNodes(graph, options)` out of the
   per-document loop (compute once, reuse), and avoid the double `graph.edges` filter (single pass /
   pre-indexed lookup) at `:122-127`.
2. **`text-position.ts`:** make line-number resolution incremental or precompute a line-start index for
   a document once, so anchoring M matches is `O(M + L)` rather than `O(M · L)`. Keep the public
   result identical (same `line`/`column` outputs).
3. Add a focused test that the refactor preserves byte-identical positions/profiles on an existing
   fixture (this is a performance change, not a behavior change), and — if any hot path is judged not
   worth changing — document the corpus-size assumption next to it instead.

## Out of scope

Broad performance work or a benchmark harness. Incremental/cached graph rebuilds remain a backlog item
(G8). This task addresses only the two cited hot paths.

## Exit criteria

- [ ] `classifyNodes` is computed once per compile, not once per document; the double edge-filter is gone.
- [ ] `findLineNumber` no longer rescans from zero per match (or the assumption is documented).
- [ ] A test proves positions/profiles are unchanged by the refactor.
- [ ] `npm run typecheck && npm test && npm run build` green.
