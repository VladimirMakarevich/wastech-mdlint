# Requirements → design → implementation traceability

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** every `REQ-*` referenced in design docs is defined in requirements, no reference dangles,
and IDs carry forward across pipeline stages. Also make ID references participate in graph checks.

```jsonc
{
  "settings": {
    "idRef": { "idPattern": "REQ-\\d+", "definitions": ["docs/requirements/**/*.md"], "idColumn": "ID" }
  },
  "rules": [
    { "rule": "REF-005", "options": {
      "definitions": ["docs/requirements/**/*.md"],
      "references": ["docs/design/**/*.md"],
      "idColumn": "ID",
      "idPattern": "REQ-\\d+"
    } },
    { "rule": "GRP-003", "options": {
      "chain": [
        { "stage": "requirements", "files": ["docs/requirements/**/*.md"], "idColumn": "ID", "refColumn": "ID" },
        { "stage": "design",       "files": ["docs/design/**/*.md"],       "idColumn": "ID", "refColumn": "Requirement" }
      ]
    } }
  ]
}
```

```bash
wastech-mdlint lint .
```

**You get:** dangling references (error) and unreferenced definitions (warning) from
[REF-005](../rules/REF-005.md), dropped IDs between stages from [GRP-003](../rules/GRP-003.md), and
— because of [`settings.idRef`](../configuration.md#settingsidref) — ID edges that also feed
cycle/orphan checks. See [Context graph](../context-graph.md).
