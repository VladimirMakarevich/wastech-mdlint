---
id: p0-06-mcp-skeleton
title: "P0.06 — @wastech-mdlint/mcp-server package skeleton (stub)"
priority: low
auto_merge: true # per-task override (task-wins over config git.auto_merge=false, PRE.2): squash-merge this small stub automatically after checks+review pass
nodes:
  implementation:
    model: claude-sonnet-4-6 # per-node model override on a small stub task
depends_on:
  - p0-04-relocate-core
---

## Description

Create the `@wastech-mdlint/mcp-server` package shell so the 3-package workspace shape and its publish config are locked. The real tools come in P7 — ship only a minimal, buildable stub. Runs in parallel with P0.05. Follow `docs/mdlint_v2/P0-foundations/06-mcp-server-skeleton.md`.

## Acceptance criteria

- [ ] `packages/mcp-server/package.json`: name `@wastech-mdlint/mcp-server`, bin `wastech-mdlint-mcp` → `dist/index.js`, deps `@wastech-mdlint/core` (`workspace:*`), `@modelcontextprotocol/sdk`, and the shared Zod v4; `files: ["dist"]`, `publishConfig.access: "public"`.
- [ ] `packages/mcp-server/src/index.ts` is a minimal stub: create an `McpServer`, connect a `StdioServerTransport`, log readiness to stderr; register NO tools (or a single trivial health tool).
- [ ] `tsconfig.json` extends the base and builds to `dist`; the stub starts over stdio and exits cleanly (smoke); the name/bin/publishConfig match the requirements.

## Constraints

- stdio-only; the server never loads code-plugins. Structured output, the 6 real tools, and integration tests are all P7 — do not build them here.
