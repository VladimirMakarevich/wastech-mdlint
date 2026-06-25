# P2.06 · `schema.json` generation + sync test + `schema` command

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Generate `schema.json` from the single rule-metadata source (no hand-maintenance), keep it in
sync with the registry, and ship it as a **local** `$schema` — never a remote URL
([C9](../requirements/01-configuration.md)).

## Sequence

- **Previous:** [P2.03 — Registry & metadata](03-registry-metadata.md) (the metadata source)
  and [P2.04 — Config model](04-config-model-loader.md) (the config shape).
- **Next:** [P2.07 — First rules + `lint`](07-first-rules-lint-command.md).
- **Depends on:** P2.03, P2.04 (parallel with P2.05) · **Blocks:** editor validation + `init`
  schema wiring (P6).

## Inputs (from previous work)

- Per-rule metadata + Zod options schemas (P2.03); the root config schema (P2.04); the
  declarative-rule vocabulary (P2.02) for the `custom` shape.

## Deliverables / steps

1. **Generate** `schema.json` from the metadata source + root schema, including the closed
   `custom`-rule vocabulary (so editors validate custom rules generically,
   [R9](../requirements/02-rules-engine.md)).
2. **Sync test** ([R6](../requirements/02-rules-engine.md)): every registered rule has a
   schema entry and vice versa; comparisons normalize canonical IDs
   ([C3](../requirements/01-configuration.md)).
3. Ship `schema.json` inside the published package; default `$schema` is a **relative local
   path** (`./node_modules/@wastech-ctxlint/cli/schema.json`).
4. `wastech-ctxlint schema` command writes a **project-local** schema (incl. custom-rule
   IDs); used by `init` in P6. **No remote URL emitted anywhere** ([C9](../requirements/01-configuration.md)).

## Decisions applied

- [R6](../requirements/02-rules-engine.md) generated-from-metadata · [C9](../requirements/01-configuration.md)
  local-only schema · [C3](../requirements/01-configuration.md) canonical IDs ·
  [R9](../requirements/02-rules-engine.md) custom-rule shape.

## Exit criteria

- [ ] `schema.json` is generated, not hand-written; sync test green.
- [ ] Schema validates built-in rules and the generic `custom` shape.
- [ ] `wastech-ctxlint schema` writes a local project schema; no remote URL anywhere.

## Hand-off to next

P2.07/P6 wire `$schema` to the local file; P3 adds rules and the sync test keeps the schema
honest automatically.
