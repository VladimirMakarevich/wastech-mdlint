# P2.03 · Rule registry + single metadata source + canonical IDs

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Provide the registry that resolves a config entry into a runnable `Rule`, backed by a single
metadata source that also generates `schema.json` and docs ([R6](../requirements/02-rules-engine.md)).

## Sequence

- **Previous:** [P2.02 — Assertion primitives](02-assertion-primitives.md) gave the executors
  that rules compose.
- **Next:** [P2.04 — Config model & loader](04-config-model-loader.md) parses the `rules[]`
  entries this registry resolves; [P2.06](06-schema-generation.md) reads the metadata to emit
  `schema.json`.
- **Depends on:** P2.02 · **Blocks:** P2.04, P2.06, and rule registration in P3.

## Inputs (from previous work)

- Primitives + engine types (P2.01/P2.02).
- ID-naming decision [C3](../requirements/01-configuration.md) and metadata requirement
  [R6](../requirements/02-rules-engine.md).

## Deliverables / steps

1. `defineRule(metadata, schema, factory)` and `resolveRule(name, options)`:
   - look up by **canonical ID** ([C3](../requirements/01-configuration.md)): accept
     `REF-001` / `ref-001` / `ref001` (case-insensitive, dash-optional), store/emit canonical;
   - validate options via the rule's Zod schema; on failure produce a path-prefixed,
     did-you-mean diagnostic ([C7](../requirements/01-configuration.md)).
2. Single **metadata source** per rule: `{ id, category, defaultSeverity, scope, fixable,
   docsUrl, optionsSchema, messages }` — consumed by the registry, `schema.json` generation
   (P2.06), README, `describeRules` (P5), and `init` categories (P6).
3. Registry stays **static** (no code-plugins, [R9 Tier 2 deferred](../requirements/02-rules-engine.md)),
   but the `custom` rule (P3) is registered as a first-class entry over the primitives.

## Decisions applied

- [C3](../requirements/01-configuration.md) canonical IDs · [R6](../requirements/02-rules-engine.md)
  single metadata source · [C7](../requirements/01-configuration.md) diagnostics ·
  [R9](../requirements/02-rules-engine.md) static registry.

## Exit criteria

- [ ] `resolveRule` accepts all ID spellings, emits canonical, validates options.
- [ ] One metadata object per rule drives registry + (later) schema + docs.
- [ ] Unknown rule → did-you-mean; bad options → path-prefixed error.

## Hand-off to next

P2.04 validates `rules[]` shape and hands entries to `resolveRule`; P2.06 turns the metadata
into `schema.json`.
