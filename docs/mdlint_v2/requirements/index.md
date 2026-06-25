# v2 Requirements

These documents are the locked outcome of a point-by-point requirements pass (2026-06-21).
They are authoritative wherever the plan is otherwise ambiguous, and they feed the phase
task files of the [v2 roadmap](../index.md).

## Documents

| # | Area | Roadmap phase(s) | Headline changes |
| --- | --- | --- | --- |
| [01](01-configuration.md) | Configuration | P2, P6 | Top-level `exclude`, per-rule `severity`/`off`, canonical rule IDs, JSONC, shared `settings.siteRouter`, diagnostics, `respectGitignore`, **local-only `$schema`**. |
| [02](02-rules-engine.md) | Rules & rule engine | P2, P3 | Severity in orchestrator, **`--fix` hook**, structured findings, fail-fast, unified `ContextGraph`, single rule-metadata source, shared scoping, inline-disable, **declarative custom rules**. |
| [03](03-context-graph.md) | Context graph & search | P1, P4 | **Semantic edges (ID/anchor/import)**, unified query layer, edge metadata, honest deterministic search, coverage signal, explicit cycles, Mermaid/DOT export. |
| [04](04-skills-compile.md) | Skills & compile | P5, P8 | Frontmatter schema, **host-neutral generated commands**, deterministic output, unified skill model, context-budget in skill, host-neutral static skills, `-fix` delegates to `--fix`. |
| [05](05-mcp-server.md) | MCP server | P7 | **Structured output**, honest descriptions, modular server, stdio integration tests, error contract, safety annotations, stdio-only + no code-plugins. |
| [06](06-installation.md) | Installation & distribution | P6, P9 | No `postinstall`, **smart CLI `init`**, local schema wiring, single-tag release, supply chain, first-class GitHub Action, skill pinning. |

## Deferred / backlog (recorded, not in v2)

- **C6** presets/`extends` (config) — revisit with `init`'s rule set.
- **G7** duplicate-edge collapsing, **G8** incremental/cached graph rebuild.
- **R9 Tier-2** local code-plugins (interface kept open; declarative custom rules ship).
- **S3** scaffold localization (skipped), **S9** 4th skill (`-compile`/`-review`).
- **M5** MCP `fix`/`schema` tools.
- **I8** config migration — not needed (greenfield).

## Cross-cutting threads

- **Single source of truth** for rule/tool metadata → generates `schema.json`, README, MCP
  tool list, `describeRules` (R6, M3).
- **Determinism** everywhere (sorted output, no timestamps) — config, graph, compile, MCP.
- **No remote dependencies** at runtime: local `$schema` (C9), no external link checks, no
  code-plugins in MCP (M8/R9).
- **One graph** powers slice/impact/compile/graph-rules (G1/G2/R5).
- **`--fix` engine** (R2) flows into the CLI, the `-fix` skill (S8), and later MCP (M5).
