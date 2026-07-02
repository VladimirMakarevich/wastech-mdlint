---
id: p0-05-cli-commander
title: "P0.05 — @wastech-mdlint/cli + commander scaffold"
priority: high
depends_on:
  - p0-04-relocate-core
---

## Description

Create the `@wastech-mdlint/cli` package, adopt `commander` (D5), and port the current `scan` and `graph` commands onto it with IDENTICAL behavior, importing all logic from `@wastech-mdlint/core`. Runs in parallel with P0.06. Follow `docs/mdlint_v2/P0-foundations/05-cli-package-commander.md`.

## Acceptance criteria

- [ ] `packages/cli/package.json`: name `@wastech-mdlint/cli`, bin `wastech-mdlint` → `dist/index.js`, deps `@wastech-mdlint/core` (`workspace:*`) + `commander`.
- [ ] A `commander` program with subcommands `scan` and `graph` maps the existing options (`--config`, `--format`, `--fail-on`, `--out`) and exit codes (0 success / 1 findings / 2 usage) 1:1; handlers delegate to core (no reimplemented pipeline).
- [ ] `src/cli.ts` logic is relocated into `packages/cli/src/` and the old root entry is removed.
- [ ] `wastech-mdlint scan` and `graph` produce byte-identical output to the current implementation (parity); the CLI imports only from `@wastech-mdlint/core`.

## Constraints

- Do NOT add the `lint` command or the `scan` alias (D4) here — per the P0.05 scope note it arrives with the new engine in P2/P3. P0 only ports the existing `scan`/`graph` for parity.
- `@inquirer/prompts` may be reserved as a dependency for the P6 `init`, but this task adds no `init` command.
