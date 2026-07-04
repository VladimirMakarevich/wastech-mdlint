# P4.01 · `ContextGraph` model + `buildContextGraph` (semantic edges)

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Build the first-class `ContextGraph` with **semantic edges** and **edge metadata**, extending
the current implementation graph builder.

## Sequence

- **Previous:** [P3.09 — Rule tests & cutover](../P3-rules/09-rule-tests-and-cutover.md)
  completed the rule engine; the current implementation graph build is already in `core`.
- **Next:** [P4.02 — Graph algorithms](02-graph-algorithms.md).
- **Depends on:** P3 done + `ParsedDocument` references/anchors/imports (P1) · **Blocks:** all of P4.

## Inputs (from previous work)

- current `graph/build.ts` (in core), `ParsedDocument.{links,images,imports}` + heading slugs (P1).

## Deliverables / steps

1. `GraphNode { filePath, inDegree, outDegree }`;
   `GraphEdge { source, target, type: "link"|"image"|"anchor"|"id-ref"|"import", line, text?, rawTarget? }`
   ([G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md)).
2. `buildContextGraph(documents, { exclude?, entryPoints?, siteRouter?, idRef? })`
   ([R5](../requirements/02-rules-engine.md)): resolve relative links/images; materialize
   **anchor** edges (heading-slug match), **import** edges (`@path.md`), and **id-ref** edges.
   **id-ref discovery is column-based (decided 2026-07-02, audit 5.5):** defined IDs come from
   the declared `definitions`/`idColumn` columns (+ headings), the **same model as REF-005** —
   `idPattern` validates the token *within* those cells, it does not scan arbitrary cells. The
   graph therefore receives `idRef: { idPattern, definitions, idColumn }` (from REF-005-style
   config); with no such config, no id-ref edges are built. Resolve defined IDs via the shared
   `extractDefinedIds(doc, idRef)` helper over the parsed `tables`/`headings` (audit 2.1) — no
   re-parse; `ParsedDocument` has no `ids` field.
3. **One edge per source construct**, typed per the taxonomy in
   [requirements/03](../requirements/03-context-graph.md) (audit 2.5): a `#fragment` makes it
   `anchor`, otherwise `link`; `image`/`import`/`id-ref` by their own construct. Skip
   self-refs (incl. same-file `#frag` anchors) and missing targets; keep deterministic sorting
   of nodes/edges.
4. (Edge de-dup with `count` is [G7 backlog](../requirements/03-context-graph.md) — keep
   reference multiplicity for now.)

## Decisions applied

- [G1](../requirements/03-context-graph.md), [G3](../requirements/03-context-graph.md),
  [R5](../requirements/02-rules-engine.md) routing/exclude inputs.

## Implementation notes

Two spec-vs-code contradictions surfaced during implementation; both were resolved toward the
existing frozen contract rather than the (predates-P2.01) spec wording, per the [AGENTS.md
precedence rule](../../../AGENTS.md):

- **Read shape stays frozen.** `GraphNode { filePath }` / `GraphEdge { source, target }` above is
  the original spec wording; the actual (P2.01-frozen) types are `ContextGraphNode.path` and
  `ContextGraphEdge.{from,to}`. GRP-001/002, the CLI `graph` command, and every existing test read
  those field names, so this task extends them in place rather than renaming — a rename would be a
  purely cosmetic cascading change for zero functional gain.
- **id-ref reference discovery is a prose token scan, not a second column.** Definitions come from
  `extractDefinedIds` (column cells + heading tokens matching `idPattern` — audit 5.5's "+
  headings" widening, applied post-review; see below), but `idRef` has no "references" column to
  mirror it — id-ref edges instead come from scanning each document's raw text for tokens equal to
  an ID defined *elsewhere*. This is the literal reading of G1's own example ("`REQ-001`
  referenced in prose with no Markdown link") and keeps the definer side honest without inventing
  config that doesn't exist yet.

**Review fixes applied after initial implementation:**

- **Anchor edges validate the target's heading slugs.** A `#fragment` link whose target file
  resolves but whose fragment matches no heading slug in that target is now skipped entirely
  (never emitted, never downgraded to a plain `link` edge) — the literal AC reading of "anchor =
  heading-slug match." Reuses the same `heading.slug` comparison REF-002 already does.
- **`extractDefinedIds` now includes heading tokens, not just `idColumn` cells.** The spec's
  "(+ headings)" wording was initially left unimplemented with a deferred-to-P4.04 comment; on
  review that deferral wasn't backed by a decision doc, and the task AC explicitly listed
  headings as in-scope, so it was implemented here instead. REF-005's definition lookup and the
  graph's id-ref edges both now go through the same widened helper.
- **Node identity is derived from `document.path`, not the input `Map`'s keys.** `buildContextGraph`
  re-keys its input by `document.path` internally before building nodes, so node identity always
  matches edge endpoint identity regardless of how the caller keyed its documents map (e.g.
  `loadDocuments()`'s absolute-path keys, fed in directly with no re-keying).

`exclude`/`entryPoints` are accepted on `BuildContextGraphOptions` for forward compatibility but
are not yet read by `buildContextGraph` — deriving them from config and using them for
coverage/orphan reasoning is [P4.06](06-grp-refactor-coverage.md) scope, not this task. Only
`siteRouter` is wired through today, from `lintFiles` and the CLI `graph` command, so link/anchor/
image/import edges already resolve root-relative targets identically to REF-001/002 on router
repos.

## Exit criteria

- [x] Edges carry type + line (+ text); anchor/import/id-ref edges materialized.
- [x] `buildContextGraph` accepts exclude/entryPoints/siteRouter (typed options; exclude/
      entryPoints are not yet consumed — see Implementation notes).
- [x] Deterministic node/edge ordering.

## Hand-off to next

P4.02 runs algorithms over this graph; P4.06 lets GRP rules consume it instead of building
their own.
