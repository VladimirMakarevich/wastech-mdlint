# P7.01 · Server foundation — modular layout, shared helper, conventions

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Turn the stub into a maintainable server shell: modular tool layout, a shared config/context
helper, and the output/error/annotation conventions every tool follows.

## Sequence

- **Previous:** [P0.06 — mcp-server skeleton](../P0-foundations/06-mcp-server-skeleton.md)
  (stub) and the completed core engine/graph/compile (P2/P4/P5).
- **Next:** [P7.02](02-lint-tools.md), [P7.03](03-graph-tools.md), [P7.04](04-compile-tool.md).
- **Depends on:** P2/P4/P5 done · **Blocks:** all tool tasks.

## Deliverables / steps

1. **Modular layout** ([M3](../requirements/05-mcp-server.md)): one module per tool, registered
   from an index; no single mega-file.
2. **Shared helper** mirroring the CLI `shared.ts`: `resolveCwd`, `resolveConfig`
   (`--configPath` or `findConfig`), `loadContext` — used by all file-based tools.
3. **Conventions:** a `structuredContent` + `outputSchema` pattern
   ([M1](../requirements/05-mcp-server.md)) plus a text summary; an error contract
   `{ code, message, hint }` with `isError: true` ([M6](../requirements/05-mcp-server.md));
   tool annotations (`readOnlyHint`, etc., [M7](../requirements/05-mcp-server.md)).
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
4. **Transport:** stdio only; readiness to stderr; **never** load code-plugins
   ([M8](../requirements/05-mcp-server.md)).

## Decisions applied

- [M1, M3, M6, M7, M8](../requirements/05-mcp-server.md) · [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md).

## Exit criteria

- [ ] Per-tool modules + shared helper in place.
- [ ] Output/error/annotation conventions implemented as reusable wrappers.
- [ ] stdio transport boots cleanly.

## Hand-off to next

P7.02–P7.04 implement each tool against these conventions, so they stay thin and consistent.
