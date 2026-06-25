# P0.04 · Migrate MVP source into core (behavior-preserving)

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Lift-and-shift the MVP's reusable modules from `src/*` into `packages/core/src/*`
**without changing behavior**. This is a move + import-fix, not a rewrite.

## Sequence

- **Previous:** [P0.03 — core package skeleton](03-core-package-skeleton.md) created the
  buildable `@wastech-ctxlint/core` shell with Zod and build/test wiring.
- **Next:** [P0.05 — cli package + commander](05-cli-package-commander.md) imports these
  relocated modules from `@wastech-ctxlint/core` instead of relative `src` paths.
- **Depends on:** P0.03 · **Blocks:** P0.05, P0.06 (both import core).

## Inputs (from previous work)

MVP modules to relocate (all currently clean and reusable — see the
[roadmap §2 reuse table](../index.md)):
`markdown/parse.ts`, `graph/build.ts`, `discovery/{discover,globs}.ts`,
`llm/{imports,budget.ts}` (token estimator), `rules/{local-links,size,structure}.ts`,
`config/{defaults,load}.ts`, `reporting/render.ts`, `types.ts`, and their tests.

## Deliverables / steps

1. Move the modules above into `packages/core/src/` (keep the internal folder structure).
2. Move the matching `test/*` files into `packages/core/` test dirs; keep fixtures with
   them.
3. Fix import paths; re-export the public surface from `packages/core/src/index.ts`
   (the current `types.ts` contracts: `AuditConfig`, `Finding`, `MarkdownFile`,
   `DependencyGraph`, `EntrypointBudget`, etc.).
4. Do **not** refactor logic or rename types in this task — parity is the point. The
   config-model and rule-engine rewrites happen in [P2](../index.md), the parser upgrade in
   [P1](../index.md).
5. Keep the CLI entry (`src/cli.ts`) where it is for now; P0.05 relocates it.

## Decisions applied

- [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md)
  pipeline lives in core · behavior-preserving migration (no logic change).

## Exit criteria

- [ ] All migrated unit tests pass inside `packages/core`.
- [ ] `packages/core` builds and exports the public types/functions.
- [ ] No behavior change vs the MVP modules (same outputs for same inputs).

## Hand-off to next

P0.05 can build the CLI purely on top of `@wastech-ctxlint/core`'s exports; P0.06 can
stub the MCP server against the same core. The parser/graph/config now live where P1/P2
will extend them.
