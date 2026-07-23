# Feed accurate project context to an AI agent

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** give an AI host a compact, accurate description of this repo's docs, and let it query the
same analysis the CLI runs.

```jsonc
{
  "compile": {
    "outdir": ".claude/skills/wastech-mdlint",
    "skill": { "name": "my-project-context", "description": "Docs context for my project" }
  }
}
```

```bash
wastech-mdlint compile --dry-run     # preview the generated SKILL.md
wastech-mdlint compile               # write it to the outdir
```

Or wire the [MCP server](../mcp-server.md) into the host so the agent can call `lint-files`,
`context-graph`, `context-slice`, `impact-analysis`, and `compile-context` directly — see
[Drive the linter from an AI agent (MCP)](mcp-agent-workflow.md).

**You get:** a deterministic project [`SKILL.md`](../compile.md) and/or six read-only MCP tools over
the same pipeline. The hand-authored [`-init`/`-fix`/`-impact` skills](../skills.md) orchestrate
these workflows for you.
