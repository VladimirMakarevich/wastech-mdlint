# Core hosts the pipeline; hosts never duplicate

> **Status:** Accepted (enforced) · Part of the [v2 roadmap](../index.md).

## Context

Three packages need to lint files: `cli`, `mcp-server`, and a future `lsp-server`. Each
could implement its own glob → read → parse → run-rules → format pipeline, but:

- bug fixes in the pipeline would need synchronized changes across packages;
- output formatting (human / JSON) drift between hosts is a UX hazard;
- config-loading rules (precedence, defaults, walk-up search) are tricky enough to deserve a
  single owner.

Duplication of `lintFiles` and of `findConfig`/`loadConfig` across hosts was hit during early
development and consolidated into core.

## Decision

`@wastech-ctxlint/core` is the **single source of truth** for:

- the lint pipeline (`lint-files.ts`);
- config loading (`findConfig`, `loadConfig`);
- result formatting (`formatFileResults`, `formatContentResults`, …).

Hosts (`cli`, `mcp-server`, and any future `lsp-server`) import from core and assemble
user-facing layers on top. They never re-implement these.

`lintFiles` is intentionally **synchronous** (`globSync` + `readFileSync`). Do not introduce
an async variant — that would split the pipeline.

## Consequences

- **+** Single bug-fix surface for the lint pipeline.
- **+** Consistent output across CLI, MCP, and future hosts.
- **+** New hosts (e.g. a GitHub Action wrapper) start from a vetted base.
- **−** Anyone touching the pipeline affects every host; CI catches breakage, but reviewers
  should ack the cross-package impact.
- **−** Synchronous-only may bite if a future host needs async (e.g. streaming over a network
  protocol). Revisit only if it actually happens.
