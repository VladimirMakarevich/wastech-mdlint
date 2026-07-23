# Guard content quality

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** no empty/placeholder sections, all acceptance-criteria checklists completed, and prose
uses canonical glossary terms.

```jsonc
{
  "rules": [
    { "rule": "CTX-001" },                                              // no empty / TBD-TODO-only sections
    { "rule": "CTX-002", "options": { "section": "Acceptance criteria" } }, // all - [ ] checked
    { "rule": "CTX-003", "options": { "glossary": "docs/glossary.md", "termColumn": "Term", "aliasColumn": "Aliases" } }
  ]
}
```

```bash
wastech-mdlint lint . --fail-on warning
```

**You get:** placeholder/empty sections ([CTX-001](../rules/CTX-001.md)), unchecked checklist items
([CTX-002](../rules/CTX-002.md)), and alias-instead-of-canonical-term usage
([CTX-003](../rules/CTX-003.md)). Extend the placeholder set with `options.placeholders` (it adds to
the defaults `TBD/TODO/WIP/FIXME/N/A`).
