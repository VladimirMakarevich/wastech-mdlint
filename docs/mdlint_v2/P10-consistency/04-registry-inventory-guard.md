# P10.04 · Add a registry inventory guard test (24 IDs / 8 categories)

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **L-12** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Pin the shipped built-in rule set to its documented shape so an accidental drop/rename of a rule
fails a single canonical test.

## Problem (from the audit)

`registry.test.ts` builds a synthetic 2-rule registry, not `BUILTIN_RULE_DEFINITIONS`. The only
guard on the real set is the byte-in-sync `schema.json` test — which would stay green if the
schema were regenerated after an accidental drop from `rules/index.ts`. Today only a dropped
rule's own `*.test.ts` would catch the regression; there is no single assertion of the whole
inventory.

## Deliverables / steps

1. Add a test that imports the real registry (`BUILTIN_RULE_DEFINITIONS` / whatever
   `rules/index.ts` exports) and asserts:
   - the sorted set of rule IDs equals the documented 24 (TBL-001..006, SEC-001..003, STR-001,
     REF-001..006, CTX-001..003, GRP-001..003, SIZE-001, LLM-001);
   - the set of category prefixes equals the 8 documented categories (no `CHK`);
   - each rule has a scope, a default severity, and an options schema.
2. Consider asserting scope/severity per rule against a small expected table so the guard also
   catches silent metadata drift (matches the audit's per-rule verification table).

## Exit criteria

- [x] One test fails if any built-in rule is added, dropped, renamed, or its category set changes.
- [x] The 24-IDs / 8-categories contract is asserted in code, not only in docs.
- [x] `npm test` green.

## Implementation notes

Added `packages/core/test/registry-inventory.test.ts`, a new file kept separate from
`registry.test.ts` (which stays a synthetic-registry unit test of `RuleRegistry` behavior, not the
shipped inventory). The new test imports `BUILTIN_RULE_DEFINITIONS` directly from
`rules/index.ts` — not `generateRuleDocs`/`generateConfigSchema` — so it doesn't share the
self-referential blind spot the audit flagged: those generators derive their output from the same
registry they'd be checking, so a drop before regeneration still round-trips clean.

The test asserts, against a literal expected table (not derived from the registry itself):

- the sorted rule IDs equal the documented 24;
- the category set equals the 8 documented prefixes (`TBL`, `SEC`, `STR`, `REF`, `CTX`, `GRP`,
  `SIZE`, `LLM` — no `CHK`);
- every rule declares a scope, default severity, and options schema;
- each rule's scope/severity matches a per-rule expected table (sourced from the README rule
  table), so silent metadata drift on a surviving rule also fails, per the audit's per-rule
  verification suggestion.

Verified the guard is load-bearing by temporarily dropping `GRP-001` from `rules/index.ts`
(`GRP_RULES.slice(1)`) and confirming both the ID-set and per-rule assertions fail, then reverted —
no registry or rule-definition code changed.
