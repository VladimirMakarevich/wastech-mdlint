# CLI reference

> [Guide index](README.md) · [Configuration](configuration.md) · [Output & exit codes](output.md)

The binary is `wastech-mdlint` (package [`@wastech-mdlint/cli`](../../packages/cli), a thin
[commander](https://github.com/tj/commander.js) host over core). All commands are read-only
except `lint --fix`, `compile` (writes `SKILL.md`), and `init` (writes a config).

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
| `1` | Findings at or above the `--fail-on` severity (lint-style commands). |
| `2` | Operational/usage error — bad flag, invalid choice, missing config section, target outside the corpus, unreadable config. |

`--help` and `--version` always exit `0`.

## `lint` (default)

Lints Markdown files with the configured rule engine. Running `wastech-mdlint` with **no
subcommand** lints the cwd — `lint` is the default command. `scan` is a hidden, deprecated alias.

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to lint. |
| `--config <file>` | auto-discovered | Path to a config file (otherwise `findConfig` walks up). |
| `--format text\|json` | `text` | Human report vs machine `{ summary, messages, files }`. |
| `--fail-on error\|warning\|off` | `error` | Minimum severity that forces exit `1`. `off` never fails. |
| `--fix` | — | Apply deterministic fixes in place (SEC-001, TBL-002), then re-report what remains. |

```bash
wastech-mdlint lint .
wastech-mdlint lint docs --format json > report.json
wastech-mdlint lint . --fail-on warning     # fail CI on warnings too
wastech-mdlint lint . --fix
```

See [Output](output.md) for the report shapes and [Suppression](suppression.md) for inline
disables.

## `graph`

Builds and summarizes the [context graph](context-graph.md): clusters, hubs, reading order, and
the coverage signal.

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to scan. |
| `--config <file>` | auto | Config file. |
| `--format human\|json\|mermaid\|dot` | `human` | `human` text; deterministic `{ nodes, edges, components, readingOrder }` JSON; or a `mermaid`/`dot` diagram. |

Read-only; exits `0` on success.

## `slice <query>`

Prints the files reachable within `--depth` hops of a resolved query, following graph edges
forward. **Resolution is exact match only** — a defined ID, a heading/anchor slug (`#slug`), or a
file path; never fuzzy, substring, keyword, or LLM matching. A query that matches nothing is an
honest empty result (`matchKind: null` in JSON), not an error.

| Flag | Default | Description |
| --- | --- | --- |
| `<query>` | — | ID, `#slug`, or file path. |
| `--depth <n>` | `2` | Traversal depth; must be a non-negative integer. |
| `--config <file>` | auto | Config file. |
| `--format text\|json` | `text` | — |

`slice` always scans the current working directory — it takes no `[path]` argument.

## `impact <file>`

Classifies the blast radius of changing `<file>` and lints the affected subgraph. Linting still
runs over the whole corpus (so project-scope rules like [GRP-001](rules/GRP-001.md) see every
document), but the reported messages/files are narrowed to `file` plus everything directly or
transitively affected by it.

- Takes no `[path]` argument (always the cwd).
- Exits `2` with a hint if `<file>` is outside the analyzed corpus.

## `compile`

Generates a deterministic [`SKILL.md`](compile.md) from the document graph, rule descriptions,
and config, then writes it to the resolved outdir.

| Flag | Default | Description |
| --- | --- | --- |
| `--config <file>` | auto | Config file. |
| `--outdir <dir>` | `config.compile.outdir` → `.claude/skills/wastech-mdlint/` | Where to write `SKILL.md`. |
| `--dry-run` | — | Print the generated content to stdout instead of writing. |
| `--cwd <dir>` | cwd | Working directory to compile from. |

Unlike other commands, `compile` takes `--cwd` (not `[path]`) and resolves a relative
`--config`/`--outdir` against it. Requires a `compile` section in config; a missing one exits `2`
with guidance instead of a stack trace.

## `init`

Scans the repo for doc clusters, infers a rule set with rationale, and — on confirmation — writes
`wastech-mdlint.config.json` with a **local** `$schema`.

| Flag | Default | Description |
| --- | --- | --- |
| `[path]` | cwd | Directory to scan. |
| `-y, --yes` | — | Accept the inferred draft with no prompts (CI). Defaults `--on-existing` to `skip`. |
| `--on-existing overwrite\|merge\|skip` | prompt (interactive) / `skip` (`--yes`) | How to treat an existing config. `merge` is additive/existing-wins. |
| `--with-ci-workflow` | — | Under `--yes` only, also drop `.github/workflows/wastech-mdlint.yml`. |

- Without `--yes`, `init` requires an interactive terminal (both stdin and stdout must be TTYs);
  otherwise it fails fast rather than hanging on a prompt.
- Interactive prompts default to the safe option; pressing Enter without choosing lands on that
  default, not the first listed option.
- A `merge` whose existing config is unreadable or wouldn't load aborts the write rather than risk
  a lossy result.
- **Ctrl+C** during any prompt exits `0`.
- When custom rules are present, `init` also generates a project-local `schema.json` and points
  `$schema` at it. No remote URL is ever emitted.

See [Configuration](configuration.md) for the written file.

## `schema`

Writes the config JSON schema to a local file (never a remote URL).

| Flag | Default | Description |
| --- | --- | --- |
| `--out <file>` | `schema.json` | Output path. |

```bash
wastech-mdlint schema --out wastech-mdlint.schema.json
```
