# Inline suppression

> [Guide index](README.md) · [Configuration](configuration.md) · [Rules](rules/README.md)

Suppress findings inline with HTML-comment directives. Use this for intentional exceptions — a
deliberately broken example link, a placeholder that is expected — without turning a rule
`"off"` project-wide.

## Directives

```md
<!-- wastech-mdlint-disable REF-001 -->
[intentionally broken](does-not-exist.md)
<!-- wastech-mdlint-enable REF-001 -->

<!-- wastech-mdlint-disable-next-line TBL-002 -->
| REQ-1 |  |
```

| Directive | Effect |
| --- | --- |
| `wastech-mdlint-disable [IDs]` | Disable the listed rules from here until a matching `enable` or end of file. |
| `wastech-mdlint-enable [IDs]` | Re-enable the listed rules. |
| `wastech-mdlint-disable-next-line [IDs]` | Disable the listed rules for the **next line only**. |

## Rules

- **Rule IDs are optional.** A directive with **no** IDs applies to **all** rules.
- IDs are canonicalized like config (`ref-001` → `REF-001`) and can be space-separated.
- `disable` runs until a matching `enable` or the end of the file.
- `disable-next-line` covers only the single line that follows it.
- Suppression is applied after rules run: a suppressed finding is dropped from the report.

## Scope note

Inline suppression is line-anchored, so it naturally fits document-scope findings. Project-scope
findings (e.g. [GRP-001](rules/GRP-001.md)) are anchored to a file/line too and can be suppressed
where they are reported; prefer configuring the rule's options (entry points, excludes) for
structural exceptions rather than scattering suppressions.
