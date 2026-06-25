# P3.05 · Checklist + content-quality rules (CHK-001, CTX-001/002)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Implement checklist completeness and content-quality rules over the checklist/content
primitives.

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md).
- **Next:** sibling family tasks; then [P3.08](08-custom-rule.md), [P3.09](09-rule-tests-and-cutover.md).
- **Depends on:** P3.01 · **Parallel with:** P3.02/03/04/06/07 · **Blocks:** P3.08, P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| CHK-001 | document | warning | all checklist items checked | `section?`, `files?` |
| CTX-001 | document | warning | no empty/placeholder sections | `section?`, `placeholders?`, `files?` |
| CTX-002 | project | warning | glossary alias usage → canonical | `glossary`, `termColumn`, `aliasColumn?`, `section?`, `files?` |

## Deliverables / steps

1. CHK-001 composes `allChecked` over `checkItems` (optionally scoped to a section).
2. CTX-001 composes `noPlaceholders` (default set `TBD/TODO/WIP/FIXME/N/A`, extensible via
   `placeholders`) plus empty-section detection via `extract-section-body`.
3. CTX-002 is project-scope: read glossary table → build alias→canonical map → scan `content`
   of matched files → warn on alias usage with the canonical replacement.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) presets · [R3](../requirements/02-rules-engine.md)
  structured findings (suggest canonical via `data`).

## Exit criteria

- [ ] CHK-001, CTX-001, CTX-002 pass unit + fixture tests.
- [ ] CTX-002 reports canonical replacement for each alias usage.

## Hand-off to next

Content/checklist primitives are validated for `custom` (P3.08); CTX placeholder detection
feeds the `-fix` skill policy (P8/S8).
