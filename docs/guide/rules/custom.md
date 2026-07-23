# custom — Declarative custom rule

> Category **custom** · Scope **derived** (columnUnique ⇒ project, else document) · Default
> severity **error** (config-overridable) · Fixable **no**
> · [Rules index](README.md) · [Configuration](../configuration.md)

## What it checks

`custom` is not a single fixed check — it is a declarative rule you assemble from configuration.
Each `custom` entry names one **assertion** from a closed, built-in vocabulary and points it at a
target in your Markdown (a table, a section, content, a checklist, or links). The rule then reports
findings exactly the way the matching built-in rule would.

It is **data-only**: a `custom` rule is described entirely by JSON in your config. There is no code
execution, no plugin loading, and no runtime `.ts`/`.cjs`/`.mjs` module — every assertion `kind`
maps to a shared primitive that ships with the tool. This is why `custom` rules are safe to run
inside the read-only MCP server, and why adding or changing one is **rebuild-free**: you edit
config, not source.

Use `custom` when a built-in rule does the right check but you want to run it under your own rule
ID, with your own description and severity, scoped to a specific document family via `files` /
`exclude`. For example, "every requirements table must have a non-empty `Owner` column" is
`TBL-002`'s behavior expressed as a `custom` rule named `REQ-OWNER`.

## Required fields

A `custom` entry is a config `rules[]` object. Unlike built-in rules (which are keyed by their ID
in the `rule` field), a `custom` entry sets `rule: "custom"` and supplies its identity separately.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `rule` | `"custom"` | **yes** | Marks this entry as a declarative custom rule. |
| `id` | `string` | **yes** | Your namespaced rule ID (see the pattern below). Case-insensitive and dash-optional on input, canonicalized to uppercase. |
| `options` | `object` | **yes** | Carries `assert` plus optional `files`/`exclude`. |
| `options.assert` | `object` | **yes** | The single assertion this rule runs. Exactly one `kind` from the vocabulary below. |
| `description` | `string` | no | Human-readable summary shown in reports; defaults to the `id` if omitted. |
| `severity` | `"error" \| "warning" \| "off"` | no | Overrides the default `error`. `"off"` documents but disables the rule. |
| `target` | `"checklist" \| "content" \| "link" \| "section" \| "table"` | no | Optional redundant declaration of what the assertion operates on; if set it must agree with the `kind` (see [Notes](#notes)). |
| `options.files` | `string[]` | no | Glob(s) narrowing which files this instance applies to. |
| `options.exclude` | `string[]` | no | Glob(s) removing files from this instance. |

### The `id` namespacing rule

`id` must match:

```text
^(?!(CTX|GRP|LLM|REF|SEC|SIZE|STR|TBL)-)[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$
```

In words: uppercase, dash-separated, with at least one dash (e.g. `REQ-OWNER`, `REQ-100`,
`ACME-DOC-1`), **and** its prefix must **not** shadow a shipped built-in prefix. The negative
lookahead reserves `CTX`, `GRP`, `LLM`, `REF`, `SEC`, `SIZE`, `STR`, and `TBL`. A `custom` rule
that tries to call itself `TBL-100` or `REF-XYZ` is rejected at config resolution with a clear
error — pick your own namespace instead. (The reserved set is derived from the registry at
runtime, so this list stays in sync with the actual built-ins.)

## Assertion kinds

`options.assert.kind` selects one assertion. Each kind operates on a fixed target and mirrors a
built-in rule's behavior, calling the same underlying primitive. Fields marked **req** are
required; the rest are optional.

| Kind | Target | Fields | Mirrors |
| --- | --- | --- | --- |
| `requiredColumns` | table | `columns: string[]` (**req**, ≥1) · `section?` | [TBL-001](TBL-001.md) |
| `columnNotEmpty` | table | `column: string` (**req**) · `section?` | [TBL-002](TBL-002.md) |
| `columnInSet` | table | `column: string` (**req**) · `values: string[]` (**req**, ≥1) · `caseSensitive?: boolean` · `section?` | [TBL-003](TBL-003.md) |
| `columnMatches` | table | `column: string` (**req**) · `pattern: string` (**req**) · `flags?: string` · `section?` | [TBL-004](TBL-004.md) |
| `columnUnique` | table | `column: string` (**req**) · `idPattern?: string` · `section?` | [TBL-006](TBL-006.md) |
| `crossColumn` | table | `when` (**req**) · `then` (**req**) · `section?` | [TBL-005](TBL-005.md) |
| `sectionPresent` | section | `sections: string[]` (**req**, ≥1) | [SEC-001](SEC-001.md) |
| `sectionOrder` | section | `order: string[]` (**req**, ≥1) · `level?: number` · `section?` | [SEC-002](SEC-002.md) |
| `contentNotMatch` | content | `pattern: string` (**req**) · `flags?: string` | — (generic content guard, no dedicated built-in) |
| `noPlaceholders` | content | `section?` · `placeholders?: string[]` | [CTX-001](CTX-001.md) |
| `allChecked` | checklist | `section?` | [CTX-002](CTX-002.md) |
| `linkResolves` | link | `exclude?: string[]` | [REF-001](REF-001.md) |
| `imageResolves` | link | `exclude?: string[]` | [REF-003](REF-003.md) |

Notes on individual fields:

- `section` (on table/section/content kinds) scopes the check to content under a heading whose
  text matches; omit it to check every table/section in the file.
- `crossColumn`'s `when` and `then` are each a **column condition**: `{ column, ... }` where the
  `...` is exactly one of `equals: string`, `matches: string` (regex), or `notEmpty: boolean`. The
  rule reads "for every row where `when` holds, `then` must also hold."
- `columnMatches` / `columnUnique` / `contentNotMatch` take a regex `pattern` (or `idPattern`) as a
  string; `flags` is a separate optional string (`contentNotMatch` and `columnMatches`). Matching
  is added automatically where the primitive needs the global flag.
- `noPlaceholders`'s `placeholders` **extends** the locked default set
  (`TBD`, `TODO`, `WIP`, `FIXME`, `N/A`); it does not replace it. A section is flagged when it is
  empty or contains only a bare placeholder token (whole-body, case-insensitive), not when prose
  merely mentions one.
- Every assertion object is closed: an unknown key inside `assert` is a config error, not a
  silently ignored typo.

## Examples

### Requirements tables must fill in `Owner`

```jsonc
{
  "rule": "custom",
  "id": "REQ-OWNER",
  "description": "Each requirement row must have an Owner",
  "severity": "error",
  "target": "table",
  "options": {
    "files": ["docs/requirements/**/*.md"],
    "assert": { "kind": "columnNotEmpty", "column": "Owner" }
  }
}
```

→ In files under `docs/requirements/`, every table cell in the `Owner` column must be non-empty
(same check as `TBL-002`, under your own ID).

### Every architecture doc must have a Dependencies section

```jsonc
{
  "rule": "custom",
  "id": "ARCH-DEPS",
  "description": "Architecture docs declare their Dependencies",
  "target": "section",
  "options": {
    "files": ["docs/architecture/**/*.md"],
    "assert": { "kind": "sectionPresent", "sections": ["Overview", "Dependencies"] }
  }
}
```

→ Each matching file must contain both an `Overview` and a `Dependencies` heading (same check as
`SEC-001`).

### No unfinished placeholders in published guides

```jsonc
{
  "rule": "custom",
  "id": "GUIDE-NO-STUBS",
  "description": "Published guides contain no placeholder sections",
  "severity": "warning",
  "target": "content",
  "options": {
    "files": ["docs/guide/**/*.md"],
    "assert": { "kind": "noPlaceholders", "placeholders": ["DRAFT", "???"] }
  }
}
```

→ Every section in a guide must have real content — flagging empty sections and any of the default
placeholders plus `DRAFT`/`???` (same check as `CTX-001`, as a warning).

## Notes

- **Scope is derived, not declared.** All kinds are `document`-scoped (evaluated per file)
  **except** `columnUnique`, which spans the whole corpus and makes the rule **`project`**-scoped.
  You do not set scope directly; it follows from the assertion `kind`.
- **`target` is optional and validated.** The shipped `target` enum is exactly
  `checklist | content | link | section | table`. If you set it, it must match the target the
  chosen `kind` operates on (per the table above), or config resolution fails. There is **no
  `heading` target** in the shipped schema — section-oriented kinds use `section`. Some planning
  docs still mention a `heading` target; that is a known doc/schema mismatch tracked for cleanup in
  **P9.05**, not a missing feature.
- **`files` / `exclude`** let you register the same underlying assertion multiple times under
  different IDs for different document families — e.g. one column schema for
  `docs/requirements/**` and another elsewhere — without touching product code.
- **Default severity is `error`**, because a `custom` rule asserts a project invariant. Set
  `severity` on the entry to override to `warning` or `off`.
- **Not fixable.** `custom` rules report findings only; none of the assertion kinds emit an
  autofix.

## See also

- [TBL-001](TBL-001.md), [TBL-002](TBL-002.md), [TBL-003](TBL-003.md), [TBL-004](TBL-004.md),
  [TBL-005](TBL-005.md), [TBL-006](TBL-006.md) — the table checks behind `requiredColumns`,
  `columnNotEmpty`, `columnInSet`, `columnMatches`, `crossColumn`, and `columnUnique`.
- [SEC-001](SEC-001.md), [SEC-002](SEC-002.md) — the section checks behind `sectionPresent` and
  `sectionOrder`.
- [CTX-001](CTX-001.md), [CTX-002](CTX-002.md) — the content/checklist checks behind
  `noPlaceholders` and `allChecked`.
- [REF-001](REF-001.md), [REF-003](REF-003.md) — the link/image checks behind `linkResolves` and
  `imageResolves`.
- [Configuration](../configuration.md) — how `rules[]`, `files`/`exclude`, and severity fit
  together.
