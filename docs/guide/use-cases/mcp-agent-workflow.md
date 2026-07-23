# Drive the linter from an AI agent (MCP)

> [Guide](../README.md) · [Use cases](README.md) · [MCP server](../mcp-server.md)

**Goal:** an AI coding agent, connected to the [MCP server](../mcp-server.md), safely reviews and
edits the repo's docs using the same deterministic analysis the CLI runs — read-only, over stdio.

First register the server in the host (once):

```jsonc
// .mcp.json (Claude Code) or claude_desktop_config.json (Claude Desktop)
{
  "mcpServers": {
    "wastech-mdlint": { "command": "npx", "args": ["-y", "@wastech-mdlint/mcp-server"] }
  }
}
```

Then the agent works through a task. Tool calls below show the exact arguments each tool accepts;
all 6 tools are read-only. Optional `cwd`/`configPath` default to the process cwd and discovered
config.

**Step 1 — lint a draft before writing it to disk.** The agent drafted a section and checks it
against explicit rules *without* touching the filesystem (the `lint` tool takes literal content):

```jsonc
// tool: lint
{
  "content": "# API\n\n## Overview\n\nTODO\n",
  "rules": [
    { "rule": "CTX-001" },
    { "rule": "SEC-001", "options": { "sections": ["Overview", "Usage"] } }
  ]
}
// → { messages: [ {ruleId:"SEC-001",…"missing Usage"}, {ruleId:"CTX-001",…"placeholder"} ],
//     errorCount: 1, warningCount: 1 }
```

The agent fills in `Usage` and replaces the `TODO` before saving.

**Step 2 — lint the whole project after editing.** Uses the resolved config (or the zero-config
`**/*.md` default):

```jsonc
// tool: lint-files
{ "patterns": ["docs/**/*.md"] }
// → { messages: [...], files: ["docs/..."], errorCount: 0, warningCount: 2 }
```

**Step 3 — check the blast radius before a risky change.** The agent is asked to rewrite
`docs/requirements/auth.md` and first learns what depends on it:

```jsonc
// tool: impact-analysis
{ "file": "docs/requirements/auth.md" }
// → { file: "...", directlyAffected: [ {path:"docs/design/login.md", references:2} ],
//     transitivelyAffected: [ {path:"docs/design/session.md", depth:2, via:"docs/design/login.md"} ],
//     readingOrder: [...], excluded: [] }
```

Now the agent knows to update `login.md`/`session.md` too. (A file outside the corpus returns an
actionable error rather than empty output.)

**Step 4 — understand structure and reading order.** For a summary view of clusters and order:

```jsonc
// tool: context-graph
{ "format": "summary" }
// → { nodes:[{path,inDegree,outDegree}], edges:[...], components:[...], readingOrder:[...] }
```

Or a focused forward slice from an entry point or ID (exact match only — ID, `#slug`, or path):

```jsonc
// tool: context-slice
{ "query": "docs/index.md", "depth": 2 }
// → { query:"docs/index.md", starts:["docs/index.md"], files:[...],
//     visited:[ {path:"docs/setup.md", depth:1, via:"docs/index.md"} ] }
```

**Step 5 — load compact project context.** The agent pulls a deterministic `SKILL.md` summary of
the docs (requires a `compile` section in config):

```jsonc
// tool: compile-context
{}
// → two text blocks: the SKILL.md content + a Documents/Rules/Components metadata line
```

**You get:** an agent that lints drafts and files, reasons about change impact and structure, and
loads accurate context — all through 6 read-only stdio tools that reuse the exact core pipeline the
CLI uses, so results match `wastech-mdlint` on the command line. Errors come back as a structured
`{ code, message, hint }`. For a fully guided workflow, install the hand-authored
[`-init`/`-fix`/`-impact` skills](../skills.md), which orchestrate these tools. See the
[MCP server reference](../mcp-server.md) for the full tool list and contracts.
