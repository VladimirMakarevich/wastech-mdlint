# Architecture Rules

The architectural source of truth is `docs/mdlint_v2/`, especially:

- `docs/mdlint_v2/index.md`
- `docs/mdlint_v2/requirements/`
- `docs/mdlint_v2/decisions/core-hosts-the-pipeline.md`

For the vocabulary these invariants use — `ParsedDocument`, `ContextGraph`, edge types,
rule scopes, hosts, and the rest — see the glossary at `docs/mdlint_v2/glossary.md`. Use its
terms consistently and keep it current when an architectural change adds or renames one.

These invariants should guide implementation work.

## Current vs Target State

- The current repository still contains current single-package single-package code in `src/`.
- The target architecture is an npm-workspaces monorepo with:
  - `@wastech-mdlint/core`
  - `@wastech-mdlint/cli`
  - `@wastech-mdlint/mcp-server`
- Do not fake future package boundaries before the relevant roadmap phase. Follow the actual
  filesystem for today's edits and the phase plan for tomorrow's shape.

## Core Ownership

- Core owns the parsing pipeline, config loading, lint orchestration, graph construction,
  compile logic, and result formatting.
- CLI and MCP are thin host adapters over core. They must not fork or duplicate the core
  pipeline.
- Host-specific behavior belongs at the boundary:
  - CLI: argument parsing, command dispatch, exit codes, file output
  - MCP: tool registration, input validation, structured output, error wrapping
- Shared computational behavior belongs in core, not in host packages.

This is enforced by the accepted decision in
`docs/mdlint_v2/decisions/core-hosts-the-pipeline.md`.

## Pipeline Invariants

- One Markdown parse pass should produce the `ParsedDocument` data needed by rules, graph,
  compile, and inline suppression handling.
- The rule engine is registry-driven: rule metadata, options schema, scope, default severity,
  structured findings, and optional fixes are defined centrally.
- Declarative custom rules are data-driven. Do not introduce runtime user-code execution or code
  plugins into v2 work unless the roadmap explicitly changes.
- `ContextGraph` is shared infrastructure. Graph-aware rules, `graph`, `slice`, `impact`, MCP
  tools, and compile analysis should reuse the same graph and query layer.
- Generated output must be deterministic: stable sorting, normalized repo-relative POSIX paths,
  no timestamp-driven churn.

## Config And Surface Rules

- v2 config is JSONC in `wastech-mdlint.config.json`.
- v2 config uses a local `$schema`; do not introduce remote schema URLs.
- `.cjs`, `.mjs`, and runtime TypeScript config loading are legacy single-package concerns, not target v2
  behavior.
- MCP in v2 stays stdio-only and read-only for its six shipped tools.
- External HTTP link checking, external link caches, LSP, and docs-site work are outside the v2
  core scope unless explicitly requested.

## Phase Discipline

- Follow the roadmap order `P0` → … → `P8`, then the post-audit phases `P9` (code
  remediation) and `P10` (docs/tests consistency), then the terminal `P-release`, unless the
  user asks for a different slice.
- Within a phase, respect each task file's `Previous`, `Next`, `Depends on`, and `Blocks`
  chain.
- If the roadmap and a task file disagree on a load-bearing detail, use the more specific task
  file and surface the inconsistency.
- Known roadmap drift around built-in rule count should be treated explicitly:
  current phase files include `SEC-003`, so built-in rule work must account for it.

## What Not To Do

- Do not re-implement `lintFiles`, config loading, or result formatting in CLI or MCP.
- Do not create parallel graph traversal logic for rules vs commands vs MCP.
- Do not introduce non-deterministic reporting behavior.
- Do not add local agent skills, repo hooks, or other automation surfaces unless the task
  explicitly targets that scope.
- Do not guess future architecture from memory when `docs/mdlint_v2/` already states it.
