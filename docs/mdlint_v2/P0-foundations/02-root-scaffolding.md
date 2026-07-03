# P0.02 · Root workspace + shared config baseline

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Done**.

## Goal

Convert the repo root into an npm workspace and provide the shared config every package
inherits, so package skeletons (P0.03+) are trivial.

## Sequence

- **Previous:** [P0.01 — Workspace decisions](01-workspace-decisions.md) chose the manager
  (npm workspaces), package names, Node/Zod versions, and the build/test/lint strategy.
  This task executes those choices at the root.
- **Next:** [P0.03 — core package skeleton](03-core-package-skeleton.md) creates the first
  package inside the `packages/*` workspace this task declares.
- **Depends on:** P0.01 · **Blocks:** P0.03, P0.04, P0.05, P0.06, P0.07.

## Inputs (from previous work)

- The current implementation root files: `package.json`, `tsconfig.json`, `eslint.config.js`,
  `.prettierrc.json`, `.nvmrc`, `.node-version`, `vitest.config.ts`.

## Deliverables / steps

1. Root `package.json`: add `"workspaces": ["packages/*"]`, set `"private": true`, keep
   `"type": "module"` and `engines.node`. Move build/test/typecheck/lint/format scripts to
   run across the workspace (`npm run <script> --workspaces` or project-reference build).
2. **Remove the current `postinstall` script** (`scripts/install-default-config.mjs`) per
   [I1](../requirements/06-installation.md); `init` (P6) replaces it. Delete the script and
   its `files`/scripts references.
3. `tsconfig.base.json` at the root with the shared compiler options (ESM/NodeNext, strict,
   the current implementation's settings); per-package tsconfigs will `extends` it.
4. Root ESLint flat config + Prettier config shared by all packages.
5. Root Vitest workspace config that discovers each package's tests.
6. Keep `.nvmrc` / `.node-version` at Node 24.17.0.

## Decisions applied

- [D1](../index.md) workspaces · [I1](../requirements/06-installation.md) no postinstall ·
  [D2](../index.md) greenfield (the existing root `wastech-mdlint.config.json` is a sample,
  freely rewritten later).

## Exit criteria

- [ ] `npm install` at the root links the (soon-to-exist) workspace packages.
- [ ] Root scripts fan out to packages.
- [ ] `postinstall` is gone; install no longer writes a config file.
- [ ] `tsconfig.base.json`, shared ESLint/Prettier, and Vitest workspace exist.

## Hand-off to next

P0.03 adds `packages/core` that `extends` `tsconfig.base.json` and is picked up by the
workspace + Vitest with no extra root wiring.
