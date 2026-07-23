# Configuration

> [Guide index](README.md) · [Annotated config reference](config-reference.md) · [Rules](rules/README.md)

Configuration is **JSONC** (JSON with `//` comments and trailing commas) in a file named
`wastech-mdlint.config.json`. There is no runtime `.ts`/`.cjs`/`.mjs` config and no code
execution — config is data only.

## Zero-config default

With **no config file**, the CLI lints every `**/*.md` with an **empty ruleset** — always a clean
pass. Rules only run once you add a config that lists them. This makes adopting the tool safe:
nothing fails until you opt in.

## How the config file is found

- `--config <file>` names the file explicitly.
- Otherwise `findConfig` walks up from the target directory to the filesystem root looking for
  `wastech-mdlint.config.json`, and lints relative to the directory that holds it.

## Top-level shape

```jsonc
{
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",
  "include": ["**/*.md"],
  "exclude": ["node_modules/**", "dist/**", ".git/**"],
  "respectGitignore": false,
  "settings": { /* shared settings inherited by rules */ },
  "rules": [ /* rule entries */ ],
  "compile": { /* config for the `compile` command */ }
}
```

Unknown top-level keys are rejected. Validation is two-stage: the root shape first, then each
rule's own options schema.

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `$schema` | string | — | **Local** path to the JSON schema (for editor completion). Never a remote URL. |
| `include` | string[] | `["**/*.md"]` | Globs of files to lint. |
| `exclude` | string[] | — | Globs to remove; **`exclude` wins over `include`**. |
| `respectGitignore` | boolean | `false` | When `true`, also skip `.gitignore`d files. |
| `settings` | object | — | Shared settings (`siteRouter`, `idRef`) inherited by rules. |
| `rules` | array | `[]` | The rules to run (see below). |
| `compile` | object | — | Config for [`compile`](compile.md); required by that command. |

## Rule entries

Each entry names a `rule` and may set `severity` and `options`:

```jsonc
{ "rule": "REF-001", "severity": "warning" }
{ "rule": "TBL-002", "options": { "columns": ["Owner"] } }
```

- **Rule IDs are case-insensitive and dash-optional** — `ref-001` and `REF001` both canonicalize
  to `REF-001`.
- `severity` is `"error" | "warning" | "off"`. `"off"` documents but disables a rule. Omitting
  `severity` uses the rule's built-in default (see each rule page).
- `options` must match that rule's schema; unknown option keys are rejected.
- The **same rule can appear multiple times** with different `files`/`exclude`/options — e.g. one
  [TBL-001](rules/TBL-001.md) column set for `docs/requirements/**` and another elsewhere.
- Most document-scope rules accept `files` and `exclude` to narrow which files that instance
  applies to. Some project/identity rules intentionally omit them (see the rule's page).

See the [rules index](rules/README.md) for every rule's options.

## Shared settings

`settings` holds cross-rule configuration inherited by the rules that understand it.

### `settings.siteRouter`

Teaches reference rules how a docs-site framework maps URLs to files (e.g. Astro Starlight).
Reference rules ([REF-001](rules/REF-001.md), [REF-002](rules/REF-002.md), graph rules) inherit it
and may override it per rule.

```jsonc
"settings": {
  "siteRouter": { "preset": "starlight", "contentDir": "src/content/docs", "defaultLocale": "en" }
}
```

### `settings.idRef`

Feeds the shared [context graph](context-graph.md)'s `id-ref` edges, so ID references count toward
[GRP-001](rules/GRP-001.md) cycles and [GRP-002](rules/GRP-002.md) incoming references. It mirrors
[REF-005](rules/REF-005.md)'s options shape but is configured separately — REF-005 cannot expose
its resolved options back to the graph builder, so a project wanting both ID traceability
(REF-005) **and** ID-aware graph analysis sets the same shape in both places.

```jsonc
"settings": {
  "idRef": {
    "idPattern": "REQ-\\d+",
    "definitions": ["docs/requirements/**/*.md"],
    "idColumn": "ID"
  }
}
```

All three `idRef` fields (`idPattern`, `definitions`, `idColumn`) are required when `idRef` is set.

## The `custom` rule

The declarative [`custom`](rules/custom.md) rule composes a closed assertion vocabulary from
config — no rebuild, no code. Its `id` must be namespaced and must not shadow a built-in prefix
(`CTX/GRP/LLM/REF/SEC/SIZE/STR/TBL`). See its page for the full list of assertion kinds.

## `compile`

Configures the [`compile`](compile.md) command. `skill.name`/`skill.description` are required;
`sections`, `commandPreset`, and `hubMinInDegree` tune the generated `SKILL.md`. See the
[compile guide](compile.md) and the [annotated reference](config-reference.md).

## Validation & errors

- Unknown keys (top-level, per-rule options, or `compile.*`) are rejected.
- Config errors identify the failing path/rule and exit `2` — not a bare stack trace.
- The JSON schema powering `$schema` is generated from the rule metadata (`wastech-mdlint schema`
  or `npm run generate:docs`), so editor completion always matches the shipped rules.

## Full example

The [annotated config reference](config-reference.md) is a single config that exercises **every**
option — top-level keys, both settings, an entry for each rule with its options, a `custom` rule,
and the whole `compile` block — with a comment on each line.
