# P9.05 · Resolve the `custom` `target: "heading"` mismatch

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Audit finding **M-2** ([report](../audit-2026-07-23-p0-p8.md)).

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

## Decision required

Pick one (this is the load-bearing choice for the task):

- **A — Drop `heading`** from `requirements/02-rules-engine.md`, `glossary.md`, and any other doc,
  so the advertised set matches the implemented five. Smallest change; no new surface.
- **B — Implement a heading-targeted primitive** (e.g. assert on heading text/level) and add
  `heading` to `ASSERTION_TARGETS` + the schema enum + `describeRules`, with tests and a fixture.
  Larger; adds real capability.

Default recommendation: **A**, unless there is a concrete need for heading assertions — the other
five targets already cover the documented rule set.

## Deliverables / steps

1. Record the A/B decision (one line in this file or a short decision note).
2. Apply it consistently across: requirements text, glossary (`:262,265`), `ASSERTION_TARGETS`,
   `engine/schema.ts` enums, `describeRules`, and the committed `packages/cli/schema.json`
   (regenerate via `npm run generate:docs`).
3. Add/adjust a custom-rule test asserting the final `target` set is accepted/rejected as intended.

## Exit criteria

- [ ] Requirements, glossary, schema, and primitives agree on the `custom` `target` set.
- [ ] `packages/cli/schema.json` regenerated and its sync test green.
- [ ] `npm test` green.
