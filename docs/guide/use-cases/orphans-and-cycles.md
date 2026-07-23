# Find orphan and circular documents

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** no document is unreachable (orphan) and there are no reference cycles; get a reading order.

```jsonc
{
  "rules": [
    { "rule": "GRP-001" },                                            // no cycles
    { "rule": "GRP-002", "options": { "entryPoints": ["README.md", "docs/index.md"] } }
  ]
}
```

```bash
wastech-mdlint lint .                    # flags cycles (error) and orphans (warning)
wastech-mdlint graph . --format human    # clusters, hubs, reading order, coverage
wastech-mdlint graph . --format mermaid  # a diagram to paste into docs
```

**You get:** cycle and orphan findings ([GRP-001](../rules/GRP-001.md),
[GRP-002](../rules/GRP-002.md)) plus a navigable overview from the [`graph`](../context-graph.md)
command.
