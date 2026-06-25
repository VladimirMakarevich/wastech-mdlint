# P7.05 · Stdio integration tests + generated tool docs + README

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

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
3. README + host-config snippet (`npx @wastech-ctxlint/mcp-server`) for common MCP hosts.
4. Confirm the 6-tool surface (no `fix`/`schema` — [M5 backlog](../requirements/05-mcp-server.md)).

## Decisions applied

- [M3, M4](../requirements/05-mcp-server.md) · [M5 backlog](../requirements/05-mcp-server.md).

## Exit criteria

- [ ] stdio integration tests cover all 6 tools (success + error).
- [ ] README tool list generated; host-config snippet documented.
- [ ] Phase P7 [exit criteria](index.md) satisfied.

## Hand-off to next

P8 authors skills that call these tools (and the CLI); the agent surface is now complete and
tested.
