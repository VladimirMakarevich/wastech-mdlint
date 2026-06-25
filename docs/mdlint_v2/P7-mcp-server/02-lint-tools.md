# P7.02 · `lint` and `lint-files` tools

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Expose ad-hoc text lint and project file lint as MCP tools over core.

## Sequence

- **Previous:** [P7.01 — Server foundation](01-server-foundation.md) (conventions + helper).
- **Next:** [P7.05 — Integration tests & docs](05-integration-tests-docs.md).
- **Depends on:** P7.01 + the rule engine (P2/P3) · **Parallel with:** P7.03, P7.04.

## Deliverables / steps

1. `lint` — input `{ content, rules }`: `resolveRule` → `parseDocument` → `runRules` →
   structured findings + text summary. No filesystem/config needed.
2. `lint-files` — input `{ patterns?, configPath?, cwd? }`: `findConfig`/`loadConfig` →
   `lintFiles` → structured per-file results + text summary. Empty/absent `patterns` falls
   back to `config.include ?? ["**/*.md"]`.
3. Structured output ([M1](../requirements/05-mcp-server.md)) with the `LintMessage` fields
   ([R3](../requirements/02-rules-engine.md)); read-only annotation
   ([M7](../requirements/05-mcp-server.md)).

## Decisions applied

- [M1](../requirements/05-mcp-server.md), [M7](../requirements/05-mcp-server.md) ·
  [R3](../requirements/02-rules-engine.md) structured findings.

## Exit criteria

- [ ] `lint` works on in-memory content; `lint-files` on a project with fallback patterns.
- [ ] Both emit structured output + text summary; read-only annotated.

## Hand-off to next

P7.05 adds stdio integration tests covering these tools' contracts.
