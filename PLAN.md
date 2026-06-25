## Name And Goal

**Working name:** `wastech-ctxlint`

**Goal:** static analysis for `.md` files in a repository, focused on LLM/agent context quality: size, links, dependency graph, and basic LLM-specific invariants.

***

## Scope

All `.md` files are analyzed:

- in the repository root;
- in `docs/`;
- in special locations such as `CLAUDE.md`, `AGENTS.md`, `skills/**/SKILL.md`, and `references/**` when configured.

***

## CLI Interface

### `scan` Command

```bash
wastech-ctxlint scan [path] [options]
```

**Purpose:** run all checks and print a human-readable report and/or JSON.

Options:

- `--config <file>`: path to `wastech-ctxlint.config.(json|cjs|mjs)`;
- `--format text|json`: output format, default is `text`;
- `--fail-on error|warning|off`: minimum severity that should produce a non-zero exit code.

### `graph` Command

```bash
wastech-ctxlint graph [path] --out graph.json
```

**Purpose:** build a file dependency graph where nodes are files and edges are links, then save it as JSON for later visualization or processing.

***

## Check Rules: Minimum Set

### 1. File Size Check

**Rule ID:** `size/max-file-size`

- For every `.md` file:
  - count file size in bytes;
  - estimate tokens when a tokenizer or estimator is available.
- Config:
  - `maxBytesDefault`, for example `64 KB`;
  - `overrides` by glob pattern, for example `CLAUDE.md` can use `32 KB`.
- Behavior:
  - if a file exceeds its limit, report a warning or error depending on config.

***

### 2. Link Check

**Rule ID:** `links/broken-links`

- Parse:
  - internal links: `[text](./file.md)`, `[text](../dir/file.md)`;
  - anchors: `[text](#anchor)` and `[text](file.md#anchor)`;
  - external links: `[text](https://...)`, optionally through a flag.
- Checks:
  - the target file exists relative to the current file;
  - the target anchor exists using GitHub/Markdown-style slugs: lowercase, spaces become `-`, special characters are removed;
  - `--check-external`: HTTP HEAD/GET with timeout and cache. This is skipped in the first version.
- Config:
  - ignored URL patterns, such as allowlisted or blocklisted domains;
  - `maxExternalChecksPerRun` for CI. This is skipped in the first version.

****

### 3. File Dependency Graph

**Rule ID:** `graph/dependencies`

- Build a directed graph:
  - node = file path;
  - edge `A -> B` exists when file `A` links to file `B` through a Markdown link.
- Detect:
  - **orphans**: files with no incoming edges, except root or configured entrypoint files;
  - **cycles**: any strongly connected component with more than one file.
- Report:
  - list of orphan files;
  - list of cycles, for example `A -> B -> C -> A`.

***

### 4. LLM-Specific Checks: Eager Imports And Context Budget

#### 4.1. Imports In CLAUDE/AGENTS/Skills

**Rule ID:** `llm/eager-imports`

- Target files by default:
  - `CLAUDE.md`;
  - `AGENTS.md`;
  - `**/SKILL.md`;
  - configurable through glob patterns.
- Search for constructions such as:
  - `@path/to/file.md`, or another syntax used for auto-imports.
- Build an import tree and summarize:
  - size of every imported file;
  - tokens when desired.
- Logic:
  - compute the total **eager budget** for startup context: root file plus all imports;
  - if it exceeds a configured limit, for example `5-8k` tokens, report a warning or error.

#### 4.2. LLM Context Budget Per Entrypoint

**Rule ID:** `llm/context-budget`

- Entrypoints:
  - `CLAUDE.md`;
  - `AGENTS.md`;
  - `skills/**/SKILL.md` for skills.
- For each entrypoint:
  - tokens in its own text;
  - plus tokens for all imported files, as above.
- Config:
  - `maxTokensPerEntrypoint`, for example `5000`;
  - separate limits for different entrypoint types.
- Report:
  - list of entrypoints with estimated token count and over-limit percentage.

***

### 5. Semantic Structure And Organization Invariants

#### 5.1. Orphan Docs

**Rule ID:** `structure/orphan-docs`

- Based on the dependency graph above:
  - files that no other file links to are treated as orphan docs, except:
    - root `README.md` or `index.md`;
    - explicitly configured entrypoints.
- Default behavior for `scan`:
  - orphan docs are reported as `error`;
  - therefore `wastech-ctxlint scan` exits non-zero with the default `--fail-on error`;
  - severity can be configured as `error`, `warning`, or `off`.
- Report:
  - list of orphan files with a recommendation: delete, link from a table of contents, or mark as `@standalone` if that annotation is added later.

***

## Config

`wastech-ctxlint.config.json|cjs|mjs`:

```ts
export default {
  include: ["**/*.md"],
  exclude: ["node_modules/**", "dist/**"],

  size: {
    maxBytesDefault: 64 * 1024,
    overrides: [
      { pattern: "CLAUDE.md", maxBytes: 32 * 1024 },
      { pattern: "skills/**/SKILL.md", maxBytes: 24 * 1024 },
    ],
  },

  llm: {
    entrypoints: ["CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"],
    maxTokensPerEntrypoint: 5000,
  },

  links: {
    checkExternal: false,
    ignorePatterns: ["https://localhost/**"],
  },

  structure: {
    orphanDocs: "error", // "error" | "warning" | "off"
    orphanExemptions: ["README.md", "index.md", "CLAUDE.md", "AGENTS.md", "skills/**/SKILL.md"],
    requiredSections: [
      {
        pattern: "CLAUDE.md",
        slugs: ["project-overview", "architecture", "conventions"],
      },
      {
        pattern: "skills/**/SKILL.md",
        slugs: ["what-this-skill-does", "when-to-use"],
      },
    ],
  },
};
```

***

## Tech Stack

- **Language:** TypeScript, target Node.js 24.17.0 LTS. Use `engines.node: ">=24.17.0 <25"` for the package once scaffolding exists.
- **Markdown parser:** `markdown-it`, `remark`, or an equivalent JavaScript parser. The parser must reliably extract links and headings.
- **Graph:** a small internal graph structure or `graphlib` / `@dagrejs/graphlib`.
- **Token estimate:** a lightweight module, either a simple heuristic counter or an adapter to a tokenizer such as a tiktoken-like library.
