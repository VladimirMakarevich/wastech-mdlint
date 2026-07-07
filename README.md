# wastech-mdlint

`wastech-mdlint` is a TypeScript CLI and library for linting Markdown context in
repositories. It targets Node.js `24.17.0` LTS and focuses on **deterministic, local**
checks for docs and agent-facing context files such as `README.md`, `CLAUDE.md`,
`AGENTS.md`, and `skills/**/SKILL.md`.

It runs a registry-driven **rule engine** over a single Markdown parse pass:

- 22 built-in rules across `TBL` (tables), `SEC`/`STR` (sections & structure),
  `REF` (references), `CTX` (content quality), and `GRP` (graph integrity);
- the preserved LLM context-hygiene rules `SIZE-001` (byte/line/token budgets) and
  `LLM-001` (eager-import budget);
- a declarative `custom` rule that composes a closed primitive vocabulary from config —
  no rebuild, no code execution;
- inline-disable directives, per-rule severity, `--fix` for deterministic fixes, and
  text or JSON output with CI-friendly exit codes.

External HTTP link checking is intentionally out of scope; all analysis is local and
deterministic.

## Runtime

- Node.js `24.17.0` LTS
- `package.json` engines: `>=24.17.0` (no upper bound; CI validates on the Node 24 LTS line)

## Workspace layout

`wastech-mdlint` is an npm-workspaces monorepo. `@wastech-mdlint/core` owns the entire
pipeline; the CLI and MCP server are thin hosts over it.

| Package | Role | Bin |
| --- | --- | --- |
| [`@wastech-mdlint/core`](packages/core) | Parsing, config, rule engine, graph, and formatting — the whole pipeline. | — |
| [`@wastech-mdlint/cli`](packages/cli) | commander CLI host: argument parsing, command dispatch, exit codes. | `wastech-mdlint` |
| [`@wastech-mdlint/mcp-server`](packages/mcp-server) | stdio MCP host. A stub today; the six read-only tools land in P7. | `wastech-mdlint-mcp` |

Build and test the whole workspace from the repo root:

```bash
npm ci            # lockfile-based install
npm run typecheck # tsc -b across project references
npm run build     # tsc -b -> each package's dist/
npm test          # vitest across all packages
npm run lint      # eslint across the workspace
```

## Quick start

```bash
npm install
npm run build
node packages/cli/dist/index.js lint .            # text output
node packages/cli/dist/index.js lint . --format json
node packages/cli/dist/index.js lint . --fix      # apply deterministic fixes, then re-report
```

`npm install` writes no files into your checkout. Configuration is optional — with no
config file present the CLI lints every `**/*.md` file with an empty ruleset (a clean
pass); create a config to enable rules.

## CLI

```bash
wastech-mdlint lint [path] [--config <file>] [--format text|json] [--fail-on error|warning|off] [--fix]
wastech-mdlint graph [path] [--config <file>] [--format human|json|mermaid|dot]
wastech-mdlint slice <query> [--config <file>] [--depth <n>] [--format text|json]
wastech-mdlint impact <file> [--config <file>] [--format text|json]
wastech-mdlint schema [--out schema.json]
wastech-mdlint compile [--config <file>] [--outdir <dir>] [--dry-run] [--cwd <dir>]
```

- `lint` is the default command (running `wastech-mdlint` with no subcommand lints the
  cwd). `scan` is a hidden, deprecated alias of `lint`.
- Exit codes: `0` pass · `1` findings at the `--fail-on` threshold · `2` operational error.
- `graph` prints the context graph to stdout: clusters, hubs, reading order, and the
  coverage signal as `human` text (default); the deterministic
  `{ nodes, edges, components, readingOrder }` shape as `json`; or a `mermaid`/`dot`
  diagram for rendering elsewhere.
- `slice <query> --depth <n>` (default depth `2`) resolves `query` by **exact match
  only** — a defined ID, a heading/anchor slug (`#slug`), or a file path, never
  fuzzy/substring/keyword/LLM matching — then prints the files reachable within that
  many hops. A query that matches nothing is an honest empty result (`matchKind: null`
  in `--format json`), not an error.
- `impact <file>` classifies the blast radius of changing `file` and lints the affected
  subgraph: linting still runs against the whole corpus (so project-scope rules like
  `GRP-001` see every document), but the reported `lint` messages/files are narrowed to
  `file` plus everything directly or transitively affected by it.
- `slice`/`impact` always scan the current working directory — unlike `graph`, they take
  no `[path]` argument.
- `graph`/`slice`/`impact` are read-only reports and exit `0` on success; `impact` exits
  `2` (with a hint) if `file` is outside the analyzed corpus.
- `schema` writes the config JSON schema to a local file (never a remote URL).
- `compile` generates a deterministic `SKILL.md` from the document graph, rule
  descriptions, and config, then writes it to the resolved outdir (`--outdir` →
  `config.compile.outdir` → `.claude/skills/wastech-mdlint/`) as `SKILL.md`; `--dry-run`
  prints the same content to stdout instead of writing it. Requires a `compile` section
  in config; a missing one exits `2` with guidance instead of a bare stack trace. Unlike
  every other command, `compile` takes `--cwd` instead of a `[path]` argument, and
  resolves a relative `--config`/`--outdir` against it (not the process's own cwd).

## Config

Configuration is JSONC (comments + trailing commas) in `wastech-mdlint.config.json`.

```jsonc
{
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",
  "include": ["**/*.md"],
  "exclude": ["node_modules/**", "dist/**", ".git/**"],
  "respectGitignore": false,
  "settings": {
    "siteRouter": { "preset": "starlight", "contentDir": "src/content/docs", "defaultLocale": "en" }
  },
  "rules": [
    { "rule": "REF-001", "severity": "warning" },
    { "rule": "TBL-002", "options": { "columns": ["Owner"] } },
    {
      "rule": "custom",
      "id": "REQ-OWNER",
      "description": "Each requirement row must have an Owner",
      "severity": "error",
      "target": "table",
      "options": { "files": ["docs/requirements/**/*.md"], "assert": { "kind": "columnNotEmpty", "column": "Owner" } }
    }
  ],
  "compile": {
    "outdir": ".claude/skills/wastech-mdlint",
    "skill": { "name": "...", "description": "..." }
  }
}
```

- `exclude` wins over `include`; `respectGitignore` opts into honoring `.gitignore`.
- Each rule entry may set `severity` to `"error" | "warning" | "off"`; `"off"` documents
  but disables a rule. Rule IDs are case-insensitive and dash-optional (`ref-001` →
  `REF-001`).
- `settings.siteRouter` is inherited by reference rules and may be overridden per rule.
- `settings.idRef` (`{ idPattern, definitions, idColumn }`) feeds the shared context graph's
  `id-ref` edges, so ID references also count toward `GRP-001` cycles and `GRP-002` incoming
  references. It mirrors REF-005's own options shape but is configured separately — REF-005
  cannot expose its resolved options back to the graph builder, so a project that wants both ID
  traceability (REF-005) and ID-aware graph analysis configures the same shape in both places.
- The `custom` rule composes the closed assertion vocabulary
  (`requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`, `columnUnique`,
  `crossColumn`, `sectionPresent`, `sectionOrder`, `contentNotMatch`, `noPlaceholders`,
  `allChecked`, `linkResolves`, `imageResolves`). Its `id` must be namespaced and must not
  shadow a built-in prefix.
- `compile` configures the `compile` command. `skill.name`/`skill.description` are
  required (non-empty); `sections.{architecture,rules,dependencies,workflow}` (all
  default `true`) gate which `SKILL.md` sections render; `commandPreset` (`"claude"` |
  `"generic"` | `"none"`, default `"generic"`) selects the wording of the generated
  "Working with dependencies" block; `hubMinInDegree` (default `3`) is the in-degree
  threshold used to classify a document as a hub. Unknown `compile.*` keys are rejected
  like any other unknown config key.

## Rules

The following table is generated from the rule metadata (`npm run generate:docs`); do not
edit it by hand.

<!-- BEGIN GENERATED RULES -->
| Rule | Category | Default severity | Scope | Fixable | Description |
| --- | --- | --- | --- | --- | --- |
| `CTX-001` | CTX | warning | document | no | Sections are not empty or placeholder-only. |
| `CTX-002` | CTX | warning | document | no | All checklist items are checked. |
| `CTX-003` | CTX | warning | project | no | Content uses canonical glossary terms instead of aliases. |
| `GRP-001` | GRP | error | project | no | No circular references between documents. |
| `GRP-002` | GRP | warning | project | no | Documents have at least one incoming reference (except entry points). |
| `GRP-003` | GRP | warning | project | no | IDs are carried forward across pipeline stages. |
| `LLM-001` | LLM | warning | project | no | Eager-import context stays within the per-entrypoint token budget. |
| `REF-001` | REF | error | document | no | Relative links resolve to a file. |
| `REF-002` | REF | error | document | no | Link anchors match a heading slug. |
| `REF-003` | REF | error | document | no | Image targets resolve to a file. |
| `REF-004` | REF | error | document | no | Cross-zone links are declared in the zone's Dependencies section. |
| `REF-005` | REF | error | project | no | IDs are traceable between definitions and references. |
| `REF-006` | REF | warning | project | no | References do not depend on less-stable entities. |
| `SEC-001` | SEC | error | document | yes | Required sections are present. |
| `SEC-002` | SEC | error | document | no | Sections appear in the required order. |
| `SEC-003` | SEC | error | project | no | Sections conform to a reference template's heading structure. |
| `SIZE-001` | SIZE | warning | document | no | File stays within byte / line / token budgets. |
| `STR-001` | STR | error | project | no | Required files exist in the project. |
| `TBL-001` | TBL | error | document | no | Tables declare their required columns. |
| `TBL-002` | TBL | warning | document | yes | Target table cells are not empty. |
| `TBL-003` | TBL | error | document | no | Cell values fall within an allowed set. |
| `TBL-004` | TBL | error | document | no | Cell values match a required pattern. |
| `TBL-005` | TBL | error | document | no | Cross-column conditional holds (when → then). |
| `TBL-006` | TBL | error | project | no | Column IDs are unique across files. |
<!-- END GENERATED RULES -->

`custom` (not shown above) is resolved from config, so its id and behavior are
project-defined.

## Inline suppression

```md
<!-- wastech-mdlint-disable REF-001 -->
[intentionally broken](does-not-exist.md)
<!-- wastech-mdlint-enable REF-001 -->

<!-- wastech-mdlint-disable-next-line TBL-002 -->
| REQ-1 |  |
```

A directive with no rule IDs applies to all rules. `disable` runs until a matching
`enable` or end of file; `disable-next-line` covers only the next line.

## Output

Text output groups findings by file; JSON output (`--format json`) is a structured
`{ summary, messages, files }` document suitable for machine consumption.

```bash
node packages/cli/dist/index.js lint . --format json > report.json
node packages/cli/dist/index.js lint . --fail-on warning   # fail CI on warnings too
```

## Limitations

- No external HTTP link checking or link caching.
- No runtime `.ts`/`.cjs`/`.mjs` config or user-code plugins (custom rules are data-only).
- The context graph is rebuilt each run (no incremental cache yet).

## Planning docs

The v2 roadmap and locked requirements live under [docs/mdlint_v2/](docs/mdlint_v2/index.md).
