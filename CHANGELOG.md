# Changelog

All notable changes to this project are documented here. The three packages — `@wastech-mdlint/core`, `@wastech-mdlint/cli`, and `@wastech-mdlint/mcp-server` — are published together at one version from a single `vX.Y.Z` tag, and the three Agent Skills are tagged with them, so one entry below describes all of them.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

First public release.

### Linting

- A registry-driven rule engine over a single Markdown parse pass, with 22 built-in rules across `TBL` (tables), `SEC` and `STR` (sections and structure), `REF` (references), `CTX` (content quality), and `GRP` (graph integrity), plus `SIZE-001` (byte, line, and token budgets) and `LLM-001` (eager-import budget).
- A declarative `custom` rule that composes a closed vocabulary of assertion primitives from configuration — no rebuild and no code execution.
- Per-rule severity, inline-disable directives, `--fix` for the deterministic fixes, text or JSON output, and CI-friendly exit codes.

### Context graph

- `graph`, `slice`, and `impact` commands over one shared `ContextGraph`: semantic edges, cycle detection, connected components, a topological reading order with the nodes a cycle excluded from it, and a coverage signal for Markdown files linked to but outside the corpus.

### Compile

- `compile` renders a project-specific `SKILL.md` from the repository's own documentation, deterministically, so the artifact can be diffed and cached by content.

### Configuration

- JSONC `wastech-mdlint.config.json` with a local `$schema` that resolves offline against the installed package, so an editor validates against the version actually present.
- `init` scans a repository, infers a configuration, and discloses what it excluded and why — including the counts for directories it pruned, so a corpus smaller than the tracked file list is explained rather than silent.
- With no configuration file at all, the CLI lints every Markdown file outside the always-excluded dependency and build trees with an empty ruleset, which is a clean pass.

### MCP server

- A stdio-only Model Context Protocol host over the same core pipeline, with six read-only tools: `lint`, `lint-files`, `context-graph`, `context-slice`, `impact-analysis`, and `compile-context`. No HTTP or SSE transport, and no code-plugin execution.

### Agent skills

- Three host-neutral skills — `wastech-mdlint-init`, `wastech-mdlint-fix`, and `wastech-mdlint-impact` — carrying no host-specific command-injection syntax, with each one's `compatibility` field pinned to this CLI version.

### Platform

- Node.js `>=24.17.0`, with no upper bound.
- Windows, macOS, and Linux are all supported: paths in public output are normalized to repository-relative POSIX form, ordering uses a code-point comparator rather than locale collation, and every product file is written through an atomic temp-and-rename path so a failed write cannot truncate an existing file.
- All analysis is local. No external HTTP link checking, no link cache, no remote schema resolution, and no install-time file writes.

[unreleased]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VladimirMakarevich/wastech-mdlint/releases/tag/v0.1.0
