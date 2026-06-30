# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project State

`wastech-ctxlint` is being rebuilt from the current single-package implementation into the v2 production target.

- The current repository still contains the single-package codebase in `src/` and `test/`.
- The target product is the v2 monorepo/workspace design documented under `docs/ctxlint_v2/`.
- Treat the current filesystem state as truth for where code lives today.
- Treat the v2 roadmap as truth for where the product is going next.

Do not invent post-P0 package layout in implementation work unless the task explicitly belongs
to that phase. Likewise, do not preserve legacy single-package behavior once a v2 phase explicitly replaces it.

## Sources Of Truth

The production v2 effort is the current focus. Its authoritative planning lives under
`docs/ctxlint_v2/`:

- Roadmap: `docs/ctxlint_v2/index.md`
- Locked requirements: `docs/ctxlint_v2/requirements/` with index at
  `docs/ctxlint_v2/requirements/index.md`
- Architectural decisions: `docs/ctxlint_v2/decisions/`
- Phase task plans: `docs/ctxlint_v2/P0-foundations/` through `docs/ctxlint_v2/P9-release/`

When documents disagree, use this precedence:

1. The specific phase task file for the work you are doing
2. The relevant locked requirements document
3. The relevant decision document
4. The roadmap summary

If a contradiction changes implementation behavior, surface it explicitly instead of guessing.

Historical v1 planning remains in `PLAN.md` and `docs/plan/`, but it is background context only
when it conflicts with `docs/ctxlint_v2/`.

## Delivery Order

Unless the user explicitly asks for a different slice, follow the v2 phase order and task
dependency chains:

`P0 Foundations -> P1 ParsedDocument -> P2 Rule engine -> P3 Rules -> P4 Graph -> P5 Compile -> P6 Init -> P7 MCP server -> P8 Skills -> P9 Release`

For implementation sequencing, respect each task file's `Previous`, `Next`, `Depends on`, and
`Blocks` links.

## Architecture Invariants

- `@wastech-ctxlint/core` is the single owner of parsing, config loading, lint orchestration,
  graph construction, compile logic, and result formatting.
- `@wastech-ctxlint/cli` and `@wastech-ctxlint/mcp-server` are thin adapters over core. They do
  not re-implement the pipeline.
- Runtime surfaces in `core`, `cli`, and `mcp-server` must behave correctly on Windows, macOS,
  and Linux.
- `ParsedDocument` is produced from one parse pass and feeds rules, graph, compile, and inline
  suppression behavior.
- The rule system is registry-driven: structured metadata, Zod-validated options, shared
  assertion primitives, and deterministic findings.
- `ContextGraph` is shared infrastructure for graph commands, impact/slice logic, and graph-aware
  rules. Do not create parallel traversal implementations.
- Public/report output uses normalized repository-relative POSIX paths and deterministic ordering.
- v2 config is JSONC in `wastech-ctxlint.config.json` with a local `$schema`. Do not introduce
  remote schema URLs, runtime TypeScript config loading, or `.cjs`/`.mjs` config support in v2
  work unless the roadmap changes.

## Implementation Guidance

- Prefer small modules with explicit data handoff between parser, config, engine, rules, graph,
  compile, CLI, and MCP.
- Keep rule logic pure where practical: parsed inputs in, structured findings or edits out.
- Use explicit public types for load-bearing contracts such as `ParsedDocument`, `Rule`,
  `RuleContext`, `LintMessage`, `ContextGraph`, and compile outputs.
- Treat path normalization, glob handling, newline behavior, and report rendering as
  cross-platform correctness concerns, not platform-specific polish.
- Reuse parser libraries and structured AST traversal instead of ad hoc Markdown parsing.
- Keep token estimation isolated so the current heuristic can be replaced later without
  refactoring unrelated code.
- Do not add broad abstractions before the phase plan creates a concrete need for them.
- Do not add new skills, `.claude/skills/`, hooks, LSP support, docs-site work, external HTTP
  link checking, external link caches, or code-plugin execution unless the user explicitly asks
  for that scope.

## Testing And Verification

Prefer focused fixtures over this repository's real Markdown files.

Expected coverage areas across the roadmap:

- config loading, defaults, diagnostics, and schema generation
- Markdown parsing: headings, tables, sections, links, images, checklist items, imports,
  inline-disable directives
- rule fixtures per rule family
- graph algorithms, slice, impact, and coverage reporting
- CLI command behavior and exit codes
- MCP stdio integration and structured output
- compile/init deterministic output
- generated docs/schema sync checks

Before finishing code changes, prefer these commands when they apply:

```bash
npm run typecheck
npm test
npm run build
```

Use `npm run lint` and `npm run format` when the touched scope or task requires style
verification.

## Repository Hygiene

- Do not rewrite or revert existing user changes unless explicitly requested.
- Keep documentation aligned with the current v2 phase/task files when implementation decisions
  intentionally diverge.
- Keep user-facing product documentation in `README.md`.
- Keep agent-operation guidance in `AGENTS.md`, `CLAUDE.md`, and `.agents/rules/`.
- If a task is documentation-only, do not change product code, public interfaces, package
  metadata, or dependencies unless the user explicitly expands scope.
