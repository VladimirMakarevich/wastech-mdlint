# Architecture Rules

These invariants govern implementation work. They are stated here in full; the code and its tests are the only place to verify that they still hold.

## Package Layout

An npm-workspaces monorepo. All product code lives under `packages/*`; there is no root `src/`.

- `@wastech-mdlint/core` — the engine.
- `@wastech-mdlint/cli` — the CLI host. Bin: `wastech-mdlint`.
- `@wastech-mdlint/mcp-server` — the stdio MCP host. Bin: `wastech-mdlint-mcp`.

## Core Ownership

- Core owns the parsing pipeline, config loading, lint orchestration, graph construction, compile logic, and result formatting.
- CLI and MCP are thin host adapters over core. They must not fork or duplicate the core pipeline.
- Host-specific behavior belongs at the boundary:
  - CLI: argument parsing, command dispatch, exit codes, file output.
  - MCP: tool registration, input validation, structured output, error wrapping.
- Shared computational behavior belongs in core, not in host packages.

The reason is not tidiness. Two hosts that each compute an answer will eventually compute two different answers, and because each package's own tests pass, nothing reports the divergence — which is why a cross-host parity guard exists in the test suite as well.

## Pipeline Invariants

- One Markdown parse pass produces the `ParsedDocument` data that rules, graph, compile, and inline suppression handling all read. Nothing re-parses Markdown ad hoc.
- The rule engine is registry-driven: rule metadata, options schema, scope, default severity, structured findings, and optional fixes are defined centrally.
- Declarative custom rules are data-driven, closed over a fixed primitive vocabulary. No runtime user-code execution and no code plugins.
- `ContextGraph` is shared infrastructure. Graph-aware rules, the `graph`, `slice` and `impact` commands, MCP tools, and compile analysis reuse the same graph and query layer.
- Output is deterministic: stable sorting, normalized repository-relative POSIX paths, no timestamp-driven churn, no locale-dependent collation.

## Config And Surface Rules

- Config is JSONC in `wastech-mdlint.config.json`.
- Config uses a local `$schema` — a relative path into the installed package, never a URL. Schema resolution stays offline and version-matched, so an editor validates against the version actually installed rather than whatever the network serves.
- No `.cjs`, `.mjs`, or runtime TypeScript config loading.
- MCP stays stdio-only, and its six shipped tools stay read-only.
- External HTTP link checking, external link caches, LSP, and docs-site work are outside scope unless explicitly requested.

## What Not To Do

- Do not re-implement `lintFiles`, config loading, or result formatting in CLI or MCP.
- Do not create parallel graph traversal logic for rules versus commands versus MCP.
- Do not introduce non-deterministic reporting behavior.
- Do not add local agent skills, repo hooks, or other automation surfaces unless the task explicitly targets that scope.
- Do not add broad abstractions before there is a concrete need for them.
