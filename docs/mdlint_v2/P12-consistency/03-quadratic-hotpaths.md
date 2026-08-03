# P12.03 · Quadratic hot paths in compile / text-position

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Audit finding **L-5** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

Remove the two documented super-linear hot paths, or record an explicit corpus-size assumption so the cost is a known trade-off rather than a latent surprise.

## Problem (from the audit)

- **`compile/doc-profile.ts:93`** calls `classifyNodes(graph, options)` for **every** document, then `:122-127` filters `graph.edges` twice — `O(N²) + O(N·E)` for `compileContext`. `classifyNodes` over the whole graph is independent of the current document, so it is recomputed N times.
- **`engine/text-position.ts:5-16`** `findLineNumber` scans from offset zero on every call, and is called **once per match** — so anchoring M matches in a document is `O(M · L)`.

Neither is a correctness bug; both are avoidable cost that grows with corpus/document size.

## Deliverables / steps

1. **`doc-profile.ts`:** hoist the document-independent `classifyNodes(graph, options)` out of the per-document loop (compute once, reuse), and avoid the double `graph.edges` filter (single pass / pre-indexed lookup) at `:122-127`.
2. **`text-position.ts`:** make line-number resolution incremental or precompute a line-start index for a document once, so anchoring M matches is `O(M + L)` rather than `O(M · L)`. Keep the public result identical (same `line`/`column` outputs).
3. Add a focused test that the refactor preserves byte-identical positions/profiles on an existing fixture (this is a performance change, not a behavior change), and — if any hot path is judged not worth changing — document the corpus-size assumption next to it instead.

## Out of scope

Broad performance work or a benchmark harness. Incremental/cached graph rebuilds remain a backlog item (G8). This task addresses only the two cited hot paths.

## Exit criteria

- [x] `classifyNodes` is computed once per compile, not once per document; the double edge-filter is gone.
- [x] `findLineNumber` no longer rescans from zero per match (or the assumption is documented).
- [x] A test proves positions/profiles are unchanged by the refactor.
- [x] `npm run typecheck && npm test && npm run build` green.

## Implementation notes

- **`createLineNumberLookup` uses a binary search, not a forward cursor.** An incremental cursor is the cheaper shape only if offsets arrive in ascending order, and CTX-003's do not: `ctx.ts` restarts `matchAll` at offset zero for _each_ glossary alias against the same `text`, so alias #2's first match can sit before alias #1's last. A forward-only cursor would silently misplace those lines. The lookup indexes line starts in one O(L) pass and answers each query in O(log L) — O(L + M·log L) overall, which is the practical intent of the task's "O(M + L)".
- **`findLineNumber` was kept, not replaced.** It stays the one-shot form (allocates nothing, stops at `index`) and stays exported from the barrel with its remaining caller. Its doc comment now says what the two implementations are for, so a future per-match caller is pointed at the lookup instead of reintroducing the hot path.
- **Equivalence is pinned at every offset, not on sampled points.** `rule-utils.test.ts` asserts `findLineNumber` _and_ `createLineNumberLookup` against a naive reference written as `content.slice(0, clamped).split("\n").length` — deliberately a different formulation from either implementation, so agreement means the semantics match rather than one loop being restated three times. Sweep covers offsets `-2 … length + 2` (the clamped out-of-range contract) over LF, CRLF, empty, trailing-newline, blank-run, and leading-newline fixtures.
- **Three per-match call sites converted; one left alone deliberately.** `primitives/content.ts` (`contentNotMatch`) and `graph/build-context-graph.ts` (`buildIdRefEdges`) hoist one lookup per document; `engine/rules/ctx.ts` (CTX-003) builds it **inside** the `scanTargets` loop, because `text` is either the whole content or one `extractSectionBody` result — a lookup hoisted one level further would resolve offsets against the wrong string. `markdown/parse-document.ts:243` keeps `findLineNumber`: it is one call per _import match_ inside a single small `text` node, so indexing would allocate a line array for every text node in every document when almost none contain imports. That is not one of the two cited hot paths.
- **`extractDocProfiles` is the batch entry point; `extractDocProfile` is unchanged API.** Both build profiles through one shared `buildProfile` + `indexGraph` pair, so the single-document and corpus paths cannot drift. `indexGraph` _caches_ `classifyNodes` into a `Map` — P5.01 remains the sole owner of role semantics, the classifier is not forked — and partitions `graph.edges` into outgoing/incoming buckets in one pass, appending in `graph.edges` order so the existing deterministic edge order survives. A self-edge lands in both buckets, exactly as the two independent `filter` passes did; `buildContextGraph` never emits one, but `extractDocProfile` accepts hand-built graphs, so a test pins it. Every profile gets fresh arrays via `.map(copyEdge)` — the buckets are shared across a batch, so handing one out directly would alias edge lists between profiles.
- **`extractDocProfile` delegates via the shared helpers rather than through `extractDocProfiles([document], …)`.** Round-tripping a single document through the Map would need a `!` or a dead `undefined` branch to satisfy `strict`; calling `buildProfile` directly gives the same single-implementation guarantee with no assertion. Single-shot cost is unchanged: one classifier pass and one edge pass either way.
- **`compileContext` sorts the documents it batches** (`compareStrings` on `document.path`) so the returned Map's insertion order matches `documentPaths` and the render order. `synthesize` only ever does `profiles.get(path)` — it never iterates — so Map order is not user-visible either way, but sorting keeps a future iterator from inheriting filesystem order. This also drops the previous `documents.get(documentPath)!`.
- **Known assumption: `documents` is keyed by `document.path`.** The batch is built from `documents.values()`, so `extractDocProfiles` keys its result by `document.path`, while `synthesize` still looks profiles up by the `documents` map key. The two agree because `loadContext` re-keys the map by `document.path` ([`graph/load-context.ts`](../../../packages/core/src/graph/load-context.ts)) — but that coupling is now load-bearing rather than incidental: a future caller handing `compileContext` a map keyed differently (absolute paths, say) would make every `profiles.get(...)` miss silently instead of failing loudly. Left as-is rather than re-deriving the batch from the sorted keys, because the alternative reintroduces a non-null assertion for a case that cannot happen today; recorded here so the assumption is a known trade-off, which is the point of this task.
- **No barrel export and no glossary change.** `extractDocProfiles`, `createLineNumberLookup`, and `LineNumberLookup` are all core-internal (`packages/core/src/index.ts` is untouched); tests import them from the module path, as `compile-doc-profile.test.ts` already did. The glossary documents `extractDocProfile` / `DocumentProfile` — whose shape and semantics are unchanged — and has no `findLineNumber` entry, so there is no load-bearing public term to add, rename, or retire.
- **Byte-identity guards.** `compile-doc-profile.test.ts` now holds the pinned `consumer.md` profile literal in one shared const asserted by _both_ the single and batch paths: because the two paths share `buildProfile`, asserting batch-equals-single alone would not catch a shared bug. `compile-context.test.ts:71-104` (which already asserts `compile.hubMinInDegree` reaching the rendered role table) covers the end-to-end regression risk of hoisting `classifyNodes`, so no new e2e fixture was needed. No `packages/cli/test/fixtures/` addition either — nothing user-visible changes. Full suite: 835 passed / 6 skipped, plus `typecheck`, `build`, `lint`, and `format`.
