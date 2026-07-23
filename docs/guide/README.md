# wastech-mdlint — User Guide

`wastech-mdlint` is a deterministic, **local-first** linter and analysis toolkit for the Markdown
context in a repository — `README.md`, `CLAUDE.md`, `AGENTS.md`, requirements tables, and
`skills/**/SKILL.md`-style files. It runs a registry-driven rule engine over a single Markdown
parse pass, builds a context graph of how documents reference each other, and can compile a
project-specific agent skill.

This guide is the full reference. For a one-page summary see the top-level [README](../../README.md);
for the design/roadmap see [docs/mdlint_v2](../mdlint_v2/index.md).

> These files are **hand-maintained**. The machine-generated rule table and MCP tool inventory
> live in the top-level [README](../../README.md) (produced by `npm run generate:docs`); this
> guide adds the prose, examples, and per-rule pages around them.

## Start here

- [Getting started](getting-started.md) — install, build, and run your first lint.
- [Use cases](use-cases/README.md) — task-driven recipes for common goals (one page per scenario).
- [CLI reference](cli.md) — every command, flag, and exit code.
- [Configuration](configuration.md) — how the config file is found, loaded, and validated.
- [Annotated config reference](config-reference.md) — one config with **every** option, commented.

## Capabilities

| Area | What it does | Doc |
| --- | --- | --- |
| **Rules & rule engine** | 24 built-in rules + a declarative `custom` rule over one parse pass. | [Rules](rules/README.md) |
| **Configuration** | JSONC config, local `$schema`, per-rule severity/options, shared settings. | [Configuration](configuration.md) |
| **Context graph** | `graph` / `slice` / `impact` over the reference graph between documents. | [Context graph](context-graph.md) |
| **Context compiler** | `compile` generates a deterministic `SKILL.md` from the graph + rules + config. | [Compile](compile.md) |
| **MCP server** | 6 read-only stdio tools exposing the same pipeline to AI agents. | [MCP server](mcp-server.md) |
| **Agent skills** | 3 hand-authored, host-neutral Agent Skills (`-init`, `-fix`, `-impact`). | [Skills](skills.md) |
| **Inline suppression** | `disable` / `disable-next-line` directives per rule. | [Suppression](suppression.md) |
| **Output & exit codes** | Text and JSON reports; CI-friendly exit codes. | [Output](output.md) |
| **Concepts** | Parse model, determinism, path handling, token estimation. | [Concepts](concepts.md) |

## Rules at a glance

24 built-in rules across 8 categories, plus the declarative `custom` rule. See the
[rules index](rules/README.md) for the full table with a page per rule.

- **TBL** (tables) — [TBL-001](rules/TBL-001.md) … [TBL-006](rules/TBL-006.md)
- **SEC** (sections) — [SEC-001](rules/SEC-001.md) … [SEC-003](rules/SEC-003.md)
- **STR** (structure) — [STR-001](rules/STR-001.md)
- **REF** (references) — [REF-001](rules/REF-001.md) … [REF-006](rules/REF-006.md)
- **CTX** (content quality) — [CTX-001](rules/CTX-001.md) … [CTX-003](rules/CTX-003.md)
- **GRP** (graph integrity) — [GRP-001](rules/GRP-001.md) … [GRP-003](rules/GRP-003.md)
- **SIZE** / **LLM** (context hygiene) — [SIZE-001](rules/SIZE-001.md) · [LLM-001](rules/LLM-001.md)
- **custom** (declarative) — [custom](rules/custom.md)

## Design boundaries

- **Local & deterministic.** No external HTTP link checking, no network, no timestamps in output.
- **No code execution.** Config is data-only JSONC; custom rules compose a closed primitive
  vocabulary — no `.ts`/`.cjs`/`.mjs` config and no user-code plugins.
- **Cross-platform.** Reports use repository-relative POSIX paths on Windows, macOS, and Linux.
