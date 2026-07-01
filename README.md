# wastech-mdlint

`wastech-mdlint` is a TypeScript CLI for auditing Markdown context in repositories. It targets Node.js `24.17.0` LTS and focuses on deterministic local checks for docs and agent-facing context files such as `README.md`, `CLAUDE.md`, `AGENTS.md`, and `skills/**/SKILL.md`.

V1 covers:

- Markdown discovery under a repository root;
- local Markdown links and anchor validation;
- Markdown dependency graph output;
- orphan doc and dependency cycle detection;
- `@path/to/file.md` eager imports for LLM entrypoints;
- per-entrypoint context budget estimates;
- human-readable text output and machine-readable JSON output;
- CI-friendly `--fail-on error|warning|off`.

External HTTP link checks are not included in v1.

## Runtime

- Node.js `24.17.0` LTS
- `package.json` engines: `>=24.17.0 <25`

## Install

The package is not published yet. For now, run it from a local checkout:

```bash
npm install
npm run build
node dist/cli.js --help
```

After npm publishing is set up, the publishing workflow will be documented in [docs/plan/16-npm-publishing.md](docs/plan/16-npm-publishing.md).

Running `npm install` in a fresh checkout also creates `wastech-mdlint.config.json` from the bundled example if it is missing, and it leaves an existing config file untouched.

## Quick Start

Run a text scan for the current repository:

```bash
npm install
npm run build
node dist/cli.js scan .
```

Run JSON output instead:

```bash
node dist/cli.js scan . --format json
```

Write the Markdown dependency graph to a file:

```bash
node dist/cli.js graph . --out graph.json
```

## CLI

```bash
wastech-mdlint scan [path] [--config <file>] [--format text|json] [--fail-on error|warning|off]
wastech-mdlint graph [path] [--config <file>] --out graph.json
```

`scan`:

- `path` defaults to the current working directory
- `--config <file>` loads `wastech-mdlint.config.json`, `.cjs`, or `.mjs`
- `--format text|json` defaults to `text`
- `--fail-on error|warning|off` defaults to `error`

`graph`:

- writes deterministic graph JSON to `--out`
- does not use `--fail-on`

## Config

Supported config files:

- `wastech-mdlint.config.json`
- `wastech-mdlint.config.cjs`
- `wastech-mdlint.config.mjs`

Example `wastech-mdlint.config.mjs`:

```js
export default {
  include: ["**/*.md"],
  exclude: ["node_modules/**", "dist/**", ".git/**"],
  size: {
    bytes:  { warn: 48 * 1024, error: 64 * 1024 },
    lines:  { warn: 300, error: 500 },
    tokens: { warn: 1500, error: 3000 },
    overrides: [
      { pattern: "CLAUDE.md",          bytes: { warn: 24 * 1024, error: 32 * 1024 } },
      { pattern: "skills/**/SKILL.md", bytes: { warn: 18 * 1024, error: 24 * 1024 } }
    ]
  },
  llm: {
    entrypoints: ["CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"],
    maxTokensPerEntrypoint: 5000
  },
  links: {
    checkExternal: false,
    ignorePatterns: []
  },
  structure: {
    orphanDocs: "error",
    orphanExemptions: ["README.md", "index.md", "CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"]
  }
};
```

Notes:

- `structure.orphanDocs` supports `"error" | "warning" | "off"`.
- orphan docs are `error` by default.
- TypeScript config files are not supported in v1.
- `.cjs` and `.mjs` configs execute code. Treat executable configs as trusted input only.

## Rules

V1 emits these rule ids:

- `links/broken-links`: broken local Markdown files or anchors.
- `size/max-file-size`: file byte, line, or token limit exceeded (`warning` when only the `warn` threshold is crossed; `error` when the `error` threshold is crossed).
- `structure/orphan-docs`: a Markdown file has no incoming Markdown links and is not exempt.
- `graph/dependencies`: dependency cycle in the Markdown link graph.
- `llm/eager-imports`: missing eager import or eager import cycle.
- `llm/context-budget`: estimated entrypoint context exceeds `llm.maxTokensPerEntrypoint`.

Severity defaults in v1:

- `structure/orphan-docs`: `error` by default, configurable to `warning` or `off`
- everything else above: `warning`

Important behavior:

- orphan detection currently uses Markdown link edges, not LLM eager import edges
- eager imports support `@relative/path.md` and `@/root-relative/path.md`
- token estimation is heuristic and intentionally approximate

## Output

Text output is intended for humans and groups findings by severity and rule id.

Example:

```text
Markdown Context Audit
Root: /repo
Files: 3
Findings: 1 error, 2 warning, 0 info
Graph: 3 nodes, 2 edges, 1 orphan docs (error), 0 cycles
Budgets: 1 entrypoints, 0 over limit

Errors (1)
structure/orphan-docs
- docs/standalone.md docs/standalone.md has no incoming Markdown links. Link it from an index document, remove it, or keep it as standalone when future suppression support exists.
```

JSON output includes:

- `summary`
- `findings`
- `files`
- `graph`
- `budgets`

Generate JSON:

```bash
node dist/cli.js scan . --format json > report.json
```

## CI

Fail CI on warnings and errors:

```bash
node dist/cli.js scan . --format text --fail-on warning
```

Fail only on error-level findings:

```bash
node dist/cli.js scan . --format text --fail-on error
```

Always produce a report but never fail the job:

```bash
node dist/cli.js scan . --format json --fail-on off
```

## Development Checks

```bash
npm run typecheck
npm test
npm run build
```

## Project Docs

- Plan review: `docs/plan-review.md`
- [Task 02: CLI Shell](docs/plan/02-cli-shell.md)
- [Task 12: Reporting](docs/plan/12-reporting.md)
- [Task 15: README And Release Checklist](docs/plan/15-readme-release.md)

WSL helper scripts are also available in this repository:

```bash
./scripts/install-wsl.sh
./scripts/typecheck-wsl.sh
./scripts/test-wsl.sh
./scripts/build-wsl.sh
./scripts/verify-wsl.sh
```

## Release Checklist

Before a release:

```bash
node --version
npm run typecheck
npm test
npm run build
node dist/cli.js scan .
npm pack --dry-run
```

Checklist:

- confirm `node --version` reports `v24.17.0`
- confirm `scan` works on this repository
- inspect `npm pack --dry-run` contents before publishing
- follow npm publishing workflow setup in [docs/plan/16-npm-publishing.md](docs/plan/16-npm-publishing.md)

## Limitations

V1 does not include:

- external HTTP link checks
- external link caching
- runtime loading of `.ts` config files
- watch mode
- visualization UI
- full `requiredSections` enforcement

## Planning Docs

- Product idea: [PLAN.md](PLAN.md)
- Meta plan: [docs/plan/00-meta-plan.md](docs/plan/00-meta-plan.md)
- Task breakdown: [docs/plan](docs/plan)
