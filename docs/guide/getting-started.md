# Getting started

> [Guide index](README.md) · Next: [CLI reference](cli.md) · [Configuration](configuration.md)

## Requirements

- **Node.js `>=24.17.0`** (the pinned 24 LTS line; see `.node-version`). Installing a **published package** on an older Node prints a warning (`EBADENGINE`) and completes rather than failing — the floor is not enforced at the consumer. Building **from source** (below) is different: this repository's root `.npmrc` sets `engine-strict=true`, so `npm ci` fails hard below the floor instead of warning.
- The tool ships as an npm-workspaces monorepo: [`@wastech-mdlint/core`](../../packages/core) owns the pipeline, [`@wastech-mdlint/cli`](../../packages/cli) is the `wastech-mdlint` binary, and [`@wastech-mdlint/mcp-server`](../../packages/mcp-server) is the `wastech-mdlint-mcp` stdio server.

## Install & build from source

```bash
npm ci            # lockfile-based install
npm run build     # tsc -b → each package's dist/
```

`npm install` writes **no files** into your checkout — there is no `postinstall` config creation. Configuration is created explicitly with [`init`](cli.md#init), never as an install side effect.

## Your first lint

With no config file present, the CLI lints every `**/*.md` outside the [always-excluded trees](configuration.md#what-is-excluded-before-you-write-anything) — `node_modules`, build output, and dependency directories such as `.venv`, at any depth — with an **empty ruleset**, a clean pass. Rules only run once you add a config.

```bash
node packages/cli/dist/index.js lint .              # text output, exit 0 on a clean repo
node packages/cli/dist/index.js lint . --format json
node packages/cli/dist/index.js lint . --fix        # apply deterministic fixes, then re-report
```

Once published you would instead run the `wastech-mdlint` binary directly:

```bash
wastech-mdlint lint .
```

## Bootstrap a config

`init` scans the repo, infers a starter rule set with rationale, and writes `wastech-mdlint.config.json` with a **local** `$schema`:

```bash
wastech-mdlint init            # interactive
wastech-mdlint init --yes      # accept the inferred draft (CI-friendly, no prompts)
```

See [Configuration](configuration.md) for what it writes and [CLI reference](cli.md#init) for all flags.

## Enable a rule manually

Create `wastech-mdlint.config.json`:

```jsonc
{
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",
  "include": ["**/*.md"],
  "rules": [
    { "rule": "REF-001" }, // broken relative links → error
    { "rule": "SEC-001", "options": { "sections": ["Overview", "Usage"] } },
  ],
}
```

That `$schema` assumes the CLI is a local dependency. If you only ever run it through `npx`, there is no `node_modules` path to point at — generate a local copy with [`wastech-mdlint schema`](cli.md#schema) and reference that instead. (`init` handles this for you: it writes a project-local `schema.json` whenever there is nothing installed to point at.)

Then:

```bash
wastech-mdlint lint .
wastech-mdlint lint . --fail-on warning   # also fail CI on warnings
```

## Next steps

- Browse the [rules index](rules/README.md) and enable the ones you need.
- Read the [annotated config reference](config-reference.md) to see every option at once.
- Explore the graph: [`graph` / `slice` / `impact`](context-graph.md).
- Wire the [MCP server](mcp-server.md) into an AI host, or install the [skills](skills.md).
