# P7.01 · Server foundation — modular layout, shared helper, conventions

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Grow the existing stub into a maintainable server shell: modular tool layout, a shared
config/context helper, and the output/error/annotation conventions every tool follows.

> **Extend, don't rebuild.** `packages/mcp-server/src/index.ts` already ships `createServer()`,
> `startServer()`, `StdioServerTransport`, `readPackageVersion()`, the stderr readiness line, and
> the import/entrypoint guard (which the P7.05 in-memory tests rely on, like `smoke.test.ts`).
> P7.01 adds only the tool-module layout, the shared config/context helper, and the
> output/error/annotation wrappers — it must preserve those existing pieces.

## Sequence

- **Previous:** [P0.06 — mcp-server skeleton](../P0-foundations/06-mcp-server-skeleton.md)
  (the shipped stub) and the completed core engine/graph (P2/P4). The `compile-context` tool alone
  also needs the P5 compiler — see [P7.04](04-compile-tool.md).
- **Next:** [P7.02](02-lint-tools.md), [P7.03](03-graph-tools.md), [P7.04](04-compile-tool.md).
- **Depends on:** P2/P4 done (P5 only for [P7.04](04-compile-tool.md)) · **Blocks:** all tool tasks.

## Deliverables / steps

1. **Modular layout** ([M3](../requirements/05-mcp-server.md)): one module per tool, registered
   from an index; no single mega-file.
2. **Shared helper** wrapping the exact core calls the CLI's `commands.ts` already uses (there is
   no CLI `shared.ts` to mirror): `loadConfiguration({ cwd, explicitConfigPath })` — which resolves
   via `findConfig` internally — then `loadContext({ cwd, config, settings })`. Map the tool inputs
   `cwd?` / `configPath?` onto core's `cwd` / `explicitConfigPath`. Used by all file-based tools.
3. **Conventions:** register each tool with `server.registerTool(name, { inputSchema, outputSchema,
   annotations }, cb)` — the deprecated `tool()` overloads in `@modelcontextprotocol/sdk` don't
   carry `outputSchema`. Follow a `structuredContent` + `outputSchema` pattern
   ([M1](../requirements/05-mcp-server.md)) plus a text summary; an error contract
   `{ code, message, hint }` with `isError: true` ([M6](../requirements/05-mcp-server.md));
   tool annotations (`readOnlyHint: true`, etc., [M7](../requirements/05-mcp-server.md)).
   - **Error code taxonomy (decided 2026-07-02, audit — P7 error-taxonomy gap).** A closed set,
     defined **once in core** (the M6 structured error type) and shared by CLI + MCP:
     - `CONFIG_NOT_FOUND` — no config resolved at `configPath`/`cwd`.
     - `CONFIG_INVALID` — config failed JSONC/schema validation (`hint` = failing path, C7).
     - `FILE_NOT_IN_CORPUS` — requested file/path outside the resolved `include` set (`hint` =
       check include patterns).
     - `TARGET_NOT_FOUND` — a `slice`/`impact` query or file argument resolved to nothing.
     - `COMPILE_CONFIG_MISSING` — `config.compile` absent for `compile-context` (audit 4.4).
     - `INVALID_INPUT` — tool arguments failed semantic validation beyond the input schema.
     - `INTERNAL_ERROR` — unexpected failure; message is **sanitized and never leaks a stack
       trace** (M6/security). All non-taxonomy throwables are wrapped as this.
4. **Preserve the stub's invariants** ([M8](../requirements/05-mcp-server.md)): stdio-only
   transport, readiness on stderr, and never loading code-plugins are already implemented in the
   stub — keep them intact; do not add a second transport or a plugin loader.

## Decisions applied

- [M1, M3, M6, M7, M8](../requirements/05-mcp-server.md) · [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md).

## Exit criteria

- [x] Per-tool modules + shared helper in place.
- [x] Output/error/annotation conventions implemented as reusable wrappers.
- [x] stdio transport boots cleanly.

## Implementation notes

- **The taxonomy is one union + a runtime guard, not a shared base class.** Core's existing errors
  (`ConfigError`, `ImpactAnalysisError`, `CompileConfigMissingError`) already `extends Error`
  independently and are matched by `instanceof` at their call sites. Reparenting them onto a common
  `StructuredError` base to carry `code`/`hint` would perturb those prototype chains for no gain, so
  instead `packages/core/src/errors.ts` exports the `TOOL_ERROR_CODES` closed set, the derived
  `ToolErrorCode` type, and an `isStructuredError()` guard that each error class satisfies
  structurally by adding a `code` field. Same "defined once, shared by CLI + MCP" guarantee (M6),
  smaller blast radius.
- **`isStructuredError` is an allowlist, not duck-typing.** It checks membership in
  `TOOL_ERROR_CODES`, not merely "has a string `.code`" — Node `fs` errors (`ENOENT`, …) also carry
  a `.code`, and letting those through would leak an unrelated system code to an MCP client instead
  of falling through to the sanitized `INTERNAL_ERROR`. The type is derived from the runtime array
  so the two cannot drift.
- **`ImpactAnalysisError` maps to `TARGET_NOT_FOUND`, and `FILE_NOT_IN_CORPUS` ships defined but
  unused.** The two codes overlap in wording; `TARGET_NOT_FOUND`'s bullet explicitly names an
  "impact … file argument," the closer match. `FILE_NOT_IN_CORPUS` is reserved for a future
  call-site (revisit when P7.03 wires the graph tools' error paths) rather than removed, keeping the
  taxonomy stable for the tool tasks that follow.
- **The shared helper resolves a relative `configPath` against the tool `cwd`, not the process
  cwd.** `loadConfiguration` resolves `explicitConfigPath` against `process.cwd()`; an MCP tool's
  `cwd` can differ from the server process cwd, so `resolveToolConfiguration` resolves a non-absolute
  `configPath` against the effective tool `cwd` first — mirroring the guard the CLI's `compile`
  handler already applies. Without it a relative `configPath` would silently load the wrong config or
  raise a spurious `CONFIG_NOT_FOUND`.
- **`INTERNAL_ERROR` returns a fixed, source-independent message.** The catch-all deliberately does
  not forward `error.message`/`String(error)`, which can carry absolute paths or stack fragments;
  M6/security requires the unexpected-error path be sanitized, so only coded errors keep their own
  vetted messages.
- **The registrar list is function-only and empty until the tool tasks land.** `tools/index.ts`
  holds `Array<(server: McpServer) => void>` with no parallel name list — a second hand-maintained
  inventory is exactly the "5 vs 6 tools" drift M3 exists to prevent, so P7.05's doc generation
  should introspect the live server instead. `registerTools()` is wired into `createServer()` now
  but is a no-op, which is what keeps `smoke.test.ts` green (still zero tools advertised) as the
  regression guard for the preserved stub invariants.

> `ConfigError`'s constructor changed from `(message)` to `(code, message, hint?)` — a public-API
> shape change in core. It is contained to the four throw sites in `load-config.ts`; every consumer
> only does `instanceof` / reads `.message`, so the added fields are purely additive.

## Hand-off to next

P7.02–P7.04 implement each tool against these conventions, so they stay thin and consistent.
