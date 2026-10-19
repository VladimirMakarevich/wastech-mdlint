# Changelog

All notable changes to this project are documented here. The three packages — `@wastech-mdlint/core`, `@wastech-mdlint/cli`, and `@wastech-mdlint/mcp-server` — are published together at one version from a single `vX.Y.Z` tag, and the Agent Skills are tagged with them, so one entry below describes all of them.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The default `exclude` gains `**/worktrees/**`, so every run — with or without a config — skips a directory named `worktrees` at any depth, and `init` no longer scans one for doc clusters. Agent tools such as Claude Code check out git worktrees inside the repository, under `.claude/worktrees/<name>/`, and each is a full second copy of every tracked document, so a lint reported every finding once more per worktree. Hand-written Markdown under a directory literally named `worktrees` is now skipped too; negate the default (`"!**/worktrees/**"`) in your own `exclude` to lint it.

## [0.2.0]

Breaking for anyone installing the Agent Skills by name, or relying on where `compile` writes by default — see Changed.

### Added

- `init` offers an agent rule: `.agents/rules/wastech-mdlint.md`, a page that tells coding agents how the repository's Markdown is linted, that an `error` is fixed rather than silenced, and that a `SIZE-001` or `LLM-001` budget is answered by splitting a document rather than by cutting its content — with a table of who decides on a split for each kind of file and the procedure for one. Interactive runs offer it with a default of no; `--with-agent-rule` writes it under `--yes`. Only the config's location and the CLI invocation are generated, so the page cannot go stale against the config; it is never overwritten once it exists, and it is not wired into `AGENTS.md` or `CLAUDE.md` for you — the write summary says where it went and how to reference it.
- A fourth Agent Skill, `mdlint-docs`, walks an agent through such a split: find the budget findings, decide who owns the split, plan it from the `impact` blast radius, split by meaning, and verify with `lint`.

### Changed

- The Agent Skills drop the `wastech-` prefix: `wastech-mdlint-init`, `wastech-mdlint-fix` and `wastech-mdlint-impact` are now `mdlint-init`, `mdlint-fix` and `mdlint-impact`, so a skill is shorter to install and to invoke. They keep the `mdlint-` part rather than becoming bare `init` or `fix`, which would collide with a host's own built-in commands and with other projects' skills. Install by the new name — `gh skill install VladimirMakarevich/wastech-mdlint mdlint-init --pin v0.2.0` — from this release on; tags up to `v0.1.3` still carry only the old names. The packages, the `wastech-mdlint` and `wastech-mdlint-mcp` binaries and the config file name are unchanged.
- `compile` writes to `.claude/skills/mdlint/` by default instead of `.claude/skills/wastech-mdlint/`, matching the shorter skill names. A config that sets `compile.outdir` is unaffected. One that relied on the default leaves the previous release's `SKILL.md` behind, and an agent host would load it as a second, stale copy of the same skill — so `compile` names that file in its output when it finds it, and leaves deleting it (or setting `compile.outdir` back to the old directory) to you.

## [0.1.3]

No functional changes: the published code is identical to `0.1.2`.

### Changed

- Every package now declares npm `keywords` and a description that names it as a Markdown linter. npm search matches a query against a package's name, description and keywords; the published manifests carried no keywords and descriptions without the words "lint" or "linter", so a search such as `markdown linter` or `md linter` did not return any of the three packages — only the literal `mdlint` did. Package metadata is read from the published manifest, so changing it takes a new version.

## [0.1.2]

### Security

- `@wastech-mdlint/core` now depends on `picomatch` directly instead of `micromatch`, which removes `braces` from every installation. `npm audit` reported `braces` as high severity ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): stack exhaustion on deeply nested brace patterns, no patched release), so every repository that installed the linter inherited five high-severity findings. The vulnerable code was never reachable from wastech-mdlint — the matching call it made into `micromatch` already went straight to `picomatch`, which compiles `{a,b}` itself — but the finding could not be cleared without dropping the dependency.

### Changed

- Glob matching keeps the same ordered semantics: a `!` entry subtracts what the entries before it selected, a later entry adds it back, and a list of nothing but negations starts from everything. The pattern compiler moves from `picomatch` 2 to `picomatch` 4, which changes two rare extglob forms: a repeated extglob whose branches are themselves `*(…)` sequences, such as `+(*(a)|*(b))`, now honors every branch instead of only the first; and a trailing `/**` inside an extglob group, such as `test(/utils/**)`, now also matches the directory itself.

## [0.1.1]

No functional changes: the published code is byte-identical to `0.1.0`.

What differs is how it was published. `0.1.0` was published by hand, because npm cannot register a trusted publisher for a package that does not yet exist in the registry — the first release of each package necessarily precedes the trust relationship that would authenticate a workflow to publish it. `0.1.1` is the first release published from CI, and therefore the first carrying a provenance attestation linking the tarball to the commit and workflow run that produced it. Prefer it over `0.1.0` for that reason alone.

## [0.1.0]

First public release. Published manually and carries no provenance attestation; see `0.1.1`.

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

[unreleased]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/VladimirMakarevich/wastech-mdlint/releases/tag/v0.1.0
