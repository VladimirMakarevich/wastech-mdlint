# Guard content quality

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** no empty/placeholder sections, all acceptance-criteria checklists completed, prose uses canonical glossary terms, link text says where a link leads, and every image has alt text.

```jsonc
{
  "rules": [
    { "rule": "CTX-001" }, // no empty / TBD-TODO-only sections
    { "rule": "CTX-002", "options": { "section": "Acceptance criteria" } }, // all - [ ] checked
    {
      "rule": "CTX-003",
      "options": {
        "glossary": "docs/glossary.md",
        "termColumn": "Term",
        "aliasColumn": "Aliases",
      },
    },
    { "rule": "CTX-004" }, // no "here" / "read more" / "подробнее" link text
    { "rule": "CTX-005" }, // no ![](diagram.png) without alt text
  ],
}
```

```bash
wastech-mdlint lint . --fail-on warning
```

**You get:** placeholder/empty sections ([CTX-001](../rules/CTX-001.md)), unchecked checklist items ([CTX-002](../rules/CTX-002.md)), alias-instead-of-canonical-term usage ([CTX-003](../rules/CTX-003.md)), non-descriptive link text such as `[here](a.md)` ([CTX-004](../rules/CTX-004.md)), and images with no alt text such as `![](diagram.png)` ([CTX-005](../rules/CTX-005.md)). Extend the placeholder set with `options.placeholders` (it adds to the defaults `TBD/TODO/WIP/FIXME/N/A`); CTX-004's list is replaced with `options.phrases` or extended with `options.additionalPhrases`.
