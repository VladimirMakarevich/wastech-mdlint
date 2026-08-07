# @wastech-mdlint/core

The pipeline behind [`wastech-mdlint`](https://github.com/VladimirMakarevich/wastech-mdlint), packaged as a library: Markdown parsing, config loading, lint orchestration, context-graph construction, compile, and result formatting.

Core owns all of it. [`@wastech-mdlint/cli`](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/packages/cli/README.md) and [`@wastech-mdlint/mcp-server`](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/packages/mcp-server/README.md) are thin hosts over this package — argument parsing and exit codes on one side, tool registration and structured output on the other — not parallel implementations. Reach for this package when you want the analysis inside your own program; reach for the CLI or the MCP server when you want to run it.

```bash
npm install @wastech-mdlint/core
```

- Node.js `>=24.17.0`, ESM only (no CommonJS build).
- One entry point (`.`), with types.
- Analysis is local and deterministic: no network access, no external link checking, no user-code plugins.

## Usage

Lint a project the way the CLI does — load the config, then run the pipeline:

```ts
import { lintFiles, loadConfiguration } from "@wastech-mdlint/core";

const cwd = process.cwd();
const loaded = await loadConfiguration({ cwd });

const result = await lintFiles({
  cwd,
  config: loaded.config,
  rules: loaded.rules,
  settings: loaded.settings,
});

// { messages, files, errorCount, warningCount }
console.log(result.errorCount, result.warningCount);
```

With no config file present, `loadConfiguration` returns the zero-config default — every `**/*.md` outside the always-excluded trees, with an empty ruleset — so the call above is a clean pass until you add rules.

The context graph is shared infrastructure rather than a lint-only detail — the same graph feeds graph-aware rules, slice, impact, and compile — and is available on its own:

```ts
import { buildContextGraph, loadDocuments } from "@wastech-mdlint/core";

const documents = await loadDocuments(["**/*.md"], {
  cwd,
  // `loadDocuments` is the raw walker: an omitted `exclude` excludes nothing, `node_modules`
  // included. The always-excluded trees are applied a layer up, by `lintFiles`.
  exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
});

const graph = buildContextGraph(documents); // { nodes, edges, cycles }
```

Every path in a public result is a repository-relative POSIX path, and every collection is sorted, on all three platforms — output is safe to commit or diff.

## Documentation

The rule table, the option reference, and a page per rule live in the repository, not here — they are generated from the rule metadata, and a copy in this file would be a second thing to keep in sync.

- [Project README](https://github.com/VladimirMakarevich/wastech-mdlint#readme) — what the tool checks, and the full rule table
- [User guide](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/README.md) · [Concepts](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/concepts.md) · [Configuration](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/configuration.md)
- [Context graph](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/context-graph.md) · [Output & exit codes](https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/output.md)

## License

MIT — see [LICENSE](./LICENSE).
