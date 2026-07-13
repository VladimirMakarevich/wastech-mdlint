# P7.02 · `lint` and `lint-files` tools

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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

- [x] `lint` works on in-memory content; `lint-files` on a project with fallback patterns.
- [x] Both emit structured output + text summary; read-only annotated.

## Implementation notes

- **`lint` reuses core's rule execution unchanged — it does not add a corpus-only mode.** The
  handler runs the requested rules over a synthetic "corpus of one" (the single parsed document,
  keyed under `content.md`) and passes `rootDir: process.cwd()` into `runRules`. That value is what
  the disk-backed reference rules (`REF-001`, `REF-003`, `SEC-003`) resolve non-corpus link, image,
  and template targets against, exactly as they do under `lint-files`. Core stays the single owner
  of REF/SEC resolution semantics; the host does not fork them. The practical consequence — and the
  honest limitation behind the deliverable's "no filesystem/config needed" — is narrower than it
  reads: `lint` never *loads project config*, but those few rules may still touch the filesystem
  relative to the server's working directory. A non-existent target is reported as a normal
  finding, never a crash.
- **Rule requests reuse core's `ruleEntrySchema`, so `severity` (including `"off"`) is honored.**
  This is a deliberate superset of "resolve via `resolveRule`": exposing the schema without
  honoring the field it carries would be the worse foot-gun. `RuleResolutionError` is translated to
  the `INVALID_INPUT` taxonomy code at the MCP boundary (unknown rule / bad options), because those
  resolution codes are a different enum than `ToolErrorCode` and would otherwise degrade to a
  sanitized `INTERNAL_ERROR`, losing the "did you mean" hint.
- **`graph` is intentionally left undefined for `lint`.** `GRP-*` rules no-op gracefully without a
  graph, and building a real `ContextGraph` for one document needs `siteRouter`/`idRef` wiring that
  the `{ content, rules }` input has no slot for — and would only ever flag the lone document as an
  orphan. This is a scope boundary, not a gap.
- **`lint-files` leaves the zero-config `**/*.md` fallback to core.** The tool only sets
  `config.include` when an explicit `patterns` arg is given (replacing, not merging); absent it,
  core's own `include ?? ["**/*.md"]` applies, so the fallback behavior is provably core's, not
  reimplemented at the boundary.

## Hand-off to next

P7.05 adds stdio integration tests covering these tools' contracts.
