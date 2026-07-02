---
id: p0-01-workspace-decisions
title: "P0.01 — Finalize workspace layout & tooling decisions"
priority: high
nodes:
  documentation:
    enabled: false # deliverable IS the decision note; a separate documentation pass is redundant
---

## Description

First task of phase P0 (workspace & foundations). Finalize and record the concrete monorepo/toolchain decisions so P0.02–P0.08 are pure execution. This is a design/documentation task — its deliverable is the decision note `docs/mdlint_v2/P0-foundations/01-workspace-decisions.md`, not production code.

Read that file and the roadmap `docs/mdlint_v2/index.md` (decisions D1–D7) first. Most decisions are already recorded: npm workspaces; packages `@wastech-mdlint/{core,cli,mcp-server}`; Zod v4; TypeScript project references built with `tsc -b`; ESM/NodeNext; Vitest + ESLint + Prettier at the root. The one open exit item is confirming the package names and bins against the requirements.

## Acceptance criteria

- [ ] Package names and bins are confirmed against `docs/mdlint_v2/requirements/` and written into the note: `@wastech-mdlint/core`, `@wastech-mdlint/cli` (bin `wastech-mdlint`), `@wastech-mdlint/mcp-server` (bin `wastech-mdlint-mcp`).
- [ ] Every exit-criteria checkbox in `01-workspace-decisions.md` is resolved (ticked or explicitly annotated), including the package-names/bins item.
- [ ] If any decision changes the task list, a one-paragraph update is made to `docs/mdlint_v2/P0-foundations/index.md`.

## Constraints

- Decision-record only: do not create `packages/*`, and do not touch `src/`, `package.json`, or any `tsconfig`.
- Do not re-open settled decisions (D1–D7, Zod v4, project references) without new evidence — this task records them, it does not re-litigate them.
