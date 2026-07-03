# P0.01 · Workspace layout & tooling decisions

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Done** · Design task (no production code).

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
2. **Package set & names:** `@wastech-mdlint/core`, `@wastech-mdlint/cli`
   (bin `wastech-mdlint`), `@wastech-mdlint/mcp-server` (bin `wastech-mdlint-mcp`).
   Confirmed against requirement **I4** ([../requirements/06-installation.md](../requirements/06-installation.md))
   and roadmap §4 ([../index.md](../index.md)).
3. **Runtime/engines:** `engines.node` = `>=24.17.0` on every package (I5). _No upper bound_
   (decided 2026-07-02, audit — P9 engines gap): don't lock out future majors; CI validates on
   the Node 24 LTS line (`.nvmrc`/`.node-version` pin 24.17.0), newer at users' discretion.
4. **Zod version:** **v4** (`zod@^4`), a single version shared by `core` + `mcp-server`.
   _Decided 2026-07-02._ Rationale: Zod v4 ships a native `z.toJSONSchema()`, which is what
   `schema.json` generation ([P2.06](../P2-rule-engine/06-schema-generation.md)) needs — this
   removes the third-party `zod-to-json-schema` dependency and keeps schema output under our
   control. It also matches the MCP SDK examples, so no porting is required there. The current
   v3 usage lives only in `src/config/load.ts`; it is migrated to the v4 API when that code
   relocates into `core` ([P0.04](04-relocate-current-source-into-core.md)). The surface used
   there (`z.string/number/array/enum`, `.optional()`, `.safeParse()`, `z.infer`, `z.ZodError`)
   is near-identical in v4, so the migration is mechanical.
5. **TypeScript build strategy:** **project references**, built with `tsc -b`.
   _Decided 2026-07-02._ A single `tsconfig.base.json` holds the shared compiler options; each
   package's `tsconfig.json` `extends` it and sets `composite: true`; a root `tsconfig.json`
   lists all three packages under `references` (`core`; `cli` and `mcp-server` each reference
   `core`). Rationale: packages resolve each other through compiled `dist/` + `.d.ts`
   ([P0.03](03-core-package-skeleton.md), [P0.05](05-cli-package-commander.md)), so `core` must
   build before `cli`/`mcp-server`; `tsc -b` enforces that order automatically and rebuilds
   incrementally via `.tsbuildinfo`. Independent per-package `tsc` was rejected: `npm run
   --workspaces` does not guarantee topological order (cli could build before core) and gives
   no cross-package incremental caching.
6. **Test/lint/format:** Vitest workspace, ESLint flat config + Prettier at the root, run
   per package via root scripts.
7. **Module format:** ESM (`"type": "module"`), NodeNext resolution (already present today).

## Deliverables

- This decision note, with the chosen Zod version and build strategy filled in.
- A one-paragraph update to the [phase index](index.md) if any decision changes the task
  list.

## Exit criteria

- [x] Zod version chosen and written down. → **v4** (`zod@^4`), decided 2026-07-02.
- [x] Build strategy (project references vs independent `tsc`) chosen. → **project references** (`tsc -b`), decided 2026-07-02.
- [x] Package names/bins confirmed against the requirements. → `@wastech-mdlint/core`,
  `@wastech-mdlint/cli` (bin `wastech-mdlint`), `@wastech-mdlint/mcp-server`
  (bin `wastech-mdlint-mcp`), confirmed 2026-07-02 against requirement **I4**
  ([requirements/06-installation.md](../requirements/06-installation.md)) and roadmap §4
  ([../index.md](../index.md)). No conflict found.

## Hand-off to next

P0.02 can scaffold the root with no further questions: it knows the manager, the package
names, the Node/Zod versions, and the build/test/lint strategy.
