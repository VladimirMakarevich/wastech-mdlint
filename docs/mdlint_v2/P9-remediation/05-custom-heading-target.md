# P9.05 · Resolve the `custom` `target: "heading"` mismatch

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Done**. Audit finding **M-2** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make the declarative `custom` rule's `target` surface consistent between what the docs promise
and what the engine accepts.

## Problem (from the audit)

`requirements/02-rules-engine.md:45` and `glossary.md:262,265` advertise the custom `target` set
as `table | section | content | checklist | link | heading`. But `ASSERTION_TARGETS`
(`packages/core/src/engine/primitives/assert.ts:85`) and the generated schema enum
(`engine/schema.ts:85,101` → `["checklist","content","link","section","table"]`) have **no
`heading`**, and no assertion primitive targets headings. A user following the canonical glossary
and writing `target: "heading"` gets a schema-validation rejection.

## Decision

**A — dropped `heading`** from `requirements/02-rules-engine.md` and `glossary.md`, so the
advertised set matches the implemented five (`table | section | content | checklist | link`). No
concrete need for a heading-targeted assertion primitive surfaced, and the other five targets
already cover the documented rule set (heading-scoped checks go through `sectionPresent` /
`sectionOrder` under `section`), so Option B's larger surface (a new primitive, schema enum member,
and `describeRules` branch) was not warranted.

The two options considered, for the record:

- **A — Drop `heading`** from `requirements/02-rules-engine.md`, `glossary.md`, and any other doc,
  so the advertised set matches the implemented five. Smallest change; no new surface.
- **B — Implement a heading-targeted primitive** (e.g. assert on heading text/level) and add
  `heading` to `ASSERTION_TARGETS` + the schema enum + `describeRules`, with tests and a fixture.
  Larger; adds real capability.

## Deliverables / steps

1. Record the A/B decision (one line in this file or a short decision note).
2. Apply it consistently across: requirements text, glossary (`:262,265`), `ASSERTION_TARGETS`,
   `engine/schema.ts` enums, `describeRules`, and the committed `packages/cli/schema.json`
   (regenerate via `npm run generate:docs`).
3. Add/adjust a custom-rule test asserting the final `target` set is accepted/rejected as intended.

## Exit criteria

- [x] Requirements, glossary, schema, and primitives agree on the `custom` `target` set.
- [x] `packages/cli/schema.json` regenerated and its sync test green.
- [x] `npm test` green.

## Implementation notes

- `ASSERTION_TARGETS`, the generated `engine/schema.ts` enum, `describeRules`, and the committed
  `packages/cli/schema.json` already had no `heading` member — only the two prose docs
  (`requirements/02-rules-engine.md:45` and `glossary.md:262,265`) advertised it. Fixing them was
  the entire code-facing change; `npm run generate:docs` produced no diff, confirming the schema
  was already in sync.
- `docs/guide/rules/custom.md` had already documented this exact mismatch as a known, tracked
  issue (pointing at this task); its note is now simplified to state the resolved rule directly
  instead of flagging a pending doc/schema drift.
- Added a rejection test in `packages/core/test/rules-custom.test.ts` asserting that a `custom`
  entry's `target` must agree with its assert `kind`'s implied target — the same path that would
  reject a `target: "heading"` entry today.
