# Author a project-specific rule without writing code

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** a rule the built-ins don't cover — "every row in the ownership table must name an Owner"
— expressed declaratively.

```jsonc
{
  "rules": [
    {
      "rule": "custom",
      "id": "OWN-REQUIRED",
      "description": "Every ownership-table row must have an Owner",
      "severity": "error",
      "target": "table",
      "options": {
        "files": ["docs/ownership/**/*.md"],
        "assert": { "kind": "columnNotEmpty", "column": "Owner" }
      }
    }
  ]
}
```

```bash
wastech-mdlint lint docs/ownership
```

**You get:** a named finding (`OWN-REQUIRED`) with no rebuild and no code execution — the
[`custom`](../rules/custom.md) rule composes a closed assertion vocabulary (13 kinds covering
tables, sections, content, checklists, links). The `id` must be namespaced and must not shadow a
built-in prefix.
