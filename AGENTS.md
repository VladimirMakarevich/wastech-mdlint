# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project State

`wastech-mdlint` is now the v2 production target: an npm-workspaces monorepo under `packages/*`, not a pre-migration single package.

- The single-package codebase was relocated into `packages/core` at P0.04, and the legacy pipeline was removed at the P3.09 cutover. All product code lives under `packages/*`; there is no root `src/` or `test/`.
- The target product is the v2 monorepo/workspace design documented under `docs/mdlint_v2/`.
- Treat the current filesystem state as truth for where code lives today.
- Treat the v2 roadmap as truth for where the product is going next.

Do not invent post-P0 package layout in implementation work unless the task explicitly belongs to that phase. Likewise, do not preserve legacy single-package behavior once a v2 phase explicitly replaces it.

## Sources Of Truth

The production v2 effort is the current focus. Its authoritative planning lives under `docs/mdlint_v2/`:

- Roadmap: `docs/mdlint_v2/index.md`
- Locked requirements: `docs/mdlint_v2/requirements/` with index at `docs/mdlint_v2/requirements/index.md`
- Architectural decisions: `docs/mdlint_v2/decisions/`
- Phase task plans: `docs/mdlint_v2/P0-foundations/` through `docs/mdlint_v2/P-release/`
- Glossary (canonical project vocabulary): `docs/mdlint_v2/glossary.md`

The glossary is a lookup reference for terms — public types, config keys, CLI/MCP surfaces, rule IDs, and the planning taxonomy. It is not a precedence tier: when it disagrees with a phase task file, requirement, or decision, those win and the glossary entry is the thing to fix.

When documents disagree, use this precedence:

1. The specific phase task file for the work you are doing
2. The relevant locked requirements document
3. The relevant decision document
4. The roadmap summary

If a contradiction changes implementation behavior, surface it explicitly instead of guessing.

Historical v1 planning is no longer in the tree: `PLAN.md` was deleted in `957a1ca` and is recoverable from git history, and `docs/plan/` was never tracked at all. Either way it is background context only when it conflicts with `docs/mdlint_v2/`.

## Architecture Invariants

- `@wastech-mdlint/core` is the single owner of parsing, config loading, lint orchestration, graph construction, compile logic, and result formatting.
- `@wastech-mdlint/cli` and `@wastech-mdlint/mcp-server` are thin adapters over core. They do not re-implement the pipeline.
- Runtime surfaces in `core`, `cli`, and `mcp-server` must behave correctly on Windows, macOS, and Linux.
- `ParsedDocument` is produced from one parse pass and feeds rules, graph, compile, and inline suppression behavior.
- The rule system is registry-driven: structured metadata, Zod-validated options, shared assertion primitives, and deterministic findings.
- `ContextGraph` is shared infrastructure for graph commands, impact/slice logic, and graph-aware rules. Do not create parallel traversal implementations.
- Public/report output uses normalized repository-relative POSIX paths and deterministic ordering.
- v2 config is JSONC in `wastech-mdlint.config.json` with a local `$schema`. Do not introduce remote schema URLs, runtime TypeScript config loading, or `.cjs`/`.mjs` config support in v2 work unless the roadmap changes.

## Implementation Guidance

- Prefer small modules with explicit data handoff between parser, config, engine, rules, graph, compile, CLI, and MCP.
- Keep rule logic pure where practical: parsed inputs in, structured findings or edits out.
- Use explicit public types for load-bearing contracts such as `ParsedDocument`, `Rule`, `RuleContext`, `LintMessage`, `ContextGraph`, and compile outputs.
- Treat path normalization, glob handling, newline behavior, and report rendering as cross-platform correctness concerns, not platform-specific polish.
- Reuse parser libraries and structured AST traversal instead of ad hoc Markdown parsing.
- Keep token estimation isolated so the current heuristic can be replaced later without refactoring unrelated code.
- Do not add broad abstractions before the phase plan creates a concrete need for them.
- Code comments must be self-contained. No phase/task/backlog/finding/audit ids (`P16.03`, `W-31`) and no references to `docs/`, `AGENTS.md`, `CLAUDE.md`, `.agents/rules/`, or the accepted-behaviors register inside a comment — in any file that carries comments, including JSONC, dotfiles, and CI YAML. Write the reason out in the comment instead: those documents get superseded and deleted, and what is left behind is a pointer where a rationale used to be. The full rule, including the carve-out for machine-read markers such as `@boundary-guard`, is in `.agents/rules/coding-style.md`.
- Do not add new skills, `.claude/skills/`, hooks, LSP support, docs-site work, external HTTP link checking, external link caches, or code-plugin execution unless the user explicitly asks for that scope.

## Testing And Verification

Prefer focused fixtures over this repository's real Markdown files.

Expected coverage areas across the roadmap:

- config loading, defaults, diagnostics, and schema generation
- Markdown parsing: headings, tables, sections, links, images, checklist items, imports, inline-disable directives
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

Use `npm run lint` and `npm run format` when the touched scope or task requires style verification.

Keep the five process-boundary guard categories intact — spawning the installed bin, a write failure, shared `exclude` scope, determinism, and host parity (added by P16.01: a human rendering against its structured payload, and each host's rendering against the other's). They are the standing answer to the post-P9 audit's systemic cause, and the checklist plus its enforcing test live in `.agents/rules/testing.md` under "Process-Boundary Guards".

## Repository Hygiene

- Do not rewrite or revert existing user changes unless explicitly requested.
- Keep documentation aligned with the current v2 phase/task files when implementation decisions intentionally diverge.
- Keep user-facing product documentation in `README.md`.
- Keep agent-operation guidance in `AGENTS.md`, `CLAUDE.md`, and `.agents/rules/`.
- Keep the glossary (`docs/mdlint_v2/glossary.md`) current as part of the change that introduces the term — not as a later cleanup pass. Add, rename, or retire an entry whenever you add or rename a load-bearing public type, config key, CLI flag, MCP tool, rule ID, or assertion primitive; change what a term means or its shipped/planned status; or introduce a new domain concept a future reader would otherwise reverse-engineer from code. This is part of "bring the affected docs in line," not optional polish.
- If a task is documentation-only, do not change product code, public interfaces, package metadata, or dependencies unless the user explicitly expands scope.
- Run `npm run format` before committing **any** deliverable, including a documentation-only or audit one. `prettier --check .` covers every tracked Markdown file, so a docs change can turn the gate red exactly as a code change can — which is how a red gate reached a branch once already (post-P9 audit §1: three separate runs skipped the gate P9.06 had added to CI). The remedy is a targeted `npx prettier --write <paths>` on the files you touched, never a repo-wide rewrite. CI runs the same check on ubuntu, windows, and macOS; `.gitattributes` (`* text=auto eol=lf`) is what keeps it from failing on line endings alone. Deliberately outside the gate: `tasks/` (see `docs/mdlint_v2/P12-consistency/06-process-boundary-tests.md` for why).
- **Markdown prose is not hard-wrapped.** `.prettierrc.json` sets `proseWrap: "never"`, so one paragraph is one line and the gate reflows it for you — never hand-wrap to a column, and never write a line break inside an inline code span or a list continuation. Machine-generated blocks stay exempt via `<!-- prettier-ignore -->` (see `scripts/generate-docs.mjs`). Before `proseWrap` was set, this convention was unwritten and the gate could not see a violation, so agents guessed wrap widths and re-wrapped by hand at real cost.
- When a change accepts a behavior instead of fixing it, record it in `docs/mdlint_v2/accepted-behaviors.md` in the same change, so the decision is stated rather than latent in a task file.
- **Tick the completion surface in the change that earns it.** The change that lands a task ticks that task's exit criteria; the change that lands a phase's _last_ task also sets the phase index `Status` and ticks the index criteria. A criterion nobody can perform is retired in place with its reason, never ticked and never left open. The full rule — the three index statuses, why the P0–P3 criteria are records rather than checklists, and the test that enforces it — is in [`docs/mdlint_v2/completion-surface.md`](docs/mdlint_v2/completion-surface.md).
