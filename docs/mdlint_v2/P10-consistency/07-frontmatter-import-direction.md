# P10.07 · Decouple frontmatter-schema import direction

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **L-5** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Remove an avoidable `compile → skills → compile` import cycle in frontmatter validation, without
changing the single-source-of-truth for the schema.

## Problem (from the audit)

`compile/synthesize.ts:7` imports `parseSkillFrontmatter` from the P8 module
`skills/skill-model.ts`, which in turn imports `skillFrontmatterSchema` back from
`compile/skill-frontmatter.ts`. So a P5 (compile) module routes its own validation through the P8
(skills) layer and back. There is exactly one schema definition
(`compile/skill-frontmatter.ts:7`) — the invariant is not violated — but the import direction is
an unnecessary coupling of a lower phase onto a higher one. No runtime issue.

## Deliverables / steps

1. Have `synthesize.ts` import `skillFrontmatterSchema` (and any validate helper it needs)
   directly from its sibling `compile/skill-frontmatter.ts`, not via `skills/skill-model.ts`.
2. Keep `skills/skill-model.ts` importing the schema from `compile/skill-frontmatter.ts` (that
   direction — skills depending on the shared core schema — is correct).
3. Confirm no other core/compile module reaches "up" into `skills/` for the schema.

## Exit criteria

- [ ] `compile/synthesize.ts` no longer imports from `skills/`.
- [ ] The schema still has exactly one definition, reused by both compile and skills.
- [ ] `npm run typecheck && npm test` green.
