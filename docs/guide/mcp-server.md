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
| `lint` | Lint ad-hoc Markdown content against an explicit set of built-in or declarative `custom` rules; it does not load project config. Returns `{ messages, errorCount, warningCount }` — no `files` list, because one caller-supplied string is not a corpus. | yes |
| `lint-files` | Lint the project's Markdown files using the resolved config (or the zero-config `**/*.md` default). An explicit `patterns` argument replaces `include` only — the [default `exclude`](configuration.md#what-is-excluded-before-you-write-anything) still applies, so `patterns` aimed inside `node_modules`, build output or a dependency tree such as `.venv` returns an empty corpus. Returns the lint record verbatim: `{ messages, files, errorCount, warningCount }`. | yes |
| `context-graph` | Build the project's context graph; `format: "raw"` (default) returns the graph verbatim (nodes/edges/cycles), `format: "summary"` returns nodes/edges/components/reading order/excluded/coverage — the same document the CLI's [`graph --format json`](cli.md#graph) prints. `format: "json"` is not accepted: it named the raw branch here and the summary document on the CLI, so it was retired (a call still passing it is [refused before the handler runs](#error-contract)). | yes |
| `context-slice` | Files reachable within `depth` hops of a resolved query (exact match against IDs, heading/anchor slugs, file paths — no fuzzy/keyword/LLM matching). | yes |
| `impact-analysis` | Blast radius of changing a file: direct + transitive dependents and the reading order over the affected subgraph. A file not in the corpus returns an actionable error. | yes |
| `compile-context` | Compile the project skill (`SKILL.md`) from `config.compile`; same deterministic output as the CLI `compile`. Requires `config.compile`. | no (two text blocks) |

All 6 carry a `readOnlyHint` annotation. Five return `structuredContent` + an `outputSchema`; `compile-context` returns two plain-text content blocks instead.

Neither lint tool wraps its counts in the `summary` the CLI's `lint --format json` uses — both put them at the top level. `messages` is the same finding shape on every surface; [Output & exit codes](output.md#where-each-host-puts-the-findings) tabulates all four payloads and documents every key a finding carries, including `helpUri`, which is the reporting rule's documentation URL.

## Error contract

MCP errors use a structured `{ code, message, hint }` contract, with sanitized `INTERNAL_ERROR` messages. The CLI maps the same core error taxonomy to stderr + exit codes, so both hosts behave consistently — they are thin adapters over one pipeline, not separate implementations.

The payload lives in `structuredContent`, and the text block carries `message` plus `hint` together — a host that renders only `content[].text` still sees the actionable half, so a mistyped rule id reads `Unknown rule "REF-01". Did you mean "REF-001"?` there, matching what the CLI prints. `hint` is optional by design: an unknown id with no near-miss carries a code and a message only.

Something the tool could not read — an unreadable directory, an unreadable config — is `OPERATIONAL_ERROR`, naming the errno and the path relative to that tool's `cwd`, which is the same sentence the CLI prints before exiting `2`. See [Output & exit codes](output.md#operational-failures-on-both-hosts) for the shape on both hosts and for the two cases MCP sanitizes instead of naming.

That consistency includes the `cwd` argument the five file-based tools accept. A `cwd` that does not exist, that points at a file rather than a directory, or that is present but **empty** is rejected with `INVALID_INPUT` naming the resolved path with `/` separators on every host — it is **not** answered with an empty result. The empty case is called out because it is the one that looks like an omission and is not: `"cwd": ""` would otherwise resolve to the server's own working directory and analyze that. This matches the CLI, which exits `2` on a nonexistent target path for the same reason: an empty corpus is indistinguishable from a clean repository, so `lint-files` reporting `No problems found.` for a mistyped directory would be a plausible answer to a different question. Omit `cwd` to analyze the server's own working directory.

It includes their `configPath` too: a relative one is resolved against that tool's `cwd`, never against the server process's working directory — the same rule the CLI follows for `--config` ([CLI reference](cli.md#lint-default)). An absolute `configPath` is used as given; a missing one comes back as `CONFIG_NOT_FOUND` naming the path relative to that `cwd`, which for a relative `configPath` is the string you passed.

One limit is worth knowing, and it is deliberate: **the contract covers failures the tool itself detects.** An argument shape that the tool's advertised `inputSchema` rejects outright — a misspelled `assert.kind`, an unknown key, a bad `severity` value, a negative `depth` — is refused by the MCP protocol layer before the tool runs, so it comes back as `isError: true` with **no `structuredContent` at all** and the protocol's own validation text, which carries the JSON-RPC error number:

```text
MCP error -32602: Input validation error: Invalid arguments for tool context-slice: [
  {
    "origin": "number",
    "code": "too_small",
    "minimum": 0,
    "inclusive": true,
    "path": ["depth"],
    "message": "Too small: expected number to be >=0"
  }
]
```

That text still names the offending field and the constraint or valid set, so a human or a model can fix the call — but the `code` it carries is the validator's, not this contract's, and a host branching on `{ code, message, hint }` sees nothing. **Branch on `isError` with `structuredContent` absent** to detect this case.

Closing it would mean loosening every tool's `inputSchema` to accept shapes it intends to reject, purely so the handler could reject them better — and that schema is what a host or model reads to _construct_ a valid call in the first place. So the loosening is selective, aimed only where guidance pays: the mistakes that need it (an incomplete `custom` entry, an unknown rule ID, invalid rule options) are deliberately let through to the tool so they can carry a `{ code, message, hint }` payload.

## Boundaries

- **stdio only**, **read-only**, **local** — no network, no external HTTP link checking.
- The ad-hoc `lint` tool does not load project config. File-resolving rules such as [REF-001](rules/REF-001.md)/[REF-003](rules/REF-003.md), [SEC-003](rules/SEC-003.md) and [STR-001](rules/STR-001.md) may probe or read paths **inside** the server's working directory; an absolute path or a `..`-escaping relative path is rejected rather than followed. The tool takes its whole `rules` array from the caller, so this containment is what keeps a read-only linter from becoming a host file-read primitive for a caller acting on untrusted input.
- A `rules` entry is either a built-in rule id or a full declarative [custom rule](rules/custom.md) — `{ "rule": "custom", "id": …, "options": { "assert": … } }`. Those are pure data; no code plugin is ever loaded. The content is linted as one synthetic document named `content.md`, so an `options.files`/`exclude` glob that does not match that path selects nothing, and a project-scope assert such as `columnUnique` only sees duplicates inside that one document.
