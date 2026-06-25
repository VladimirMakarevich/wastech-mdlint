# P2.02 · Assertion primitive vocabulary

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **L** · Status **Not started**.

## Goal

Implement the closed, Zod-validated set of assertion **primitives** over `ParsedDocument`.
These are the shared executors that both the 21 built-in rules (as presets, [P3](../index.md))
and declarative **custom rules** ([R9](../requirements/02-rules-engine.md)) run on.

## Sequence

- **Previous:** [P2.01 — Engine core types](01-engine-core-types.md) defined `LintMessage`,
  `RuleContext`, and the `report()` model the primitives emit into.
- **Next:** [P2.03 — Registry & metadata](03-registry-metadata.md) registers rules that
  reference these primitives.
- **Depends on:** P2.01 · **Blocks:** P2.03, and all rule implementations in P3.

## Inputs (from previous work)

- `ParsedDocument` fields (tables/sections/checklist/links/images/content) from P1.
- The primitive list and "built-ins are presets" principle from
  [R9 Tier 1](../requirements/02-rules-engine.md).

## Deliverables / steps

1. Implement primitives as `(target, options, ctx) → LintMessage[]`, each with a Zod options
   schema and a discriminated `kind`:
   - **table:** `requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`,
     `columnUnique` (project), `crossColumn` (when→then);
   - **section:** `sectionPresent`, `sectionOrder`;
   - **content:** `contentNotMatch`, `noPlaceholders`;
   - **checklist:** `allChecked`;
   - **link/image:** `linkResolves`, `imageResolves`.
2. Share the scoping base (`files?`, `exclude?`) across primitives
   ([R7](../requirements/02-rules-engine.md)).
3. Emit structured `LintMessage`s (offending/expected value, column → `data`;
   `fixable` where a deterministic fix exists, e.g. empty-cell → `TODO`).
4. Keep primitives **pure** (inputs in, messages out) and synchronous.

> The graph-dependent checks (`linkResolves`/cycles/orphans) need the shared `ContextGraph`;
> in P2 they accept an injected graph and are fully exercised once P4 builds it.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) primitive vocabulary · [R7](../requirements/02-rules-engine.md)
  shared scoping · [R3](../requirements/02-rules-engine.md) structured output · [R2](../requirements/02-rules-engine.md)
  fixability flags.

## Exit criteria

- [ ] Every primitive has a Zod options schema + unit tests over `ParsedDocument` fixtures.
- [ ] Primitives emit structured `LintMessage`s with positions and `data`.
- [ ] Shared `files`/`exclude` scoping behaves identically across primitives.

## Hand-off to next

P2.03 registers built-in rules as named presets over these primitives; P3 wires the full 21
plus the `custom` rule directly onto this vocabulary.
