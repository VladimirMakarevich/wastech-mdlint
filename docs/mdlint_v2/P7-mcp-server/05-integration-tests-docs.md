# P7.05 · Stdio integration tests + generated tool docs + README

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Prove the server works at the wire level and ship its docs from a single source.

## Sequence

- **Previous:** the 6 tools ([P7.02](02-lint-tools.md), [P7.03](03-graph-tools.md),
  [P7.04](04-compile-tool.md)).
- **Next:** **Phase P8 — Static skills** (see [roadmap](../index.md)).
- **Depends on:** P7.02–P7.04 · **Blocks:** confident skill references in P8.

## Deliverables / steps

1. **Integration tests over `StdioServerTransport`** ([M4](../requirements/05-mcp-server.md)):
   boot the server, list tools, call each tool, assert registration + structured results +
   error shapes — not just the core computational layer.
2. **Generated tool docs** ([M3](../requirements/05-mcp-server.md)): the README tool inventory
   is generated from registration so it can't drift (no "5 vs 6" mismatch).
3. README + host-config snippet (`npx @wastech-mdlint/mcp-server`) for common MCP hosts.
4. Confirm the 6-tool surface (no `fix`/`schema` — [M5 backlog](../requirements/05-mcp-server.md)).

## Decisions applied

- [M3, M4](../requirements/05-mcp-server.md) · [M5 backlog](../requirements/05-mcp-server.md).

## Exit criteria

- [x] stdio integration tests cover all 6 tools (success + error).
- [x] README tool list generated; host-config snippet documented.
- [x] Phase P7 [exit criteria](index.md) satisfied.

## Implementation notes

- **Real subprocess over `InMemoryTransport`.** `test/stdio-integration.test.ts` spawns a real
  `node dist/index.js` child via `StdioClientTransport` (client counterpart to the server's
  `StdioServerTransport`), one persistent connection for the whole file. This is the only suite
  that crosses a process boundary; `smoke.test.ts` and the six `handle*.test.ts` files stay as the
  in-memory/in-process layers this builds on. `process.execPath` (not the literal `"node"`) is used
  for cross-platform spawning without depending on PATH.
- **New implicit precondition.** The wire suite requires `packages/mcp-server`'s *own* `dist` to be
  built (previously only `core`'s dist was needed before mcp-server tests). True under the
  documented order (`npm run typecheck` == `tsc -b`, which emits before `npm test`); called out in
  an inline comment so a "failed to spawn" surprise resolves fast.
- **Generated tool inventory.** `src/tool-docs.ts` renders the README table by introspecting the
  *live* registered tools (`createServer()` + `InMemoryTransport` + `listTools()`), never a
  hand-maintained name list — closing the "5 vs 6" drift M3 targets. Registration order is
  preserved deliberately (groups by family; still deterministic from a fixed array), and cell text
  is `|`/newline-escaped against future descriptions. `scripts/generate-docs.mjs` imports it by
  relative path into the built dist rather than adding a package `exports` entry, keeping
  mcp-server's npm surface bin-only. `test/docs-sync.test.ts` mirrors core's sync-test pattern.
- **M6 error payload stays in `structuredContent`; success schemas stay strict.** The wire suite
  exposed that the five tools with an `outputSchema` could not deliver their `{ code, message, hint }`
  error as `structuredContent` unchanged: a spec-compliant host caches an output validator from
  `listTools()` and the SDK client validates any present `structuredContent` against that schema
  *including on `isError` results*, so an error payload that didn't match the success schema made
  `callTool` reject instead of return. (The SDK *server* skips this validation on error — which is
  why the in-process `handle*.test.ts` never saw it — but a real stdio *client* does not.) The fix
  keeps the payload in `structuredContent` as the public machine result (per M1's "carry a code with
  structured output") without weakening the advertised success contract: `withErrorOutput` adds only
  the optional `code`/`message`/`hint` metadata to the existing success schema, and each error path
  supplies schema-compatible empty/default success fields alongside that metadata. A Zod union /
  `oneOf` can't express this because the pinned SDK (1.29) only advertises *object* schemas and
  silently drops a union — verified — which would erase M1's structured output entirely. `compile-context`
  has no `outputSchema`, so it returns its structured error directly with no placeholder fields.

## Hand-off to next

P8 authors skills that call these tools (and the CLI); the agent surface is now complete and
tested.
