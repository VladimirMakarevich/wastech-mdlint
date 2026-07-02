---
id: p0-04-relocate-core
title: "P0.04 — Relocate current source into core (behavior-preserving)"
priority: high
nodes:
  implementation:
    reasoning: xhigh # heavier reasoning for this large lift-and-shift
depends_on:
  - p0-03-core-skeleton
---

## Description

Lift-and-shift the reusable modules from `src/*` into `packages/core/src/*` WITHOUT changing behavior — a move + import-fix, not a rewrite. Follow `docs/mdlint_v2/P0-foundations/04-relocate-current-source-into-core.md`.

## Acceptance criteria

- [ ] These modules are moved into `packages/core/src/` keeping their folder structure: `markdown/parse.ts`, `graph/build.ts`, `discovery/{discover,globs}.ts`, `llm/{imports,budget}.ts`, `rules/{local-links,size,structure}.ts`, `config/{defaults,load}.ts`, `reporting/render.ts`, `types.ts`.
- [ ] The matching `test/*` files (and their fixtures) are moved into `packages/core` test dirs.
- [ ] Import paths are fixed; the public surface is re-exported from `packages/core/src/index.ts` (`AuditConfig`, `Finding`, `MarkdownFile`, `DependencyGraph`, `EntrypointBudget`, etc.).
- [ ] The `config/load.ts` Zod usage is migrated from v3 to the v4 API (mechanical — the used surface is near-identical).
- [ ] All migrated unit tests pass inside `packages/core`; the package builds and exports the public types/functions; outputs are unchanged for the same inputs (parity).

## Constraints

- Parity is the point: do NOT refactor logic or rename types (the config-model and rule-engine rewrites are P2; the parser upgrade is P1).
- Keep the CLI entry (`src/cli.ts`) where it is for now — P0.05 relocates it.
