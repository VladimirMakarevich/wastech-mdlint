# P0.06 · `@wastech-ctxlint/mcp-server` package skeleton (stub)

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Not started**.

## Goal

Create the `@wastech-ctxlint/mcp-server` package shell so the 3-package workspace shape and
its publish config are locked. The real tools are built later in [P7](../index.md) — this
task ships only a minimal, buildable stub.

## Sequence

- **Previous:** [P0.04 — Migrate MVP source into core](04-migrate-mvp-to-core.md) made core
  importable; [P0.05 — cli package](05-cli-package-commander.md) is the parallel sibling host.
- **Next:** [P0.07 — CI & packaging baseline](07-ci-packaging-baseline.md) packs and tests
  all three packages.
- **Depends on:** P0.04 · **Can run in parallel with:** P0.05 · **Blocks:** P0.07.

## Inputs (from previous work)

- Core's exported pipeline (P0.04); the package shape conventions from P0.03.

## Deliverables / steps

1. `packages/mcp-server/package.json`: name `@wastech-ctxlint/mcp-server`, bin
   `wastech-ctxlint-mcp` → `dist/index.js`, deps `@wastech-ctxlint/core` (`workspace:*`),
   `@modelcontextprotocol/sdk`, the shared Zod version; `files: ["dist"]`,
   `publishConfig.access: "public"`.
2. `packages/mcp-server/src/index.ts` minimal stub: create an `McpServer`, connect a
   `StdioServerTransport`, log readiness to **stderr**. Register **no** tools yet (or a single
   trivial health tool) — the 6 tools come in P7.
3. `tsconfig.json` extending the base; builds to `dist`.

> **Scope note:** transport is stdio-only and the server will never load code-plugins
> ([M8](../requirements/05-mcp-server.md)); structured output, the 6 tools, and integration
> tests are all [P7](../index.md).

## Decisions applied

- [D1](../index.md) 3-package workspace · [M8](../requirements/05-mcp-server.md) stdio-only ·
  [I5](../requirements/06-installation.md) publish shape.

## Exit criteria

- [ ] `packages/mcp-server` builds to `dist`.
- [ ] The stub server starts over stdio and exits cleanly (smoke check).
- [ ] Package name/bin/publishConfig match the requirements.

## Hand-off to next

P0.07 can include the mcp-server in the pack/CI matrix. P7 fills the stub with the 6 tools
on top of core, with no package-shape changes needed.
