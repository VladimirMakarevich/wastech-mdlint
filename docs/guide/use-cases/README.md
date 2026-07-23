# Use cases

> [Guide index](../README.md) · [Configuration](../configuration.md) · [Annotated config](../config-reference.md) · [Rules index](../rules/README.md)

Task-driven recipes: each page starts from a real goal, shows the config and commands, and says
what you get. Configs are fragments — merge the `rules` entries you need into one
[`wastech-mdlint.config.json`](../configuration.md). Every rule referenced has a
[detailed page](../rules/README.md).

| # | Use case | Primary features |
| --- | --- | --- |
| 1 | [Enforce a requirements-table schema](requirements-table-schema.md) | TBL-001…006 |
| 2 | [Keep documentation links and images healthy in CI](link-and-image-health.md) | REF-001/002/003 |
| 3 | [Enforce a standard document template](document-template.md) | SEC-001/002/003, STR-001 |
| 4 | [Keep AI context files lean](ai-context-budgets.md) | SIZE-001, LLM-001 |
| 5 | [Requirements → design → implementation traceability](id-traceability.md) | REF-005, GRP-003, `settings.idRef` |
| 6 | [Find orphan and circular documents](orphans-and-cycles.md) | GRP-001/002, `graph` |
| 7 | [Guard content quality](content-quality.md) | CTX-001/002/003 |
| 8 | [Author a project-specific rule without code](custom-rule.md) | `custom` |
| 9 | [Understand the blast radius before editing](change-impact.md) | `impact`, `slice` |
| 10 | [Adopt the linter and wire it into CI](adopt-and-ci.md) | `init`, `--fail-on`, exit codes |
| 11 | [Feed accurate project context to an AI agent](ai-context-skill.md) | `compile`, MCP |
| 12 | [Drive the linter from an AI agent (MCP)](mcp-agent-workflow.md) | 6 MCP tools |

## See also

- [Rules index](../rules/README.md) — every rule with options and examples.
- [Annotated config reference](../config-reference.md) — every option in one commented file.
- [CLI reference](../cli.md) · [Context graph](../context-graph.md) · [Compile](../compile.md) · [MCP server](../mcp-server.md)
