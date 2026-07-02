---
id: p0-02-root-workspace
title: "P0.02 — Root workspace + shared config baseline"
priority: high
branch_name: "feat/p0-monorepo-workspace" # operator branch override (custom, not the worc/ auto pattern)
depends_on:
  - p0-01-workspace-decisions
---

## Description

Convert the repo root into an npm workspace and provide the shared config every package inherits, so later package skeletons are trivial. Structural only — no product features. Follow `docs/mdlint_v2/P0-foundations/02-root-scaffolding.md`.

## Acceptance criteria

- [ ] Root `package.json`: `"workspaces": ["packages/*"]`, `"private": true`, keeps `"type": "module"` and `engines.node`; build/test/typecheck/lint/format scripts fan out across the workspace.
- [ ] The `postinstall` script (`scripts/install-default-config.mjs`) is removed along with its `files`/scripts references (I1); install no longer writes a config file.
- [ ] `tsconfig.base.json` at the root holds the shared compiler options (ESM/NodeNext, strict); the root `tsconfig.json` is set up for project references (`tsc -b`).
- [ ] Root ESLint flat config, Prettier config, and a Vitest workspace config exist and are shared by all packages.
- [ ] `.nvmrc` / `.node-version` stay at Node 24.17.0.
- [ ] `npm run typecheck && npm test && npm run build` remain green (current behavior preserved; `packages/*` may be empty until P0.03).

## Constraints

- Follow `02-root-scaffolding.md` exactly; greenfield (no backward-compatibility layer).
- Do not create package skeletons yet (P0.03) and do not relocate `src/` yet (P0.04).
