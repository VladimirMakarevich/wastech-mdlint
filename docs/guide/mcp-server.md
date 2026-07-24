# MCP server

> [Guide index](README.md) · [CLI reference](cli.md) · [Configuration](configuration.md)

[`@wastech-mdlint/mcp-server`](../../packages/mcp-server) (bin `wastech-mdlint-mcp`) is a
**stdio-only** Model Context Protocol host over the same core pipeline the CLI uses. It exposes
**6 read-only tools** — no HTTP/SSE transport, no mutating tools, no code-plugin execution. A
`fix`/`schema` pair is planned for a later release; v2 ships exactly these 6.

## Run it

```bash
npx @wastech-mdlint/mcp-server        # run directly, no install
npm i -D @wastech-mdlint/mcp-server   # or install the wastech-mdlint-mcp bin
```

Add it to any stdio-based MCP host (Claude Code's `.mcp.json`, Claude Desktop's
`claude_desktop_config.json`, etc.):

```jsonc
{
  "mcpServers": {
    "wastech-mdlint": { "command": "npx", "args": ["-y", "@wastech-mdlint/mcp-server"] }
  }
}
```

Readiness is announced on stderr; stdout carries only the protocol.

## The 6 tools

| Tool | What it does | Structured output |
| --- | --- | --- |
| `lint` | Lint ad-hoc Markdown content against an explicit set of rules; it does not load project config. | yes |
| `lint-files` | Lint the project's Markdown files using the resolved config (or the zero-config `**/*.md` default). | yes |
| `context-graph` | Build the project's context graph; `format: "json"` (default) returns raw nodes/edges/cycles, `format: "summary"` returns nodes/edges/components/reading order. | yes |
| `context-slice` | Files reachable within `depth` hops of a resolved query (exact match against IDs, heading/anchor slugs, file paths — no fuzzy/keyword/LLM matching). | yes |
| `impact-analysis` | Blast radius of changing a file: direct + transitive dependents and the reading order over the affected subgraph. A file not in the corpus returns an actionable error. | yes |
| `compile-context` | Compile the project skill (`SKILL.md`) from `config.compile`; same deterministic output as the CLI `compile`. Requires `config.compile`. | no (two text blocks) |

All 6 carry a `readOnlyHint` annotation. Five return `structuredContent` + an `outputSchema`;
`compile-context` returns two plain-text content blocks instead.

## Error contract

MCP errors use a structured `{ code, message, hint }` contract, with sanitized `INTERNAL_ERROR`
messages. The CLI maps the same core error taxonomy to stderr + exit codes, so both hosts behave
consistently — they are thin adapters over one pipeline, not separate implementations.

## Boundaries

- **stdio only**, **read-only**, **local** — no network, no external HTTP link checking.
- The ad-hoc `lint` tool does not load project config. File-resolving rules such as
  [REF-001](rules/REF-001.md)/[REF-003](rules/REF-003.md) and [SEC-003](rules/SEC-003.md) may probe
  or read paths relative to the server's working directory.
