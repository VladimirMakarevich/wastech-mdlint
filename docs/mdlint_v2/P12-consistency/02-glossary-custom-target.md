# P12.02 · Fix glossary: `custom.target` is optional

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **L-2** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

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

- [x] `glossary.md` documents `custom.target` as optional, consistent with code, schema, and guide.
- [x] No other `custom`-entry glossary claim contradicts the shipped schema.
- [x] `npm test` green (no product code touched).

## Implementation notes

- **The audit's line numbers were stale.** `glossary.md:263-265` is now the _"Definitions vs
  references"_ entry after [P12.01](01-exclude-coverage.md); the two bullets actually edited are the
  **custom rule** and **Target** entries under `## Assertion primitives & custom rules`.
- **Step 2 turned up three further drifts in the same entry**, all corrected against the generated
  schema (`engine/schema.ts:88`, `:91`):
  - the `target` enum was listed as `table | section | content | checklist | link`, while the
    shipped enum is alphabetical (`checklist | content | link | section | table`) — the order the
    guide's table at `docs/guide/rules/custom.md:38` already used;
  - the required-key set is now stated **positively** (`rule`, `id`, `options`, with `options`
    requiring only `assert`) so the entry cannot silently re-acquire a wrong requirement on
    `description` or `options.files`;
  - derived scope and default severity were added (`columnUnique` ⇒ `project`, else `document`;
    `error`), because a reader looking up `custom` otherwise has to reverse-engineer
    `engine/rules/custom.ts:81`/`:92`.
- **One adjacent fix outside the glossary, same defect class.** The JSONC example in
  `docs/guide/config-reference.md:317` annotated `"description"` as `// required`, contradicting
  `config-schema.ts:94` (optional, defaulting to the `id` at `custom.ts:89`) and the guide's own
  field table; `"target"` carried no optionality annotation at all. Both comments now match the
  schema. That file is hand-written, not generated — `scripts/generate-docs.mjs` writes only
  `packages/cli/schema.json` and `README.md`.
- **No code and no new tests.** `config-schema.ts`, `engine/schema.ts`, `engine/rules/custom.ts`,
  and `packages/cli/schema.json` are byte-identical; the behavior is already pinned by
  `packages/core/test/rules-custom.test.ts:152` (declared-`target` mismatch ⇒ `INVALID_OPTIONS`,
  using the retired `heading` value) and by the 10 of that file's 12 custom entries that omit
  `target` entirely — optionality is the tested-default path. Nothing under
  `packages/*/test/**` reads `docs/**`, so no sync test guards this prose — `npm run format`
  (Prettier covers `docs/`) and a full `npm test` regression run were the gates.
