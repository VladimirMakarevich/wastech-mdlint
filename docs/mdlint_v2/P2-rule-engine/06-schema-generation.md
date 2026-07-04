# P2.06 · `schema.json` generation + sync test + `schema` command

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Done**.

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
   [R9](../requirements/02-rules-engine.md)). The `custom` rule's `id` is emitted as a
   namespaced-grammar `pattern` with a **negative lookahead excluding the current built-in
   prefixes** (derived from the registry, so it stays in sync), giving editor-time detection of
   reserved-prefix IDs; the authoritative reserved-prefix check is runtime
   ([P2.03](03-registry-metadata.md)/[P3.08](../P3-rules/08-custom-rule.md), audit 3.5).
2. **Sync test** ([R6](../requirements/02-rules-engine.md)): every registered rule has a
   schema entry and vice versa; comparisons normalize canonical IDs
   ([C3](../requirements/01-configuration.md)).
3. Ship `schema.json` inside the published package; default `$schema` is a **relative local
   path** (`./node_modules/@wastech-mdlint/cli/schema.json`).
4. `wastech-mdlint schema` command writes a **project-local** schema (incl. custom-rule
   IDs); used by `init` in P6. **No remote URL emitted anywhere** ([C9](../requirements/01-configuration.md)).

### Frozen public API (audit 4.1)

One core function backs every caller (this command's package + project modes, the sync test,
and P6.04's local-schema wiring). Its signature is **frozen here, before P6.04 depends on it**:

```ts
// @wastech-mdlint/core
export function generateConfigSchema(opts?: {
  customRules?: readonly CustomRuleDefinition[];
}): string; // deterministic, pretty-printed JSON Schema text — the exact bytes of schema.json
```

- No `opts` ⇒ **package schema** (built-in rules only) — the shipped `schema.json`; the sync
  test (step 2) is a byte comparison against this output.
- `opts.customRules` present ⇒ **project-local schema** that also validates those custom rules'
  IDs/shapes ([P6.04](../P6-init/04-config-writer-schema.md)).

Freeze the name, parameters, and return type before P6.04 starts; changes after that are a
coordinated break across P2.06 + P6.04.

## Decisions applied

- [R6](../requirements/02-rules-engine.md) generated-from-metadata · [C9](../requirements/01-configuration.md)
  local-only schema · [C3](../requirements/01-configuration.md) canonical IDs ·
  [R9](../requirements/02-rules-engine.md) custom-rule shape.

## Exit criteria

- [ ] `schema.json` is generated, not hand-written; sync test green.
- [ ] Schema validates built-in rules and the generic `custom` shape.
- [ ] `wastech-mdlint schema` writes a local project schema; no remote URL anywhere.

## Hand-off to next

P2.07/P6 wire `$schema` to the local file; P3 adds rules and the sync test keeps the schema
honest automatically.
