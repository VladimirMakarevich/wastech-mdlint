---
id: p0-03-core-skeleton
title: "P0.03 — @wastech-mdlint/core package skeleton"
priority: mid
nodes:
  planning:
    reasoning: medium # per-node reasoning override (differs from the flow-wide high)
depends_on:
  - p0-02-root-workspace
---

## Description

Create an empty-but-buildable `@wastech-mdlint/core` package that the CLI and MCP server will depend on. No existing logic moves yet — just the shell. Follow `docs/mdlint_v2/P0-foundations/03-core-package-skeleton.md`.

## Acceptance criteria

- [ ] `packages/core/package.json`: name `@wastech-mdlint/core`, `"type": "module"`, `exports` (`.` → `./dist/index.js` + types), `engines.node`, `files: ["dist"]`, `publishConfig.access: "public"`, and the Zod v4 dependency.
- [ ] `packages/core/tsconfig.json` extends `tsconfig.base.json`, sets `composite: true`, and emits to `dist`.
- [ ] `packages/core/src/index.ts` is a placeholder (empty re-export barrel).
- [ ] Package wired into the workspace build/test; `packages/core` builds to `dist` via `tsc -b`; an empty Vitest run passes; other packages can resolve/import it under the workspace.

## Constraints

- Skeleton only — do not move any `src/` module in yet (that is P0.04).
