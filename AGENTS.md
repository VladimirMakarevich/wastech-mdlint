# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project

`wastech-ctxlint` is planned as a TypeScript CLI for auditing Markdown context in repositories. The v1 runtime target is Node.js 24.17.0 LTS. The v1 goal is deterministic local analysis for LLM/agent context hygiene:

- discover Markdown files;
- parse Markdown links and headings;
- validate local file links and anchors;
- build a Markdown dependency graph;
- report file size and line count, orphan docs, graph cycles, eager imports, and context budgets;
- emit text and JSON reports;
- support CI-friendly exit codes.

## Sources Of Truth

The production (**v2**) effort is the current focus; its planning lives under `docs/v2/`:

- **Roadmap:** `docs/v2/index.md` — gap analysis, target architecture, decisions (D1–D7), phases (P0–P9), milestones (M1–M4).
- **Refined requirements:** `docs/v2/requirements/` (index: `docs/v2/requirements/index.md`) — the locked, point-by-point v2 requirements. Authoritative wherever the plan is otherwise ambiguous.
- **Architectural decisions:** `docs/v2/decisions/` — load-bearing decisions referenced throughout (e.g. core-hosts-the-pipeline, vendor-neutral skill distribution).
- **Phase task plans:** `docs/v2/P0-foundations/` … `docs/v2/P9-release/` — one folder per phase, each with a meta `index.md` plus numbered task files. Every task declares its `Previous` / `Next` / `Depends on` / `Blocks` chain.

Historical (**v1** MVP / PoC), retained for context — superseded by the v2 roadmap for current work:

- Original product idea: `PLAN.md`.
- v1 implementation breakdown: `docs/plan/00-meta-plan.md` and `docs/plan/01-project-scaffold.md` through `docs/plan/16-npm-publishing.md`.

When implementing v2, follow the phase order (P0 → P9) and each task's sequence links unless the user explicitly asks for a different slice. The "V1 Boundaries" section below describes the original MVP scope and is superseded by the v2 roadmap.

## V1 Boundaries

Include in v1:

- `wastech-ctxlint scan [path] --config <file> --format text|json --fail-on error|warning|off`.
- `wastech-ctxlint graph [path] --out graph.json`.
- Node.js 24.17.0 LTS, with future `package.json` `engines.node` set to `>=24.17.0 <25`.
- Config files: `wastech-ctxlint.config.json`, `.cjs`, `.mjs`.
- Local Markdown file links and anchors.
- Directed file dependency graph.
- Size limits (bytes, lines, tokens) with per-metric two-tier `warn`/`error` thresholds and glob overrides.
- Orphan docs and dependency cycles. Orphan docs are `error` by default and configurable through `structure.orphanDocs: "error" | "warning" | "off"`.
- `CLAUDE.md`, `AGENTS.md`, and `skills/**/SKILL.md` style LLM entrypoints.
- `@path/to/file.md` eager imports.
- Deterministic heuristic token estimates.

Do not include in v1 unless the user explicitly changes scope:

- HTTP checks for external links.
- External link cache.
- Runtime loading of TypeScript config files.
- Full `structure.requiredSections` enforcement.
- Visualization UI.
- Watch mode.

## Engineering Guidelines

- Prefer small modules with explicit data handoff between CLI, config, discovery, parsing, rules, graph, budgets, and reporting.
- Keep rule modules pure where practical: inputs in, findings out.
- Use normalized repository-relative POSIX paths in public data structures and reports.
- Keep JSON output deterministic by sorting arrays before rendering.
- Avoid ad hoc Markdown parsing when a parser library can provide correct links, headings, and positions.
- Keep token estimation isolated so a real tokenizer can replace the heuristic later.
- Do not introduce broad abstractions before the first concrete rule or pipeline needs them.

## Expected Core Types

The implementation should converge on these public/internal contracts:

- `AuditConfig`
- `Finding`
- `FindingSeverity`
- `MarkdownFile`
- `MarkdownLink`
- `AnchorIndex`
- `DependencyGraph`
- `EntrypointBudget`

## Testing

Use focused fixtures rather than this repository's real Markdown files as test data. Cover:

- config defaults and overrides;
- file discovery and path normalization;
- Markdown link and heading parsing;
- GitHub-style slug generation;
- broken local links and anchors;
- size and line-count limits (warn/error thresholds per metric: bytes, lines, tokens);
- graph edges, orphan docs, and cycles;
- eager import traversal;
- context budget totals;
- text and JSON scan output;
- `graph --out`;
- `--fail-on error|warning|off`.

After the project scaffold exists, prefer these checks before finishing code changes:

```bash
npm run typecheck
npm test
npm run build
```

## Repository Hygiene

- Do not rewrite existing user changes unless explicitly requested.
- Keep documentation changes in `docs/plan/` when they describe implementation sequencing.
- Keep user-facing usage docs in `README.md`.
- Keep implementation details aligned with the task files; update the relevant task file if implementation decisions intentionally diverge.
