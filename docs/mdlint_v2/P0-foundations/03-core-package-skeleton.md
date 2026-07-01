# P0.03 · `@wastech-mdlint/core` package skeleton

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Not started**.

## Goal

Create an empty-but-buildable `@wastech-mdlint/core` package that the CLI and MCP server
will depend on. No existing logic moves yet — just the shell.

## Sequence

- **Previous:** [P0.02 — Root scaffolding](02-root-scaffolding.md) declared the `packages/*`
  workspace, the shared `tsconfig.base.json`, and the lint/test baseline. This task adds the
  first package into that workspace.
- **Next:** [P0.04 — Relocate current source into core](04-relocate-current-source-into-core.md) fills this
  skeleton with the relocated current modules.
- **Depends on:** P0.02 · **Blocks:** P0.04 (fills it), P0.05 & P0.06 (depend on it).

## Inputs (from previous work)

- `tsconfig.base.json` and the shared ESLint/Prettier/Vitest config from P0.02.

## Deliverables / steps

1. `packages/core/package.json`: name `@wastech-mdlint/core`, `"type": "module"`,
   `exports` (`"."` → `./dist/index.js` + types), `engines.node`, `files: ["dist"]`,
   `publishConfig.access: "public"`. Add the chosen Zod version (P0.01) as a dependency.
2. `packages/core/tsconfig.json` extending `tsconfig.base.json`, emitting to `dist`.
3. `packages/core/src/index.ts` placeholder (empty re-export barrel).
4. Wire the package into the workspace build/test so `npm run build`/`test` see it.

## Decisions applied

- [D1](../index.md) monorepo · [I5](../requirements/06-installation.md) publish/engines shape.

## Exit criteria

- [ ] `packages/core` builds to `dist` with `tsc`.
- [ ] An empty Vitest run for the package passes.
- [ ] The package resolves under the workspace (other packages can `import` it).

## Hand-off to next

P0.04 has a typed, buildable target to move the current implementation modules into, with the dependency
(Zod) and build/test plumbing already in place.
