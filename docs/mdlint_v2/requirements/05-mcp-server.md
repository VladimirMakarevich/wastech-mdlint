# v2 Requirements — 05 · MCP Server

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md) (Phase **P7**).
>
> The server stays a **thin stdio adapter over `@wastech-ctxlint/core`** (the
> [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md) decision). Locked v2
> requirement; authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Status | Notes |
| --- | --- | --- | --- |
| **M1** | Structured tool output (`structuredContent` + `outputSchema`) | ✅ Accepted | Typed objects for graph/slice/impact/lint + a human text summary. Schemas derive from core types. |
| **M2** | Honest tool descriptions (align with G4) | ✅ Accepted | `context-slice` described as exact ID/anchor/heading/path resolution — no "keyword search" over-promise. |
| **M3** | Modular server + shared config helper + docs-from-registration | ✅ Accepted | Split tools into modules; mirror CLI `shared.ts`; generate the tool list to kill the "5 vs 6" drift. |
| **M4** | Integration tests over `StdioServerTransport` | ✅ Accepted | Wire-level: registration + error shape, not just the computational layer. |
| **M5** | New `fix` (+ `schema`) MCP tools | 🔵 Backlog | Next version. v2 MCP stays at the 6 tools. |
| **M6** | Standard error contract (machine `code` + hint) | ✅ Accepted | Generalize the existing include-set hint; carry a code with structured output. |
| **M7** | Tool safety annotations (`readOnly` / `destructive`) | ✅ Accepted | All 6 tools `readOnlyHint`; future `fix` would be `destructiveHint`. |
| **M8** | Invariants: stdio-only + never load code-plugins | ✅ Accepted | No HTTP/SSE in v2; runs declarative custom rules (data) but never Tier-2 code-plugins ([R9](02-rules-engine.md)). |

## Detail & rationale

- **M1 — structured output.** The spec serializes JSON results into a text block, so
  clients must re-parse text. v2 returns `structuredContent` with an `outputSchema`
  (derived from core types) for `lint`, `lint-files`, `context-graph`, `context-slice`,
  `impact-analysis`, and keeps a short human-readable text summary alongside. More robust
  for hosts; fewer parse errors.

- **M2 — honest descriptions.** Both the graph spec and MCP spec flag that
  `context-slice`'s description ("ID, keyword, or file path") is wider than the
  implementation. With [G4](03-context-graph.md) it becomes a real deterministic
  ID/anchor/heading/path index, so the description states exactly that — no fuzzy/LLM
  promise.

- **M3 — modular + shared + generated docs.** The spec notes the whole server lives in one
  `index.ts` and duplicates config find/load that CLI already centralizes. v2 splits tools
  into modules, adds a shared `resolveConfig` / `loadContext` helper, and **generates the
  tool inventory from registration** so docs can't drift (the spec's "site docs say 5,
  code has 6"). Same single-source principle as [R6](02-rules-engine.md).

- **M4 — stdio integration tests.** The spec's tests cover the computational layer, not the
  wire protocol. v2 adds tests that boot the server over `StdioServerTransport` and assert
  tool registration + error shapes.

- **M6 — error contract.** Standardize error payloads as `{ code, message, hint }`,
  generalizing the existing "file not in include set → check include patterns" guidance.
  With M1, errors are structured and machine-recoverable.

- **M7 — safety annotations.** Declare MCP tool annotations so hosts/agents can reason about
  safety before calling: all 6 current tools are `readOnlyHint: true`. (A future `fix` tool
  would be `destructiveHint` / read-only in dry-run.) Important in agent contexts.

- **M8 — invariants.** Transport stays **stdio-only** in v2 (simplest secure default,
  matches the reference); no HTTP/SSE. The server executes **declarative custom rules**
  (pure data) but **never loads Tier-2 code-plugins** — an explicit security boundary from
  [R9](02-rules-engine.md), since the server runs inside an agent context.

## Deferred (backlog, next version)

- **M5 — `fix` / `schema` tools.** A `fix` tool (dry-run by default, returning proposed
  edits from core `--fix`/[R2](02-rules-engine.md); writes only behind an explicit flag)
  and a config-validation/`schema` tool. Deferred so v2 keeps the 6-tool surface and avoids
  shipping a mutating MCP tool before the `--fix` engine is proven in the CLI.

## Downstream impact

- **Core (P2–P5):** must expose typed result objects (M1) and a structured error type (M6);
  these are shared with the CLI.
- **CLI (P4–P6):** the `fix`/`schema` capabilities ship in the CLI first (R2, C9); MCP
  adopts them later (M5 backlog).
- **Docs/CI (P9):** tool inventory is generated (M3); integration tests run in CI (M4).
