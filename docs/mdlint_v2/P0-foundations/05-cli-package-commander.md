# P0.05 · `@wastech-mdlint/cli` + commander scaffold

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Create the `@wastech-mdlint/cli` package, adopt `commander` ([D5](../index.md)), and port
the current `scan` and `graph` commands onto it **with identical behavior**, importing all logic
from `@wastech-mdlint/core`.

## Sequence

- **Previous:** [P0.04 — Relocate current source into core](04-relocate-current-source-into-core.md) put the
  pipeline (config, discovery, parse, rules, graph, reporting) inside `@wastech-mdlint/core`
  and exported it.
- **Next:** [P0.06 — mcp-server skeleton](06-mcp-server-skeleton.md) (parallel sibling, also
  on core) and then [P0.07 — CI & packaging](07-ci-packaging-baseline.md).
- **Depends on:** P0.04 · **Can run in parallel with:** P0.06 · **Blocks:** P0.07.

## Inputs (from previous work)

- The hand-rolled arg parser and command handlers currently in `src/cli.ts`.
- Core's exported pipeline functions from P0.04.

## Deliverables / steps

1. `packages/cli/package.json`: name `@wastech-mdlint/cli`, bin `wastech-mdlint` →
   `dist/index.js`, dependency `@wastech-mdlint/core` (`workspace:*`) + `commander`
   (and `@inquirer/prompts` reserved for the P6 `init`).
2. Set up a `commander` program with subcommands `scan` and `graph`, mapping the existing
   options (`--config`, `--format`, `--fail-on`, `--out`) and exit-code logic 1:1 onto the
   current behavior. Reuse, don't reimplement, the handlers (delegate to core).
3. Relocate `src/cli.ts` logic into `packages/cli/src/`; remove the old root entry.
4. Preserve exit codes (0 success / 1 findings / 2 usage) exactly.

> **Scope note:** `lint` as the default command with `scan` as an alias ([D4](../index.md))
> arrives **with the new rule engine** in [P2/P3](../index.md) — its semantics depend on the
> new config + engine. P0 only ports the existing `scan`/`graph` to keep parity.

## Decisions applied

- [D5](../index.md) commander + inquirer · [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md)
  CLI is a thin host over core.

## Exit criteria

- [ ] `wastech-mdlint scan` and `graph` produce byte-identical output to the current implementation (parity).
- [ ] Exit codes unchanged.
- [ ] CLI imports only from `@wastech-mdlint/core` (no duplicated pipeline logic).

## Hand-off to next

P0.07 has a real bin to pack and test in CI. P2/P3 will add `lint`, `slice`, `impact`,
`compile`, `init` as new subcommands onto this commander scaffold.
