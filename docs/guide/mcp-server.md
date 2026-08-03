# MCP server

> [Guide index](README.md) · [CLI reference](cli.md) · [Configuration](configuration.md)

[`@wastech-mdlint/mcp-server`](../../packages/mcp-server) (bin `wastech-mdlint-mcp`) is a **stdio-only** Model Context Protocol host over the same core pipeline the CLI uses. It exposes **6 read-only tools** — no HTTP/SSE transport, no mutating tools, no code-plugin execution. A `fix`/`schema` pair is planned for a later release; v2 ships exactly these 6.

## Run it

```bash
npx @wastech-mdlint/mcp-server        # run directly, no install
npm i -D @wastech-mdlint/mcp-server   # or install the wastech-mdlint-mcp bin
```

Add it to any stdio-based MCP host (Claude Code's `.mcp.json`, Claude Desktop's `claude_desktop_config.json`, etc.):

```jsonc
{
  "mcpServers": {
    "wastech-mdlint": {
      "command": "npx",
      "args": ["-y", "@wastech-mdlint/mcp-server"],
    },
  },
}
```

Readiness is announced on stderr; stdout carries only the protocol.

## The 6 tools

| Tool | What it does | Structured output |
| --- | --- | --- |
| `lint` | Lint ad-hoc Markdown content against an explicit set of built-in or declarative `custom` rules; it does not load project config. | yes |
| `lint-files` | Lint the project's Markdown files using the resolved config (or the zero-config `**/*.md` default). | yes |
| `context-graph` | Build the project's context graph; `format: "json"` (default) returns raw nodes/edges/cycles, `format: "summary"` returns nodes/edges/components/reading order. | yes |
| `context-slice` | Files reachable within `depth` hops of a resolved query (exact match against IDs, heading/anchor slugs, file paths — no fuzzy/keyword/LLM matching). | yes |
| `impact-analysis` | Blast radius of changing a file: direct + transitive dependents and the reading order over the affected subgraph. A file not in the corpus returns an actionable error. | yes |
| `compile-context` | Compile the project skill (`SKILL.md`) from `config.compile`; same deterministic output as the CLI `compile`. Requires `config.compile`. | no (two text blocks) |

All 6 carry a `readOnlyHint` annotation. Five return `structuredContent` + an `outputSchema`; `compile-context` returns two plain-text content blocks instead.

## Error contract

MCP errors use a structured `{ code, message, hint }` contract, with sanitized `INTERNAL_ERROR` messages. The CLI maps the same core error taxonomy to stderr + exit codes, so both hosts behave consistently — they are thin adapters over one pipeline, not separate implementations.

One limit is worth knowing: the contract covers failures the tool itself detects. An argument shape that the tool's advertised `inputSchema` rejects outright — a misspelled `assert.kind`, an unknown key, a bad `severity` value — is refused by the MCP protocol layer before the tool runs, so it comes back as the protocol's own validation text without a `{ code, message, hint }` payload. That message still names the offending path and the values it expected, and the mistakes that need guiding advice (an incomplete `custom` entry, an unknown rule ID, invalid rule options) are deliberately let through to the tool so they can carry it.

## Boundaries

- **stdio only**, **read-only**, **local** — no network, no external HTTP link checking.
- The ad-hoc `lint` tool does not load project config. File-resolving rules such as [REF-001](rules/REF-001.md)/[REF-003](rules/REF-003.md), [SEC-003](rules/SEC-003.md) and [STR-001](rules/STR-001.md) may probe or read paths **inside** the server's working directory; an absolute path or a `..`-escaping relative path is rejected rather than followed. The tool takes its whole `rules` array from the caller, so this containment is what keeps a read-only linter from becoming a host file-read primitive for a caller acting on untrusted input.
- A `rules` entry is either a built-in rule id or a full declarative [custom rule](rules/custom.md) — `{ "rule": "custom", "id": …, "options": { "assert": … } }`. Those are pure data; no code plugin is ever loaded. The content is linted as one synthetic document named `content.md`, so an `options.files`/`exclude` glob that does not match that path selects nothing, and a project-scope assert such as `columnUnique` only sees duplicates inside that one document.
