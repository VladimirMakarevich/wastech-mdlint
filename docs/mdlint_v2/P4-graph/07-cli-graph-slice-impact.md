# P4.07 · CLI `graph` / `slice` / `impact` + Mermaid/DOT export

> Phase: [P4 — Graph](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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

## Implementation notes

- **`loadContext` and the render module are new core surface, not CLI logic.** The CLI handlers
  are ~10-line dispatchers: `loadConfiguration` → `loadContext` → one core call
  (`summarizeContextGraph`/`getContextSlice`/`classifyImpact`) → one renderer or `JSON.stringify`.
  `loadContext` centralizes the doc-load + graph-build sequence that `lint-files.ts` already runs
  internally; it does not refactor `lint-files.ts` itself (out of scope — that file already builds
  its own graph correctly and touching it risked an unrelated regression for no behavior change).
- **`impact`'s `lint` field still lints the full corpus, then filters host-side.** Scoping
  `lintFiles` itself to the affected files would starve project-scope rules (`GRP-001` cycles,
  `GRP-002` incoming-reference counts) of the rest of the graph and silently change their answers.
  Instead the CLI injects the one graph it already built into `lintFiles({ graph })` (no second
  build) and only narrows the _returned_ `messages`/`files` (recomputing counts) to the changed
  file plus its directly/transitively affected set. This is presentation, not a second pipeline —
  the core-hosts-the-pipeline invariant is preserved because no traversal or rule logic is
  duplicated in the host.
- **Mermaid/DOT node ids are a sorted-path index (`n0`, `n1`, …), never a sanitized path.**
  Turning `"a/b.md"` and `"a-b.md"` into ids by replacing `/` with `-` would collide two distinct
  files into one diagram node. The path stays the label; the id only has to be unique and
  syntax-legal, which an index trivially guarantees, at the cost of ids that aren't
  human-recognizable on their own (acceptable — the label already carries that job).
- **`slice`/`impact` take no `[path]` argument; `graph` does.** The acceptance criteria specify
  `slice <query>` and `impact <file>` with no directory argument, so both always resolve against
  the invocation `cwd`. This is a deliberate asymmetry with `graph [path]`, not an oversight — a
  future task can add an optional `[path]` to `slice`/`impact` if directory-scoped analysis is
  ever needed, mirroring `graph`.
- **An unresolved `slice` query and a clean `impact` lint both exit `0`.** Per
  [G4](../requirements/03-context-graph.md)'s honesty requirement, "no match" is a legitimate
  answer (`matchKind: null`), not a usage error — only a malformed option or an `impact` file
  outside the corpus (`ImpactAnalysisError`, re-thrown as `CliUsageError`) exits `2`.

## Exit criteria

- [x] `graph` emits JSON + Mermaid + DOT; `slice`/`impact` match the core contracts.
- [x] Commands delegate entirely to core (no duplicated logic).

## Hand-off to next

P4.08 validates these on a fixture repo; P7 mirrors `graph`/`slice`/`impact` as MCP tools with
structured output.
