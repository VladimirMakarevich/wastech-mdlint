# P0.01 · Workspace layout & tooling decisions

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Not started** · Design task (no production code).

## Goal

Lock the concrete shape of the monorepo and the shared toolchain so P0.02–P0.08 are pure
execution. Output is a short decision note (this file + any updates to the phase index),
not code.

## Sequence

- **Previous:** _none_ — this is the first task of P0. It consumes the roadmap decisions
  [D1](../index.md) (monorepo), [D5](../index.md) (commander + inquirer), and the
  [requirements pass](../requirements/index.md).
- **Next:** [P0.02 — Root workspace + shared config baseline](02-root-scaffolding.md) turns
  these decisions into the actual root scaffolding.
- **Depends on:** — · **Blocks:** every other P0 task.

## Decisions to make and record

1. **Workspace manager:** npm workspaces (per D1). Confirm npm (not pnpm) to keep CI simple
   and match the reference `workspace:*` style.
2. **Package set & names:** `@wastech-ctxlint/core`, `@wastech-ctxlint/cli`
   (bin `wastech-ctxlint`), `@wastech-ctxlint/mcp-server` (bin `wastech-ctxlint-mcp`).
3. **Runtime/engines:** Node `>=24.17.0 <25` on every package (I5).
4. **Zod version:** pin one version shared by `core` + `mcp-server` (reference uses Zod v4;
   MVP uses v3). Decide v4 to match the MCP SDK examples → record the chosen version.
5. **TypeScript build strategy:** single `tsconfig.base.json` + per-package `tsconfig` that
   `extends` it; decide whether to use project references (recommended for incremental
   builds) or independent `tsc` per package.
6. **Test/lint/format:** Vitest workspace, ESLint flat config + Prettier at the root, run
   per package via root scripts.
7. **Module format:** ESM (`"type": "module"`), NodeNext resolution (carry over from MVP).

## Deliverables

- This decision note, with the chosen Zod version and build strategy filled in.
- A one-paragraph update to the [phase index](index.md) if any decision changes the task
  list.

## Exit criteria

- [ ] Zod version chosen and written down.
- [ ] Build strategy (project references vs independent `tsc`) chosen.
- [ ] Package names/bins confirmed against the requirements.

## Hand-off to next

P0.02 can scaffold the root with no further questions: it knows the manager, the package
names, the Node/Zod versions, and the build/test/lint strategy.
