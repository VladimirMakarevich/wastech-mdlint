# Configuration

> [Guide index](README.md) · [Annotated config reference](config-reference.md) · [Rules](rules/README.md)

Configuration is **JSONC** (JSON with `//` comments and trailing commas) in a file named `wastech-mdlint.config.json`. There is no runtime `.ts`/`.cjs`/`.mjs` config and no code execution — config is data only.

> Your comments are yours: nothing in the tool reads or rewrites this file except [`init`](cli.md#init). One caveat — `init --on-existing merge` rebuilds the file from its parsed values, so it **does not preserve comments**. It warns before writing when the existing file has any.

## Zero-config default

With **no config file**, the CLI lints every `**/*.md` outside the [always-excluded trees](#what-is-excluded-before-you-write-anything) with an **empty ruleset** — always a clean pass. Rules only run once you add a config that lists them. This makes adopting the tool safe: nothing fails until you opt in.

## How the config file is found

- `--config <file>` names the file explicitly. A relative path is resolved against the directory the command analyzes — `[path]` for `lint`/`graph`, the cwd for `slice`/`impact`, `--cwd` for `compile`, and the tool's own `cwd` for the [MCP server](mcp-server.md)'s `configPath` — not against the shell you launched from. So `lint docs --config cfg.json` reads `docs/cfg.json`.
- Otherwise `findConfig` walks up from the target directory looking for `wastech-mdlint.config.json`, and lints relative to the directory that holds it. The walk stops at your **home directory** — it never inspects `$HOME` or anything above it as an ancestor. A config that far up almost certainly belongs to something else (a dotfiles repo, another checkout), so treating it as "the project's config" would silently lint the wrong ruleset and, under `init`, put an unrelated file at risk of being overwritten.
- The boundary applies to **ancestors only**: a config sitting directly in the directory you invoke from is always used, even when that directory _is_ your home directory. Hiding it there would be the opposite failure — the tool ignoring a config you can plainly see.

The same discovery runs for every host (CLI and MCP server) because both go through core's single config loader; there is no per-host search order.

## Top-level shape

```jsonc
{
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",
  "include": ["**/*.md"],
  "exclude": ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  "respectGitignore": false,
  "settings": {
    /* shared settings inherited by rules */
  },
  "rules": [
    /* rule entries */
  ],
  "compile": {
    /* config for the `compile` command */
  },
}
```

Unknown top-level keys are rejected. Validation is two-stage: the root shape first, then each rule's own options schema.

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `$schema` | string | — | **Local** path to the JSON schema (for editor completion). Never a remote URL. |
| `include` | string[] | `["**/*.md"]` | Globs of files to lint. |
| `exclude` | string[] | [12 noise globs](#what-is-excluded-before-you-write-anything) | Globs to remove; **`exclude` wins over `include`**. What you write **extends** the default rather than replacing it. |
| `respectGitignore` | boolean | `false` | Off by default on purpose: a `.gitignore` records what should not be committed, which is not the same statement as "do not lint this" — and the trees a first run must skip are already covered by the default `exclude`. When `true`, also skip `.gitignore`d files — root and nested alike, with git's own precedence: the **deepest** `.gitignore` that has a pattern for a path decides, so a nested `!keep.md` re-includes a file a root pattern ignored. An excluded **directory** takes its whole subtree with it, and that exclusion is resolved the same way — a nested `!generated/` re-includes the directory, and the files inside are then judged on the patterns that match them directly. A fresh `init` write sets an explicit `true`; a `merge` never adds it. |
| `settings` | object | — | Shared settings (`siteRouter`, `idRef`) inherited by rules. |
| `rules` | array | `[]` | The rules to run (see below). |
| `compile` | object | — | Config for [`compile`](compile.md); required by that command. |

Two caveats remain on `respectGitignore`, both narrower than the precedence rule above. Matching is **pattern-only**: `wastech-mdlint` reads `.gitignore` files — not `.git/info/exclude`, not a global `core.excludesFile`, and not git's index — so a file that is already **tracked** but matches an ignore pattern is skipped here even though `git` keeps it (a `.gitignore` does not un-track anything). And patterns match **case-insensitively** on every platform, so a `README.md` pattern also skips `readme.md` — which `git` would keep on a case-sensitive filesystem. In both cases the linter skips a file `git` tracks; if you need such a file linted, list it in `include` and leave `respectGitignore` off, or drop the pattern.

### What is excluded before you write anything

Every run starts from a default `exclude`, so a first lint never descends into a dependency tree or a build directory. It is the same list a fresh [`init`](cli.md#init) writes:

```jsonc
"exclude": [
  "**/.cache/**",
  "**/.git/**",
  "**/.next/**",
  "**/.venv/**",
  "**/.yarn/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/out/**",
  "**/target/**",
  "**/vendor/**",
]
```

Each entry is depth-agnostic, so a monorepo's `packages/foo/node_modules` is pruned along with the root copy.

**Every entry names a dependency or build tree, and nothing is excluded merely for starting with a dot.** `.venv` and `.yarn` are on the list because of what they hold, not because they are hidden — so Markdown under `.github/`, `.agents/`, `.claude/` or a `.rules/` directory _is_ linted by default. That is often exactly the documentation you want checked. The [`init`](cli.md#init) scan is stricter: it never proposes a dot-directory as a doc cluster, because a name list cannot enumerate the tooling directories that would pollute the proposal. `init` therefore tells you what it skipped and how much Markdown is in there, and you decide whether to add a pattern such as `".agents/**/*.{md,mdx}"` to `include`.

One consequence is worth knowing before it surprises you: [`compile`](compile.md) writes its `SKILL.md` to `.claude/skills/wastech-mdlint/` by default, and that path is inside the default corpus — so the next run reads the file the previous one generated. Harmless with no config (the zero-config ruleset is empty, so it is a parse and nothing else) and governed by `include` once you have one, since an `init`-written `include` never covers a dot-directory. If you want it out of scope regardless, point `compile.outdir` somewhere your `include` does not reach, or exclude that directory by name.

**Your `exclude` extends this list; it does not replace it.** What you write is appended to the defaults, which has three consequences worth knowing before you edit the key:

- `"exclude": ["drafts/**"]` excludes `drafts` **in addition to** everything above, not instead of it.
- `"exclude": []` is not an opt-out. It adds nothing, and the defaults still apply.
- **Deleting** an entry from your own `exclude` cannot remove a default, because you were never the one who put it there.

To lint one of those trees anyway, negate it. Entries are applied in order and a leading `!` subtracts, and yours are applied after the defaults:

```jsonc
"exclude": ["!**/build/**"] // lint build/ after all; every other default still applies
"exclude": ["!**"]          // no default exclusions at all
```

A negation has to name the **directory**, not a file inside it: `"!**/vendor/keep.md"` does not rescue that file, because `vendor` is pruned before the walk descends into it. That limitation is the subject of [what negation cannot do](#what-negation-cannot-do-reach-inside-an-excluded-directory) below.

## Glob semantics

Every glob in this file — `include`, `exclude`, a rule's `files`/`exclude`, and every rule option that takes patterns — goes through one matcher, so these rules are the same everywhere. One exception, because it is not file scope at all: [`STR-001`](rules/STR-001.md)'s `files` is a _required-file set_, and it strips a leading `./` and probes a non-glob entry on disk before the matcher ever sees it. The any-depth half below holds there; the `./` row and the `!` rule do not.

### Anchoring: a `/` is what pins a pattern to the repository root

- **A pattern that contains a `/` is root-anchored.** `docs/*.md` means the `docs` at the root of the analyzed repository, not a `packages/foo/docs`.
- **A pattern with no `/` is matched at any depth.** `NOTE.md` and `*.md` behave as `**/NOTE.md` and `**/*.md`.

This is the opposite of your shell and of `tsconfig.json`, where `*.md` is one directory rather than the whole tree. It is the same rule `.gitignore` uses — with one difference that matters once `respectGitignore` is on: a slash-containing ignore pattern anchors to the directory holding _that_ `.gitignore`, where here it always anchors to the repository root. Here are the shapes worth spelling out:

| You write | It means | Matches |
| --- | --- | --- |
| `NOTE.md` | any depth | `NOTE.md`, `docs/NOTE.md`, `packages/foo/NOTE.md` |
| `*.md` | any depth | every Markdown file in the tree |
| `./NOTE.md` | root only | `NOTE.md` — **not** `docs/NOTE.md` |
| `node_modules/**` | root only | `node_modules/…` — **not** `packages/foo/node_modules/…` |
| `**/node_modules/**` | any depth, root included | both of the above (a `**/` segment also matches zero segments) |

Two consequences worth internalizing. To exclude a directory wherever it appears — the usual intent for `node_modules`, `dist`, `build` — write the `**/`-prefixed form; the bare `node_modules/**` prunes only the root copy and silently leaves a monorepo's nested copies in the corpus. And to pin something _to_ the root, give it a `/`: the leading `./` in the `"./*.{md,mdx}"` that [`init`](cli.md#init) proposes is load-bearing, not decoration — remove it and the pattern expands from "the Markdown files at the root" to every Markdown file in the repository.

### Ordering: entries are applied in order, and a leading `!` subtracts

A pattern list is not a plain OR. It is evaluated **left to right**, and the last entry that matches a path decides:

```jsonc
"include": ["docs/**", "!docs/private/**", "docs/private/keepme.md"]
```

- `docs/public/a.md` — selected by `docs/**`.
- `docs/private/secret.md` — selected, then removed by the `!` entry.
- `docs/private/keepme.md` — removed, then put back by the entry after it.
- `README.md` — never selected at all.

Reverse the last two entries and `keepme.md` is excluded again: order is the whole mechanism. Three more rules follow from it:

- **Negation obeys the anchoring rule too.** `!keep.md` has no `/`, so it subtracts `keep.md` at any depth; `!./keep.md` subtracts only the one at the root.
- **A list of nothing but negations starts from "everything".** `"include": ["!drafts/**"]` selects every file outside `drafts` — including non-Markdown ones, which would then be parsed as Markdown. Keep a positive entry (`["**/*.md", "!drafts/**"]`): the positives define the set the negations subtract from.
- **A negation is a filter, not a search.** It can only remove from what the entries before it selected — `"include": ["docs/**", "!docs/private/**"]` never reaches a file outside `docs`.

### Two edge cases

**A leading `!(` is an extglob, not a negation.** `!(draft).md` is the "any name except `draft`" pattern, matched at any depth, and stays that. But a slash-containing form such as `!(docs)/**` is read as _subtractive_ — so `["docs/**", "!(docs)/**"]` selects nothing at all. When you mean "not under `docs`", write `!docs/**`.

**A filename that really starts with `!` needs a bracket class.** Write `[!]notes.md`, not `\!notes.md` — a backslash is normalized away as a Windows path separator before the pattern is compiled.

### What negation cannot do: reach inside an excluded directory

A directory matched by `exclude` is pruned before the walk descends into it, so a later `!` entry cannot bring a file back out of it:

```jsonc
// keepme.md is NOT restored — docs/private is never walked.
"exclude": ["docs/private/**", "!docs/private/keepme.md"]
```

Honoring that would mean walking every excluded tree — `node_modules` included — which is the cost `exclude` exists to avoid. Negate at the level that selects instead: leave `docs/private` out of `exclude` and narrow `include`, or exclude the individual files. `git` has the same restriction on its own patterns — a `.gitignore` cannot re-include a file whose parent directory is ignored — which is why re-including the _directory_ is the move there too.

Speaking of which: `respectGitignore` is a **separate** matcher with git's own semantics, including its own deepest-file-wins precedence (see the [table above](#top-level-shape)). Nothing in this section describes it.

## Rule entries

Each entry names a `rule` and may set `severity` and `options`:

```jsonc
{ "rule": "REF-001", "severity": "warning" }
{ "rule": "TBL-002", "options": { "columns": ["Owner"] } }
```

- **Rule IDs are case-insensitive and dash-optional** — `ref-001` and `REF001` both canonicalize to `REF-001`.
- `severity` is `"error" | "warning" | "off"`. `"off"` documents but disables a rule. Omitting `severity` uses the rule's built-in default (see each rule page).
- `options` must match that rule's schema; unknown option keys are rejected.
- The **same rule can appear multiple times** with different `files`/`exclude`/options — e.g. one [TBL-001](rules/TBL-001.md) column set for `docs/requirements/**` and another elsewhere.
- Most document-scope rules accept `files` and `exclude` to narrow which files that instance applies to. Some project/identity rules intentionally omit them (see the rule's page). Where a rule takes both, `exclude` wins over `files`, mirroring the top-level pair — and the scope also bounds `--fix`, so an excluded file is never rewritten either.
- **Two rules reuse these names for something else**, so read the rule's page before assuming file scope: [STR-001](rules/STR-001.md)'s `files` is the _required-file set_ it looks for (the point of the rule, not a filter), and [REF-001](rules/REF-001.md)/[REF-003](rules/REF-003.md)'s `exclude` skips link/image _targets_, not source documents. Neither rule takes file scope at all.

See the [rules index](rules/README.md) for every rule's options.

## Shared settings

`settings` holds cross-rule configuration inherited by the rules that understand it.

### `settings.siteRouter`

Teaches reference rules how a docs-site framework maps URLs to files (e.g. Astro Starlight). [REF-001](rules/REF-001.md) and [REF-002](rules/REF-002.md) inherit it and may override it per rule. The graph rules ([GRP-001](rules/GRP-001.md), [GRP-002](rules/GRP-002.md)) pick it up through the shared [context graph](context-graph.md), which resolves its edges with this setting — they have no per-rule override of their own.

```jsonc
"settings": {
  "siteRouter": { "preset": "starlight", "contentDir": "src/content/docs", "defaultLocale": "en" }
}
```

### `settings.idRef`

Feeds the shared [context graph](context-graph.md)'s `id-ref` edges, so ID references count toward [GRP-001](rules/GRP-001.md) cycles and [GRP-002](rules/GRP-002.md) incoming references. It mirrors [REF-005](rules/REF-005.md)'s options shape but is configured separately — REF-005 cannot expose its resolved options back to the graph builder, so a project wanting both ID traceability (REF-005) **and** ID-aware graph analysis sets the same shape in both places.

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

The declarative [`custom`](rules/custom.md) rule composes a closed assertion vocabulary from config — no rebuild, no code. Its `id` must be namespaced and must not shadow a built-in prefix (`CTX/GRP/LLM/REF/SEC/SIZE/STR/TBL`). See its page for the full list of assertion kinds.

## `compile`

Configures the [`compile`](compile.md) command. `skill.name`/`skill.description` are required; `sections`, `commandPreset`, and `hubMinInDegree` tune the generated `SKILL.md`. See the [compile guide](compile.md) and the [annotated reference](config-reference.md).

## Validation & errors

- Unknown keys (top-level, per-rule options, or `compile.*`) are rejected.
- Config errors identify the failing path/rule and exit `2` — not a bare stack trace.
- The JSON schema powering `$schema` is generated from the rule metadata (`wastech-mdlint schema` or `npm run generate:docs`), so editor completion always matches the shipped rules.

A rejection names the file it read, then one line per problem:

```text
Invalid config at wastech-mdlint.config.json:
- config.rules[0].severity: Invalid option: expected one of "error"|"warning"|"off"
```

**The path notation is `config` + `.key` for an object key + `[n]` for an array index** — so `config.rules[0].options.assert.kind` is the `kind` of the assertion on the first rule entry. Every diagnostic uses it, and every diagnostic names the config file. The filename matters because the loader walks up from the directory being analyzed: linting `docs` in a repo whose config sits at the root reports `Invalid config at ../wastech-mdlint.config.json:`, relative to what you asked it to lint.

Validation runs in two passes — the file's shape first, then each `rules[]` entry against its rule's own options — and **a run reports only the pass that failed**. Each pass reports all of its own problems at once, so a shape error and an options error in the same file take two runs to see; fixing everything one pass reports is what moves you to the next.

```text
Invalid config at wastech-mdlint.config.json:
- config.rules[0].options.assert.columns: Invalid input: expected array, received undefined
- config.rules[0].options.assert: Unrecognized key: "colums"
```

## Full example

The [annotated config reference](config-reference.md) is a single config that exercises **every** option — top-level keys, both settings, an entry for each rule with its options, a `custom` rule, and the whole `compile` block — with a comment on each line.
