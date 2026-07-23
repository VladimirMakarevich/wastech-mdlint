# Keep AI context files lean

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** `CLAUDE.md`/`AGENTS.md` and their eager-import (`@path`) closures stay within a token
budget, so agents don't blow their context window.

```jsonc
{
  "rules": [
    { "rule": "SIZE-001", "options": {
      "tokens": { "warn": 8000, "error": 16000 },
      "overrides": [ { "pattern": "docs/reference/**", "tokens": { "warn": 20000, "error": 40000 } } ]
    } },
    { "rule": "LLM-001", "options": {
      "entrypoints": ["CLAUDE.md", "AGENTS.md"],
      "maxTokensPerEntrypoint": 20000
    } }
  ]
}
```

```bash
wastech-mdlint lint . --fail-on warning   # surface budgets before they become errors
```

**You get:** per-file byte/line/token warnings and errors ([SIZE-001](../rules/SIZE-001.md)), and a
per-entrypoint total that sums the whole `@import` closure ([LLM-001](../rules/LLM-001.md)). See
also [Concepts → token estimation](../concepts.md).
