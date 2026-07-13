# Phase P7 — MCP server

> Roadmap: [v2 Index](../index.md) · Phase **P7** · Size **M** · Status **Done** ·
> Depends on [P2](../index.md), [P4](../index.md), [P5](../index.md).
>
> **Goal:** fill the [P0.06 stub](../P0-foundations/06-mcp-server-skeleton.md) with the 6
> deterministic MCP tools — a **thin stdio adapter over `@wastech-mdlint/core`** with
> **structured output**, honest descriptions, and safety annotations.

## Why this phase exists

Agents need the same deterministic operations the CLI has, over MCP. v2 applies the
[MCP requirements](../requirements/05-mcp-server.md): structured output
([M1](../requirements/05-mcp-server.md)), honest descriptions
([M2](../requirements/05-mcp-server.md)), modular server + shared helper + generated tool
docs ([M3](../requirements/05-mcp-server.md)), stdio integration tests
([M4](../requirements/05-mcp-server.md)), an error contract
([M6](../requirements/05-mcp-server.md)), safety annotations
([M7](../requirements/05-mcp-server.md)), and the stdio-only / no-code-plugins invariant
([M8](../requirements/05-mcp-server.md)). The `fix`/`schema` tools are
[M5 backlog](../requirements/05-mcp-server.md) — v2 ships **6 tools**. See the
[MCP requirements](../requirements/05-mcp-server.md).

## Tasks

| # | Task | Tools | Depends on |
| --- | --- | --- | --- |
| [P7.01](01-server-foundation.md) | Server foundation: modular layout, shared helper, conventions | — | P2/P4 done (P5 → P7.04 only) |
| [P7.02](02-lint-tools.md) | `lint`, `lint-files` | 2 | P7.01 |
| [P7.03](03-graph-tools.md) | `context-graph`, `context-slice`, `impact-analysis` | 3 | P7.01 |
| [P7.04](04-compile-tool.md) | `compile-context` | 1 | P7.01 |
| [P7.05](05-integration-tests-docs.md) | Stdio integration tests + generated tool docs + README | — | P7.02–P7.04 |

## Sequence

```
(P2/P4/P5) ─► P7.01 ─┬─► P7.02 ─┐
                     ├─► P7.03 ─┼─► P7.05 ─► (Phase P8)
                     └─► P7.04 ─┘
```

## Decisions applied

- [M1–M4, M6, M7, M8](../requirements/05-mcp-server.md) · [M5 backlog](../requirements/05-mcp-server.md) ·
  [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md) thin host.

## Phase exit criteria

- [x] 6 tools registered, each a thin wrapper over core. Five carry **structured output** + a text
      summary; `compile-context` is the M1-scoped exception, returning two plain-text content blocks
      (skill content + a `Documents/Rules/Components` line). See [P7.04](04-compile-tool.md).
- [x] `context-slice` description matches the real deterministic index (G4/[M2](../requirements/05-mcp-server.md)).
- [x] Shared config/context helper; tool inventory **generated** (no 5-vs-6 drift, M3).
- [x] Error contract `{ code, message, hint }` (M6, carried in `structuredContent`; each
      schema-carrying tool keeps its success fields required in `outputSchema` and satisfies the
      wire validator on errors by attaching schema-compatible empty/default success fields plus the
      optional error metadata — see [P7.05](05-integration-tests-docs.md)); read-only safety
      annotations (M7).
- [x] stdio-only; declarative custom rules run, code-plugins never load (M8).
- [x] stdio integration tests green (M4).

## What P7 unblocks

- **P8** — skills reference the MCP tools (e.g. `-impact` prefers `impact-analysis`).
- **P9** — the package ships with its README + host-config snippet.
