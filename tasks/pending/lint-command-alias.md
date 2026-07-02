---
id: lint-command-alias
title: "Add a `lint` command as an alias for `scan`"
priority: mid
---

## Description

The v2 roadmap decision **D4** (`docs/mdlint_v2/index.md`) renames the primary CLI command from `scan` to `lint`, keeping `scan` as a backward-compatible alias for one minor version. As a first, self-contained step in the **current single-package CLI** (`src/cli.ts`), add `lint` as an accepted command that behaves identically to `scan` today.

This task deliberately stays inside the current hand-rolled argument parser. It does **not** migrate to `commander`, change the config/rule model, or restructure the repo into the v2 monorepo — those belong to later phases (P0.05 / D5). Scope is only: teach the CLI the `lint` verb as an alias of `scan`.

## Acceptance criteria

- [ ] `wastech-mdlint lint [path] [--config <file>] [--format text|json] [--fail-on error|warning|off]` parses and behaves identically to the current `scan` command (same options, same output, same exit codes).
- [ ] `scan` continues to work exactly as before (unchanged behavior).
- [ ] The `--help` text presents `lint` as the primary command and documents `scan` as a backward-compatible alias.
- [ ] The README CLI section is updated to show `lint` as primary with `scan` noted as an alias.
- [ ] A unit test asserts `parseArgv(["lint", ...])` produces the same resolved command as `parseArgv(["scan", ...])`.
- [ ] A CLI/e2e test asserts `lint` produces byte-identical output to `scan` on an existing fixture.
- [ ] `npm run typecheck`, `npm run build`, and `npm test` are all green.

## Constraints

- Do not add any new runtime or dev dependency (no `commander`, no new parser library).
- Do not change the config schema, the rule model, or the package layout (no monorepo / `packages/*` work).
- Keep output deterministic and match the existing code style in `src/cli.ts`.
- Keep the change minimal and additive — `lint` is an alias; do not remove or hide `scan` in this task.
