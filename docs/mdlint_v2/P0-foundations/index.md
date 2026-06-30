# Phase P0 — Workspace & Foundations

> Roadmap: [v2 Index](../index.md) · Phase **P0** · Size **M** · Status **Not started**
>
> **Goal:** stand up the monorepo and shared tooling so every later phase lands in the
> right package, then lift-and-shift the current implementatctxlinto `@wastech-ctxlint/core` **without
> changing its behavior**. P0 ships no new product features — it is purely structural.

## Why this phase exists

The current implementation is a single package with a hand-rolled CLI. The target ([D1](../index.md))
is a workspace with `@wastech-ctxlint/{core,cli,mcp-server}` so the MCP server and CLI
publish separately and all hosts import one core ([core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md)).
Everything in [P1+](../index.md) (parser upgrade, rule engine, graph, compile, MCP) assumes
this layout already exists.

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P0.01](01-workspace-decisions.md) | Workspace layout & tooling decisions (design) | S | — |
| [P0.02](02-root-scaffolding.md) | Root workspace + shared config baseline | M | P0.01 |
| [P0.03](03-core-package-skeleton.md) | `@wastech-ctxlint/core` package skeleton | S | P0.02 |
| [P0.04](04-relocate-current-source-into-core.md) | Relocate current source into core (behavior-preserving) | M | P0.03 |
| [P0.05](05-cli-package-commander.md) | `@wastech-ctxlint/cli` + commander scaffold (port scan/graph) | M | P0.04 |
| [P0.06](06-mcp-server-skeleton.md) | `@wastech-ctxlint/mcp-server` package skeleton (stub) | S | P0.04 |
| [P0.07](07-ci-packaging-baseline.md) | CI matrix & packaging/publish baseline | M | P0.05, P0.06 |
| [P0.08](08-exit-verification.md) | Phase exit verification & layout docs | S | all above |

## Sequence

```
P0.01 ─► P0.02 ─► P0.03 ─► P0.04 ─┬─► P0.05 ─┐
                                  └─► P0.06 ─┴─► P0.07 ─► P0.08 ─► (Phase P1)
```

P0.05 (cli) and P0.06 (mcp-server) both depend only on P0.04 and can run in parallel.

## Decisions applied

- [D1](../index.md) monorepo (npm workspaces) · [D5](../index.md) commander + inquirer ·
  [D2](../index.md) clean config replace (greenfield) ·
  [I1](../requirements/06-installation.md) drop `postinstall` ·
  [I5](../requirements/06-installation.md) per-package supply chain.

## Phase exit criteria

- [ ] `npm run typecheck && npm test && npm run build` are green across the whole workspace.
- [ ] `packages/{core,cli,mcp-server}` exist with correct names, bins, and `publishConfig`.
- [ ] Current behavior preserved: `wastctxlintlint scan` and `graph` produce the same output
      as before the migration (parity check).
- [ ] The current `postinstall` auto-config is removed (I1).
- [ ] CI runs the workspace matrix on Node 24; `npm pack --dry-run` is clean per package.
- [ ] No new product features were added (P0 is structural only).

## What P0 unblocks

- **P1** — extend the relocated parser into `ParsedDocument` (in `core`).
- **P2** — build the rule engine + new config model (in `core`).
- **P7** — fill the `mcp-server` stub with real tools.
- **P9** — turn the packaging baseline into the single-tag release workflow.
