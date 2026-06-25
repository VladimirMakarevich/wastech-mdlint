# P4.07 · CLI `graph` / `slice` / `impact` + Mermaid/DOT export

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Expose the graph capabilities as CLI subcommands on the commander program, with human/JSON
and diagram export.

## Sequence

- **Previous:** [P4.04 — Search index + slice](04-search-index-slice.md) and
  [P4.05 — Impact](05-impact-analysis.md).
- **Next:** [P4.08 — Graph tests](08-graph-tests.md).
- **Depends on:** P4.04, P4.05 · **Blocks:** P4.08.

## Deliverables / steps

1. `graph` — build + summarize (clusters, hubs, reading order, coverage signal); formats
   `human` | `json` | **`mermaid`** | **`dot`** ([G9](../requirements/03-context-graph.md)).
   JSON returns `{ nodes, edges, components, readingOrder }` (cwd-relative paths).
2. `slice <query> --depth N` — resolve via the index (P4.04), print relevant files
   (human/json); honest `--help` text ([G4](../requirements/03-context-graph.md)).
3. `impact <file>` — `classifyImpact` + lint of the affected subgraph; human/json
   (`{ changedFile, directlyAffected, transitivelyAffected, readingOrder, lint }`).
4. All three are thin hosts over core (the core-hosts-the-pipeline decision); reuse the shared `resolveConfig`/`loadContext`.

## Decisions applied

- [G9](../requirements/03-context-graph.md) export · [G4](../requirements/03-context-graph.md)
  honest slice · [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md).

## Exit criteria

- [ ] `graph` emits JSON + Mermaid + DOT; `slice`/`impact` match the core contracts.
- [ ] Commands delegate entirely to core (no duplicated logic).

## Hand-off to next

P4.08 validates these on a fixture repo; P7 mirrors `graph`/`slice`/`impact` as MCP tools with
structured output.
