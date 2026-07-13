# P7.03 · `context-graph`, `context-slice`, `impact-analysis` tools

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Expose the graph capabilities as MCP tools over the unified query layer, with honest slice
semantics.

## Sequence

- **Previous:** [P7.01 — Server foundation](01-server-foundation.md) + the graph/query layer
  ([P4.03](../P4-graph/03-query-layer.md), [P4.04](../P4-graph/04-search-index-slice.md),
  [P4.05](../P4-graph/05-impact-analysis.md)).
- **Next:** [P7.05 — Integration tests & docs](05-integration-tests-docs.md).
- **Depends on:** P7.01, P4 · **Parallel with:** P7.02, P7.04.

## Deliverables / steps

1. `context-graph` — `{ configPath?, cwd?, format?: "json"|"summary" }`: build graph → structured
   `{ nodes, edges, cycles }` (json — `ContextGraph` carries `cycles` for the G3 explicit-cycle
   signal) or, for the structured summary, `summarizeContextGraph` → `ContextGraphSummary`
   (`formatContextGraphSummary` supplies the accompanying text block).
2. `context-slice` — `{ query, depth?, configPath?, cwd? }`: call the composed `getContextSlice`
   (the deterministic index, [P4.04](../P4-graph/04-search-index-slice.md)) → structured
   `ContextSliceResult` `{ query, matchKind, starts, files, visited }`, plus a text summary via
   `renderContextSliceSummary`. (Field is `matchKind`/`SliceMatchKind`, not `matchType`; there is
   no `totalFiles`/`summary` field on the core type.) **Description states exact
   ID/anchor/heading/path resolution** — no keyword-search promise
   ([M2](../requirements/05-mcp-server.md); reuse the exported `SLICE_RESOLUTION_DESCRIPTION`).
3. `impact-analysis` — `{ file, configPath?, cwd? }`: validate file in corpus →
   `classifyImpact` → `relativizeImpact` (this is `relativizeImpact`'s first consumer — it had none
   before) → structured `ImpactClassification` `{ file, directlyAffected, transitivelyAffected,
   readingOrder, excluded }`, plus a text summary via `renderImpactSummary`. (Field is `file`, not
   `changedFile`; there is no `summary` field on the core type.) Out-of-corpus →
   `{ code, message, hint }` ([M6](../requirements/05-mcp-server.md)).
4. Structured output ([M1](../requirements/05-mcp-server.md)); read-only annotations
   ([M7](../requirements/05-mcp-server.md)).

## Decisions applied

- [M1, M2, M6, M7](../requirements/05-mcp-server.md) · reuses [G2](../requirements/03-context-graph.md)
  query layer + [G4](../requirements/03-context-graph.md) index.

## Exit criteria

- [x] All three tools return structured output matching the CLI contracts.
- [x] `context-slice` description is honest; out-of-corpus `impact` returns an actionable error.

## Implementation notes

- **`context-graph` uses one superset output schema for both `format` branches, not a discriminated
  union.** `registerTool` takes exactly one `outputSchema`, but `format: "json"` returns raw
  `ContextGraph` (`{ nodes, edges, cycles }`) and `format: "summary"` returns `ContextGraphSummary`
  (`{ nodes, edges, components, readingOrder }`). The schema keeps `nodes`/`edges` required and marks
  the format-specific fields (`cycles`, `components`, `readingOrder`) individually optional. A
  discriminated union was rejected: it would require echoing a `format` field that neither core type
  carries, widening the payload beyond the deliverable's shape. Adding that discriminant later is a
  one-line, low-risk follow-up if a reviewer wants it.
- **`format` defaults to `"json"`.** The raw graph is the more fundamental shape; `"summary"` is a
  derived convenience view. Not spec-mandated — a reversible one-line choice, flagged rather than
  left implicit.
- **`context-graph` deliberately omits G5 coverage.** The deliverable's return shape never mentions
  `computeGraphCoverage`, and computing it would require threading `rootDir`/`siteRouter` and a live
  disk re-scan beyond the loaded corpus — work a minimal read-only tool has no mandate to do by
  default. Left out entirely rather than pre-declaring an always-optional, unused `coverage` field.
- **`impact-analysis` calls `relativizeImpact(classification, "")` — an intentional identity
  transform.** This tool's `cwd` is both the corpus root the graph is built from *and* the base the
  classification's paths are already relative to, so "repo-relative cwd" is `""`. The call is still
  made (this tool is `relativizeImpact`'s first real consumer, per the deliverable), it just changes
  no path here — unlike CLI `compile`, which has a genuine `--cwd`/`--outdir` split.
- **`context-slice` rejects a negative `depth` at input validation.** The schema bounds `depth` to
  a non-negative integer (`z.number().int().min(0)`), mirroring the CLI's `--depth` parse guard. A
  negative hop bound is not a meaningful traversal request — left unbounded it would pass validation
  and silently degrade to a start-only slice — so it is refused at the wire (surfacing as an
  `INVALID_INPUT`-class error) rather than accepted and quietly misinterpreted.
- **`impact-analysis` needs no `RuleResolutionError`-style error translation.**
  `ImpactAnalysisError.code` is already `TARGET_NOT_FOUND`, a member of `TOOL_ERROR_CODES`, so
  `isStructuredError` recognizes it and `errorResult` passes it through verbatim. The `lint` tool's
  `ToolInputError` wrapper exists only because `RuleResolutionError`'s codes are a different enum;
  that translation is not needed (and not copied) here.

## Hand-off to next

P7.05 integration-tests these over stdio; P8's `-impact` skill prefers `impact-analysis`.
