# P12.02 · Fix glossary: `custom.target` is optional

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **L-2** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

The glossary must agree with the code, the generated schema, and the guide on whether a `custom`
rule's `target` is required. It is optional everywhere except the glossary.

## Problem (from the audit)

The glossary requires `target` on a `custom` rule (`glossary.md:263-265`), while every other source
treats it as optional:

- code: `config-schema.ts:91` — `.optional()`
- generated schema: `engine/schema.ts:88` — `required: ["rule","id","options"]` (no `target`)
- rule impl: `custom.ts:74`
- guide: `guide/rules/custom.md:38`, `:162`

This is a documentation-only contradiction (the code is correct), but the glossary is the canonical
vocabulary, so it must be the source that changes.

## Deliverables / steps

1. Update `glossary.md:263-265` so `target` is documented as **optional** for a `custom` rule,
   matching `config-schema.ts:91` and the generated schema.
2. Cross-check the surrounding glossary `custom`-rule entry for any other claim that drifted from the
   shipped schema (default `target`, allowed values) and correct as needed.
3. No code change — the schema and impl are already correct. Confirm the registry/schema sync test
   still passes (the change is prose-only).

## Out of scope

The `custom` missing-`id` crash — that is [P11.07](../P11-remediation/07-custom-missing-id.md). This
task is documentation-only.

## Exit criteria

- [ ] `glossary.md` documents `custom.target` as optional, consistent with code, schema, and guide.
- [ ] No other `custom`-entry glossary claim contradicts the shipped schema.
- [ ] `npm test` green (no product code touched).
