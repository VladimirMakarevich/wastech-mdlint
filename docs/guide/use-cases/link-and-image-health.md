# Keep documentation links and images healthy in CI

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** fail the build when a relative link, heading anchor, or image is broken.

```jsonc
{
  "include": ["**/*.md"],
  "exclude": ["node_modules/**", "CHANGELOG.md"],
  "rules": [
    { "rule": "REF-001" },   // relative links resolve
    { "rule": "REF-002" },   // #anchors match a real heading slug
    { "rule": "REF-003" }    // images resolve
  ]
}
```

```bash
wastech-mdlint lint . --format json > lint-report.json   # machine-readable for CI
wastech-mdlint lint .                                     # exits 1 if any link/image is broken
```

**You get:** exit code `1` on the first broken reference, with file+line. Analysis is local — no
network, so it is fast and deterministic. See [REF-001](../rules/REF-001.md),
[REF-002](../rules/REF-002.md), [REF-003](../rules/REF-003.md) and [Output](../output.md). For a
docs-site framework, set [`settings.siteRouter`](../configuration.md#settingssiterouter).
