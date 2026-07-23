# Enforce a standard document template (ADRs, READMEs)

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** every ADR has the required sections in a fixed order and matches a template; the repo
has its mandatory top-level files.

```jsonc
{
  "rules": [
    { "rule": "SEC-001", "options": {
      "sections": ["Context", "Decision", "Consequences"],
      "files": ["docs/adr/**/*.md"]
    } },
    { "rule": "SEC-002", "options": {
      "order": ["Context", "Decision", "Consequences"],
      "files": ["docs/adr/**/*.md"]
    } },
    { "rule": "SEC-003", "options": { "template": "docs/adr/_template.md" } },
    { "rule": "STR-001", "options": { "files": ["README.md", "CONTRIBUTING.md", "docs/adr/index.md"] } }
  ]
}
```

```bash
wastech-mdlint lint . --fix    # SEC-001 scaffolds any missing section (heading + TODO body)
```

**You get:** missing/mis-ordered sections and template drift flagged; `--fix` scaffolds the gaps
for you to fill. See [SEC-001](../rules/SEC-001.md), [SEC-002](../rules/SEC-002.md),
[SEC-003](../rules/SEC-003.md), [STR-001](../rules/STR-001.md).
