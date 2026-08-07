# @wastech-mdlint/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an agent read-only access to a repository's Markdown context: lint findings, the context graph, reachability slices, change impact, and a compiled skill.

**stdio only, read-only, six tools.** No HTTP or SSE transport, no mutating tools, no code-plugin execution. Every tool runs through [`@wastech-mdlint/core`](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/packages/core/README.md), the same pipeline the CLI uses — this package is the host adapter around it: tool registration, input validation, structured output, and error wrapping.

## Run it

```bash
npx @wastech-mdlint/mcp-server        # run directly, no install
npm i -D @wastech-mdlint/mcp-server   # or install the wastech-mdlint-mcp bin
```

Add it to any stdio-based MCP host (Claude Code's `.mcp.json`, Claude Desktop's `claude_desktop_config.json`, and so on):

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

Node.js `>=24.17.0`. Readiness is announced on stderr; stdout carries only the protocol, so nothing the server logs can corrupt a JSON-RPC frame.

## The six tools

| Tool | What it does |
| --- | --- |
| `lint` | Lint ad-hoc Markdown content against an explicit rule list. Does not load project config. |
| `lint-files` | Lint the project's Markdown files using the resolved config, or the zero-config default. |
| `context-graph` | Build the project's context graph — nodes, edges, cycles, or a summary document. |
| `context-slice` | The files reachable within `depth` hops of a query resolved by exact match. |
| `impact-analysis` | The blast radius of changing one file: direct and transitive dependents. |
| `compile-context` | Compile the project skill (`SKILL.md`) from `config.compile`. |

All six carry a `readOnlyHint` annotation. Five return `structuredContent` alongside an `outputSchema`; `compile-context` returns two plain-text content blocks instead.

The five file-based tools accept a `cwd`. A `cwd` that does not exist, or that names a file rather than a directory, is rejected with an actionable error rather than answered with an empty result — an empty corpus is indistinguishable from a clean repository, so a plausible-looking success would answer a different question than the one asked. Omit it to analyze the server process's own working directory.

## Errors

Tool failures use a structured `{ code, message, hint }` contract, carried in `structuredContent` with `message` and `hint` also rendered into the text block, so a host that shows only text still sees the actionable half.

One limit is deliberate: that contract covers failures the tool itself detects. An argument shape the tool's advertised `inputSchema` rejects outright is refused by the protocol layer before the tool runs, and comes back as a validation error with no `structuredContent` at all.

## Documentation

- [MCP server guide](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/mcp-server.md) — every tool's arguments, the full error contract, and host wiring
- [Project README](https://github.com/VladimirMakarevich/wastech-mdlint#readme) · [Configuration](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/configuration.md) · [Output & exit codes](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/output.md)

## License

MIT — see [LICENSE](./LICENSE).
