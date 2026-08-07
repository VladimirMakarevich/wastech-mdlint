# @wastech-mdlint/cli

The `wastech-mdlint` command: a deterministic, local linter for the Markdown context in a repository — `README.md`, `CLAUDE.md`, `AGENTS.md`, guide pages, and agent-facing files such as `skills/**/SKILL.md`.

```bash
npx @wastech-mdlint/cli lint .        # run it once, no install
npm i -D @wastech-mdlint/cli          # or install the wastech-mdlint bin
```

Node.js `>=24.17.0`. Installing writes no files into your checkout — there is no `postinstall` config creation; a config is created explicitly by `init`. All analysis is local: no HTTP link checking, no telemetry, no user-code plugins.

Every check runs through [`@wastech-mdlint/core`](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/packages/core/README.md), which owns the whole pipeline. This package is the host around it: argument parsing, command dispatch, exit codes, and file output.

## Commands

```bash
wastech-mdlint lint [path] [--config <file>] [--format text|json] [--fail-on error|warning|off] [--fix]
wastech-mdlint graph [path] [--config <file>] [--format human|json|mermaid|dot]
wastech-mdlint slice <query> [--config <file>] [--depth <n>] [--format text|json]
wastech-mdlint impact <file> [--config <file>] [--format text|json]
wastech-mdlint schema [--out schema.json]
wastech-mdlint compile [--config <file>] [--outdir <dir>] [--dry-run] [--cwd <dir>]
wastech-mdlint init [path] [--yes] [--on-existing overwrite|merge|skip] [--with-ci-workflow]
```

`lint` is the default command, so a bare `wastech-mdlint` lints the current directory. Default only in that sense: an unrecognized subcommand is an error rather than a path, so a typo'd CI step fails loudly — which also means a bare path still needs its subcommand (`wastech-mdlint lint docs`).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean — no findings at the `--fail-on` threshold |
| `1` | Findings at that threshold |
| `2` | Operational error — a nonexistent path, an unknown subcommand, an unreadable config, an unwritable file |

`1` is reserved exclusively for findings, so a CI step can tell a failing document from a broken step.

## Zero config, then a config

With no config file present, the CLI lints every `**/*.md` outside the always-excluded trees — `node_modules`, build output, and dependency directories such as `.venv`, at any depth — with an empty ruleset. That is a clean pass; rules run once you add a config.

```bash
wastech-mdlint init      # scan the repo, infer a rule set, write wastech-mdlint.config.json
```

Configuration is JSONC (comments and trailing commas) in `wastech-mdlint.config.json`, with a **local** `$schema` — never a remote URL. This package ships `schema.json` so an editor can resolve `./node_modules/@wastech-mdlint/cli/schema.json` from an ordinary install; `wastech-mdlint schema --out schema.json` writes a copy anywhere you want one.

## Documentation

The rule table is generated from the rule metadata and lives in the repository, along with a page per rule:

- [Project README](https://github.com/VladimirMakarevich/wastech-mdlint#readme) — the full rule table
- [Getting started](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/getting-started.md) · [CLI reference](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/cli.md) · [Configuration](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/configuration.md)
- [Rules index](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/README.md) · [Output & exit codes](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/output.md) · [Suppression](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/suppression.md)

## License

MIT — see [LICENSE](./LICENSE).
