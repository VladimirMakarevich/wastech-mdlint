# custom — Declarative custom rule

> Category **custom** · Scope **derived** (columnUnique ⇒ project, else document) · Default severity **error** (config-overridable) · Fixable **no** · [Rules index](README.md) · [Configuration](../configuration.md)

## What it checks

`custom` is not a single fixed check — it is a declarative rule you assemble from configuration. Each `custom` entry names one **assertion** from a closed, built-in vocabulary and points it at a target in your Markdown (a table, a section, content, a checklist, or links). The rule then reports findings exactly the way the matching built-in rule would.

It is **data-only**: a `custom` rule is described entirely by JSON — there is no code execution, no plugin loading, and no runtime `.ts`/`.cjs`/`.mjs` module, because every assertion `kind` maps to a shared primitive that ships with the tool. That is what makes adding or changing one **rebuild-free** (you edit config, not source) and what makes `custom` rules safe to run inside the read-only [MCP server](../mcp-server.md): both MCP lint tools execute them — `lint-files` from the loaded config, and the ad-hoc `lint` tool from an entry passed inline in the request, so an agent can assert an invariant on a draft before that rule exists in config. The CLI runs them from config the same way.

Use `custom` when a built-in rule does the right check but you want to run it under your own rule ID, with your own description and severity, scoped to a specific document family via `files` / `exclude`. For example, "every requirements table must have a non-empty `Owner` column" is `TBL-002`'s behavior expressed as a `custom` rule named `REQ-OWNER`.

## Required fields

A `custom` entry is a `rules[]` object — in your config, or inline in an MCP [`lint`](../mcp-server.md) request. Unlike built-in rules (which are keyed by their ID in the `rule` field), a `custom` entry sets `rule: "custom"` and supplies its identity separately.

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

In words: uppercase, dash-separated, with at least one dash (e.g. `REQ-OWNER`, `REQ-100`, `ACME-DOC-1`), **and** its prefix must **not** shadow a shipped built-in prefix. The negative lookahead reserves `CTX`, `GRP`, `LLM`, `REF`, `SEC`, `SIZE`, `STR`, and `TBL`. A `custom` rule that tries to call itself `TBL-100` or `REF-XYZ` is rejected at config resolution with a clear error — pick your own namespace instead. (The reserved set is derived from the registry at runtime, so this list stays in sync with the actual built-ins.)

## Assertion kinds

`options.assert.kind` selects one assertion. Each kind operates on a fixed target and mirrors a built-in rule's behavior, calling the same underlying primitive. Fields marked **req** are required; the rest are optional.

| Kind | Target | Fields | Mirrors |
| --- | --- | --- | --- |
| `requiredColumns` | table | `columns: string[]` (**req**, ≥1) · `section?` | [TBL-001](TBL-001.md) |
| `columnNotEmpty` | table | `column: string` (**req**) · `section?` | [TBL-002](TBL-002.md) |
| `columnInSet` | table | `column: string` (**req**) · `values: string[]` (**req**, ≥1) · `caseSensitive?: boolean` (default `true`) · `section?` | [TBL-003](TBL-003.md) |
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

- `section` (on table/section/content kinds) scopes the check to content under a heading whose text matches; omit it to check every table/section in the file.
- `crossColumn`'s `when` and `then` are each a **column condition**: `{ column, ... }` where the `...` is exactly one of `equals: string`, `matches: string` (regex), or `notEmpty: boolean`. The rule reads "for every row where `when` holds, `then` must also hold."
- `columnMatches` / `columnUnique` / `contentNotMatch` take a regex `pattern` (or `idPattern`) as a string; `flags` is a separate optional string (`contentNotMatch` and `columnMatches`). Matching is added automatically where the primitive needs the global flag. `columnMatches` tests each cell independently, so `g`/`y` are accepted but carry no meaning there and cannot make findings depend on row order — see [TBL-004](TBL-004.md).
- `noPlaceholders`'s `placeholders` **extends** the locked default set (`TBD`, `TODO`, `WIP`, `FIXME`, `N/A`); it does not replace it. A section is flagged when it is empty or contains only a bare placeholder token (whole-body, case-insensitive), not when prose merely mentions one.
- Every assertion object is closed: an unknown key inside `assert` is a config error, not a silently ignored typo.
- `linkResolves`/`imageResolves` are the one place where **two different `exclude` keys meet**, and they mean different things: `options.exclude` chooses which _documents_ this instance scans, while `assert.exclude` lists _link/image targets_ to skip inside whatever it scans (mirroring [REF-001](REF-001.md)/[REF-003](REF-003.md), whose `exclude` is target-only). They are independent filters and compose — set both to say "check only `docs/**`, and there ignore links into `generated/**`". The nesting is the tell: an `exclude` under `assert` follows the assertion's target, one under `options` follows the file scope.

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
    "assert": { "kind": "columnNotEmpty", "column": "Owner" },
  },
}
```

→ In files under `docs/requirements/`, every table cell in the `Owner` column must be non-empty (same check as `TBL-002`, under your own ID).

### Every architecture doc must have a Dependencies section

```jsonc
{
  "rule": "custom",
  "id": "ARCH-DEPS",
  "description": "Architecture docs declare their Dependencies",
  "target": "section",
  "options": {
    "files": ["docs/architecture/**/*.md"],
    "assert": {
      "kind": "sectionPresent",
      "sections": ["Overview", "Dependencies"],
    },
  },
}
```

→ Each matching file must contain both an `Overview` and a `Dependencies` heading (same check as `SEC-001`).

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
    "assert": { "kind": "noPlaceholders", "placeholders": ["DRAFT", "???"] },
  },
}
```

→ Every section in a guide must have real content — flagging empty sections and any of the default placeholders plus `DRAFT`/`???` (same check as `CTX-001`, as a warning).

## Notes

- **Scope is derived, not declared.** All kinds are `document`-scoped (evaluated per file) **except** `columnUnique`, which spans the whole corpus and makes the rule **`project`**-scoped. You do not set scope directly; it follows from the assertion `kind`.
- **`target` is optional and validated.** The shipped `target` enum is exactly `checklist | content | link | section | table`. If you set it, it must match the target the chosen `kind` operates on (per the table above), or config resolution fails. There is no `heading` target — heading-scoped checks (`sectionPresent`, `sectionOrder`) use `section`.
- **`files` / `exclude`** let you register the same underlying assertion multiple times under different IDs for different document families — e.g. one column schema for `docs/requirements/**` and another elsewhere — without touching product code.
- **Default severity is `error`**, because a `custom` rule asserts a project invariant. Set `severity` on the entry to override to `warning` or `off`.
- **Not fixable.** `custom` rules report findings only; none of the assertion kinds emit an autofix.
- **Findings link here, not to your ID.** Every finding carries a [`helpUri`](../output.md#message-keys) pointing at its rule's documentation page. Your ID is yours, so no such page exists — a `REQ-OWNER` finding links to _this_ page instead, which is the documentation a reader of it actually needs. `ruleId` still carries `REQ-OWNER`.
- **A malformed `custom` entry is a config error, never a crash.** `rule: "custom"` is treated as a commitment: an entry that sets it but omits `id` or `options.assert` fails config validation with a `CONFIG_INVALID` diagnostic naming the offending entry (e.g. `config.rules[0]`), rather than being accepted as an ordinary rule entry named "custom". Forgetting `id` is the likeliest typo here, so it is worth the strictness — the entry can never silently degrade into something else. The diagnostic reports the whole entry's shape, not just the first missing field, because both `id` and `options.assert` are needed before the rule can be resolved at all. Mistakes deeper inside the entry are located just as precisely: a misspelled key inside `assert` reports `config.rules[0].options.assert: Unrecognized key: "colums"`, and an unknown `kind` reports `config.rules[0].options.assert.kind` followed by the full list of allowed kinds. The MCP ad-hoc `lint` tool holds the same line, with wording of its own: an entry that commits to `rule: "custom"` and then omits `id` comes back as an `INVALID_INPUT` tool error naming both required keys. In that tool, shape errors deeper inside the entry (a misspelled `assert.kind`, say) never reach this validation at all — they are rejected a step earlier by the tool's own argument schema, so their wording is the MCP error contract's rather than the one above — see [Error contract](../mcp-server.md#error-contract).

## See also

- [TBL-001](TBL-001.md), [TBL-002](TBL-002.md), [TBL-003](TBL-003.md), [TBL-004](TBL-004.md), [TBL-005](TBL-005.md), [TBL-006](TBL-006.md) — the table checks behind `requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`, `crossColumn`, and `columnUnique`.
- [SEC-001](SEC-001.md), [SEC-002](SEC-002.md) — the section checks behind `sectionPresent` and `sectionOrder`.
- [CTX-001](CTX-001.md), [CTX-002](CTX-002.md) — the content/checklist checks behind `noPlaceholders` and `allChecked`.
- [REF-001](REF-001.md), [REF-003](REF-003.md) — the link/image checks behind `linkResolves` and `imageResolves`.
- [Configuration](../configuration.md) — how `rules[]`, `files`/`exclude`, and severity fit together.
