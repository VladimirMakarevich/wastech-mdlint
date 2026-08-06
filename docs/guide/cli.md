# CLI reference

> [Guide index](README.md) · [Configuration](configuration.md) · [Output & exit codes](output.md)

The binary is `wastech-mdlint` (package [`@wastech-mdlint/cli`](../../packages/cli), a thin [commander](https://github.com/tj/commander.js) host over core). All commands are read-only except `lint --fix`, `compile` (writes `SKILL.md`), and `init` (writes a config).

```text
wastech-mdlint lint    [path]    [--config <file>] [--format text|json] [--fail-on error|warning|off] [--fix]
wastech-mdlint graph   [path]    [--config <file>] [--format human|json|mermaid|dot]
wastech-mdlint slice   <query>   [--config <file>] [--depth <n>] [--format text|json]
wastech-mdlint impact  <file>    [--config <file>] [--format text|json]
wastech-mdlint compile           [--config <file>] [--outdir <dir>] [--dry-run] [--cwd <dir>]
wastech-mdlint init    [path]    [--yes] [--on-existing overwrite|merge|skip] [--with-ci-workflow]
wastech-mdlint schema            [--out <file>]
wastech-mdlint -v | --version
```

## Exit codes

Every command uses the same taxonomy:

| Code | Meaning |
| --- | --- |
| `0` | Success / clean (no findings at the `--fail-on` threshold). |
| `1` | Findings at or above the `--fail-on` severity (lint-style commands). Reserved exclusively for findings. |
| `2` | Operational/usage error — unknown subcommand, bad flag, invalid choice, a `[path]`/`--cwd` that does not exist or is not a directory, missing config section, target outside the corpus, unreadable config, or a file it could not write. |

`--help` and `--version` always exit `0`.

Only `1` means "the linter found problems", so a CI job can tell a failing document from a broken step. That reservation holds all the way out to the process boundary: a failure during start-up — before any command runs, such as unreadable package metadata — is reported as an `Operational error:` line and exits `2` as well, rather than letting the runtime's own default crash code (`1`) masquerade as findings.

Paths in an error message use `/` separators and are named relative to the directory the command works in — its cwd, or the `[path]`/`--cwd` you gave it — rather than as absolute host paths; that holds even when you passed the argument absolutely, so a bad `[path]`/`--cwd` is reported relative either way. Two limits on it. `schema --out` is echoed back exactly as you typed it, because rewriting your own argument inside the error that quotes it back to you is more confusing than printing it. And a file the command **wrote** outside the working directory — `compile --outdir ../../elsewhere`, say — is named by its full absolute path instead: the relative form would be a chain of `../` hops you cannot read back to a location, and on a different Windows drive there is no relative form at all. That fallback applies to the written file only; a path you passed as an argument is still reported relatively even when it sits outside, `../` segments included — the one exception being a Windows argument on another drive, which has no relative form to report at all and so is printed absolutely.

## `lint` (default)

Lints Markdown files with the configured rule engine. Running `wastech-mdlint` with **no subcommand** lints the cwd — `lint` is the default command. `scan` is a hidden, deprecated alias.

A path still needs its subcommand: `wastech-mdlint docs` is `error: unknown command 'docs'`, not a shorthand for `wastech-mdlint lint docs`. That is the trade-off for rejecting typos — an operand cannot be both "a path" and "a misspelled command name".

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to lint; must exist. Resolved against the cwd. Exits `2` if it is missing or is a file. |
| `--config <file>` | auto-discovered | Path to a config file (otherwise `findConfig` walks up). Resolved against `[path]`. |
| `--format text\|json` | `text` | Human report vs machine `{ summary, messages, files }`. |
| `--fail-on error\|warning\|off` | `error` | Minimum severity that forces exit `1`. `off` never fails. |
| `--fix` | — | Apply deterministic fixes in place (SEC-001, TBL-002), then re-report what remains. |

```bash
wastech-mdlint lint .
wastech-mdlint lint docs --format json > report.json
wastech-mdlint lint . --fail-on warning     # fail CI on warnings too
wastech-mdlint lint . --fix
```

**A relative `--config` is resolved against the directory the command analyzes, not against your shell.** For `lint` and `graph` that is `[path]`, so `wastech-mdlint lint docs --config cfg.json` reads `docs/cfg.json`; for `slice` and `impact` it is the cwd (they take no `[path]`), and for `compile` it is `--cwd`. One rule, every command — and the MCP server's `configPath` follows it too, against that tool's own `cwd`. An absolute `--config` is used as given. If a relative one is not there, the error names it exactly as you typed it — resolution and reporting share the one base, which is what stopped `lint proj --config cfg.json` from blaming a `../cfg.json` nobody wrote; an absolute one that is missing is still reported relative to the analyzed directory, like every other path (see [Exit codes](#exit-codes)).

`--fix` writes only inside the scope of the rule instance that produced the fix: if a [SEC-001](rules/SEC-001.md) or [TBL-002](rules/TBL-002.md) entry sets `files`/`exclude`, files outside that scope are left byte-unchanged. The two surfaces are separate passes over the corpus, so "reported" and "rewritten" could in principle drift apart — they are held together deliberately, since a `--fix` that edited files the report never mentions would be the worst kind of surprise.

See [Output](output.md) for the report shapes and [Suppression](suppression.md) for inline disables.

## `graph`

Builds and summarizes the [context graph](context-graph.md): clusters, hubs, reading order, and the coverage signal.

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to scan; must be an existing directory (exits `2` otherwise). |
| `--config <file>` | auto | Config file. Resolved against `[path]`. |
| `--format human\|json\|mermaid\|dot` | `human` | `human` text; deterministic `{ nodes, edges, components, readingOrder }` JSON; or a `mermaid`/`dot` diagram. |

Read-only; exits `0` on success.

## `slice <query>`

Prints the files reachable within `--depth` hops of a resolved query, following graph edges forward. **Resolution is exact match only** — a defined ID, a heading/anchor slug (`#slug`), or a file path; never fuzzy, substring, keyword, or LLM matching. A query that matches nothing is an honest empty result (`matchKind: null` in JSON), not an error.

| Flag | Default | Description |
| --- | --- | --- |
| `<query>` | — | ID, `#slug`, or file path. |
| `--depth <n>` | `2` | Traversal depth; must be a non-negative integer. |
| `--config <file>` | auto | Config file. Resolved against the cwd. |
| `--format text\|json` | `text` | — |

`slice` always scans the current working directory — it takes no `[path]` argument.

## `impact <file>`

Classifies the blast radius of changing `<file>` and lints the affected subgraph. Linting still runs over the whole corpus (so project-scope rules like [GRP-001](rules/GRP-001.md) see every document), but the reported messages/files are narrowed to `file` plus everything directly or transitively affected by it.

- Takes no `[path]` argument (always the cwd) — so a relative `--config <file>` is resolved against the cwd, as for `slice`.
- Exits `2` with a hint if `<file>` is outside the analyzed corpus.

## `compile`

Generates a deterministic [`SKILL.md`](compile.md) from the document graph, rule descriptions, and config, then writes it to the resolved outdir.

| Flag | Default | Description |
| --- | --- | --- |
| `--config <file>` | auto | Config file. Resolved against `--cwd`. |
| `--outdir <dir>` | `config.compile.outdir` → `.claude/skills/wastech-mdlint/` | Where to write `SKILL.md`. Resolved against `--cwd`. |
| `--dry-run` | — | Print the generated content to stdout instead of writing. |
| `--cwd <dir>` | cwd | Working directory to compile from; must be an existing directory (exits `2` otherwise). |

Unlike other commands, `compile` takes `--cwd` rather than a `[path]` argument — that is what makes `--outdir` compile-specific in where it lands. `--config` is not special: it resolves against the directory being analyzed exactly as everywhere else, which for this command is `--cwd`. Requires a `compile` section in config; a missing one exits `2` with guidance instead of a stack trace.

## `init`

Scans the repo for doc clusters, infers a rule set with rationale, and — on confirmation — writes `wastech-mdlint.config.json` with a **local** `$schema`.

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to scan; must be an existing directory (exits `2` otherwise). |
| `-y, --yes` | — | Accept the inferred draft with no prompts (CI). Defaults `--on-existing` to `skip`. |
| `--on-existing overwrite\|merge\|skip` | prompt (interactive) / `skip` (`--yes`) | How to treat an existing config. `merge` is additive/existing-wins. |
| `--with-ci-workflow` | — | Under `--yes` only, also drop `.github/workflows/wastech-mdlint.yml`. |

- Without `--yes`, `init` requires an interactive terminal (both stdin and stdout must be TTYs); otherwise it fails fast rather than hanging on a prompt.
- Interactive prompts default to the safe option; pressing Enter without choosing lands on that default, not the first listed option.
- A `merge` whose existing config is unreadable or wouldn't load aborts the write rather than risk a lossy result, prints why on stdout, and exits `2`. It is your file that made the merge impossible, not a choice you made — a CI step that refuses to write must not report success.
- **A `merge` does not preserve JSONC comments.** It rebuilds the file from its parsed values, so every `//` comment in the existing config is lost. When the file has comments, `init` says so in the draft — before you confirm — and again in the write summary. Back the file up first if you need them; the rule entries, their severities and options, and every other top-level key are preserved exactly.
- **Ctrl+C** during any prompt exits `0`.
- **The scan skips more than the written config does, and says so.** Noise directories (`node_modules`, `.git`, `dist`, …), every dot-prefixed directory (`.github`, `.claude`, `.husky`), and anything a `.gitignore` excludes (root or nested, negations honored) are invisible to the scan, so `init` never proposes them as doc clusters. The fresh write mirrors two of those three: the noise names go into `exclude`, and `respectGitignore` is written as an explicit `true` — which is _not_ the resolved default (`false`), but is what makes the config lint exactly the tree the draft you approved was built from. Drop `respectGitignore` and gitignored files come back; the `exclude` entries need [negating rather than deleting](configuration.md#what-is-excluded-before-you-write-anything), because that same list applies with or without a config.
- **The dot-directory prune is scan-only, and the draft discloses it.** A directory is never excluded from the lint corpus for starting with a dot — only for being a dependency or build tree — so `.claude/skills/` and `.agents/rules/` stay lintable. But the scan still refuses to _propose_ them, so an `include` it writes will not cover them. The exception is a repository whose only Markdown lives in dot-directories: the scan then finds no cluster at all, omits `include` entirely, and the dot-matching `**/*.md` default lints those files after all. The disclosure says which of the two you are in. Rather than leave you to infer any of this from a file count, the draft prints an **Excluded from the scan** block, one line per reason, before you confirm:

  ```text
  Excluded from the scan:
    hidden directories: 3 Markdown files in 2 directories whose name starts with a dot — .agents (2), .claude (1). The scan never proposes a dot-directory as a doc cluster, so no include pattern above names one; add a pattern such as ".agents/**/*.{md,mdx}" to lint it.
    build and dependency directories: 1 directory skipped by name, contents not counted — node_modules.
    gitignored directories: 1 directory skipped, contents not counted — generated-docs.
  ```

  Only the hidden class carries a file count: it is the one whose contents you plausibly want linted, and the only one cheap to size. The other two say **contents not counted** rather than implying a zero — `init` does not walk a dependency tree to count what it is skipping.

- A fresh write includes an `exclude` list of the noise directories the scan itself skipped, written as **depth-agnostic** `**/<name>/**` globs. The scan skips those directories by name wherever they appear, so anchoring the globs to the repository root would have left a monorepo's `packages/*/dist` and `packages/*/node_modules` in the lint corpus — exactly what the list exists to prevent. The tradeoff is deliberate: hand-written docs living under a nested directory literally named `build`, `out`, `vendor`, … are pruned too, and [`exclude` wins over `include`](configuration.md#top-level-shape). `init` could never have proposed such files in the first place (its scan skips them by the same name). Note that this list is no longer established by `init`: it is the [lint-time default](configuration.md#what-is-excluded-before-you-write-anything) every run applies, and writing it out only makes it visible — so if you need one of those trees linted, **negate** it (`"!**/vendor/**"`) rather than deleting the line, which has no effect. A `merge` never rewrites an existing `exclude`, and never adds `respectGitignore` to a config that did not already have it.
- **Deselecting every offered cluster writes an empty `include`, not a repo-wide one.** `include` defaults to `**/*.md` only when the key is _absent_, so turning down every cluster and omitting the key would lint the entire repository — the opposite of the choice. `init` writes a literal `"include": []` instead (lints nothing) and says so in both the draft and the write summary. When the scan finds no cluster to offer at all, the key is omitted and the `**/*.md` default applies.
- The written `$schema` always points at a file that exists. With `@wastech-mdlint/cli` installed, it is a relative path to that package's `schema.json`, computed from the config's own directory (so a config under `docs/` gets `../node_modules/…`). With nothing installed — the ordinary `npx` case — `init` generates a project-local `schema.json` next to the config and points at that instead; the write summary names which of the two reasons applies. Custom rules force that same project-local schema regardless, since the built-in one cannot describe them. No remote URL is ever emitted.
- **`init` never replaces an existing `schema.json`.** That filename collides easily (it is also `schema`'s own default `--out`, and plenty of repos already keep an unrelated one), so an unguarded write could destroy a hand-written file. The write summary reports whether the existing file already matches what `init` would generate or differs from it, and which of the two reasons put it there. A file that exists but cannot be **read** is kept too, and reported as such: `init` will not replace a file it cannot compare against.
  - When the reason is **custom rules**, the kept file is a stale version of `init`'s own schema: regenerate it by removing or renaming it and re-running `init` with `--on-existing merge`. `merge` is the only action that can produce that schema at all — `--on-existing overwrite` discards the very custom entries it is generated from.
  - When the reason is **no installed package schema** (the `npx` case), the kept file is almost certainly not `init`'s at all — and the config it just wrote points `$schema` at it anyway, so the config is validated against whatever that document describes. The summary says so; repoint `$schema` by hand, or move that file aside and re-run `init` to generate one. `--on-existing overwrite` does **not** replace it either: that flag is a disposition for the _config_, and the fallback schema is only a resolvable target, so nothing you asked for depends on clobbering an unrelated file.
- **Writes are atomic and reported even when they fail.** Each file is written to a temp file beside its target and then renamed into place, so no failure can leave a truncated config behind. Every temp is staged before any rename happens, so a failure while staging leaves the repository entirely untouched; once the renames begin, a prefix of them may already have landed. That prefix is ordered deliberately — the schema is committed before the config, so a failed schema write leaves the old config (and its old, still-accurate `$schema`) intact. On failure the write summary still goes to **stdout**, naming what was written, what was not (everything listed as not written is byte-unchanged), and the errno of the file that failed; the command then exits `2`. A deliberate no-write outcome — `skip`, or declining the draft — is not a failure and still exits `0`. The unreadable-`merge` abort is not one of those: its summary goes to stdout the same way, and its exit code is `2`. The opt-in CI workflow is written last and is never offered after a failed config write; if only the workflow fails, the summary says so and the exit code is still `2`.
- `init` never overwrites an existing `.github/workflows/wastech-mdlint.yml`. When one is already there, the summary reports it as kept (check that it still points at the config just written) rather than staying silent, which would read the same as never having offered a workflow at all. The exit code is unaffected: nothing failed.
- The `--with-ci-workflow` template is **npm-universal by design**: even when `init` detects and reports a bun/pnpm/yarn project, the generated workflow still installs and runs the CLI via `npm install --no-save @wastech-mdlint/cli` + `npx`. That step only fetches the external CLI tool, never the repo's own dependencies, so it never needs the repo's lockfile — and `actions/setup-node` provides npm on every runner, so a per-manager branch would add setup for no functional gain.
- Existing-config discovery walks up from the target directory looking for `wastech-mdlint.config.json`, stopping at the user's home directory (never above it) so an unrelated ancestor config can't be mistaken for the project's own. **When `[path]` is omitted** (the bare/default invocation), a config found at an ancestor governs the whole run — scan, inference, and the write all re-root to that config's own directory, and the existing-config prompt/summary reports its path relative to the original working directory (e.g. `../../wastech-mdlint.config.json`). **When `[path]` is given explicitly**, only a config found exactly at that directory counts as existing; an ancestor's config is left untouched and reported as "none found" for that target.

See [Configuration](configuration.md) for the written file.

## `schema`

Writes the config JSON schema to a local file (never a remote URL).

| Flag           | Default       | Description  |
| -------------- | ------------- | ------------ |
| `--out <file>` | `schema.json` | Output path. |

```bash
wastech-mdlint schema --out wastech-mdlint.schema.json
```

A relative `--out` is resolved against the directory the command runs in, the same way `compile` resolves `--outdir`. Missing parent directories are created. The success line and any write error echo `--out` back exactly as you typed it (see [Exit codes](#exit-codes)), so an absolute argument is reported absolutely even though a relative one lands under the working directory.
