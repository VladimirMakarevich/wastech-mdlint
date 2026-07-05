# P7.02 · `lint` and `lint-files` tools

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Expose ad-hoc text lint and project file lint as MCP tools over core.

## Sequence

- **Previous:** [P7.01 — Server foundation](01-server-foundation.md) (conventions + helper).
- **Next:** [P7.05 — Integration tests & docs](05-integration-tests-docs.md).
- **Depends on:** P7.01 + the rule engine (P2/P3) · **Parallel with:** P7.03, P7.04.

## Deliverables / steps

1. `lint` — input `{ content, rules }`: resolve requested rule ids via
   `ruleRegistry.resolveRule(name, options)` (a `RuleRegistry` method, not a barrel function) →
   `parseDocument(content)` → `runRules(...)` → structured findings + text summary. No
   filesystem/config needed.
2. `lint-files` — input `{ patterns?, configPath?, cwd? }`:
   `loadConfiguration({ cwd, explicitConfigPath: configPath })` (which walks up to `findConfig`
   internally — there is no separate `loadConfig` export) → pass its `config`/`rules`/`settings`
   into `lintFiles` (`LintFilesInput` takes resolved config, not a path) → structured per-file
   results + text summary. An explicit `patterns` arg overrides `config.include` (the tool sets
   `config.include = patterns`); absent it, core's `config.include ?? ["**/*.md"]` applies.
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
