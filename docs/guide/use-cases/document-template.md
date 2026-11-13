# Enforce a standard document template (ADRs, READMEs)

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** every ADR has the required sections in a fixed order and matches a template; the repo has its mandatory top-level files.

```jsonc
{
  "rules": [
    {
      "rule": "SEC-001",
      "options": {
        "sections": ["Context", "Decision", "Consequences"],
        "files": ["docs/adr/**/*.md"],
      },
    },
    {
      "rule": "SEC-002",
      "options": {
        "order": ["Context", "Decision", "Consequences"],
        "files": ["docs/adr/**/*.md"],
      },
    },
    { "rule": "SEC-003", "options": { "template": "docs/adr/_template.md" } },
    {
      "rule": "STR-001",
      "options": {
        "files": ["README.md", "CONTRIBUTING.md", "docs/adr/index.md"],
      },
    },
  ],
}
```

```bash
wastech-mdlint lint . --fix    # SEC-001 scaffolds any missing section (heading + TODO body)
```

**You get:** missing/mis-ordered sections and template drift flagged; `--fix` scaffolds the gaps for you to fill. See [SEC-001](../rules/SEC-001.md), [SEC-002](../rules/SEC-002.md), [SEC-003](../rules/SEC-003.md), [STR-001](../rules/STR-001.md).

To enforce the template's exact outline — presence, order and no extra sections — with a single rule, set `"strict": true` on SEC-003; its template may then use `*`, `+` and `?` headings as wildcards (see [SEC-003](../rules/SEC-003.md#strict-outline-mode)).

To keep each document's own outline tidy — one title at the top and no skipped heading levels — add [SEC-004](../rules/SEC-004.md). To keep every heading unambiguous for `section` options and anchors, add [SEC-005](../rules/SEC-005.md), which reports a heading whose text repeats an earlier one.
