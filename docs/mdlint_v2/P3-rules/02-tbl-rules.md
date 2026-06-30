# P3.02 · Table rules (TBL-001…006)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Implement the six table rules as presets over the table primitives from
[P2.02](../P2-rule-engine/02-assertion-primitives.md).

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md) (glob scoping, regex
  validator).
- **Next:** sibling family tasks ([P3.03](03-sec-str-rules.md)…[P3.07](07-llm-rules.md))
  and then [P3.08 — custom rule](08-custom-rule.md).
- **Depends on:** P3.01 · **Parallel with:** P3.03–P3.07 · **Blocks:** P3.08, P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| TBL-001 | document | error | required columns present | `requiredColumns`, `section?`, `files?` |
| TBL-002 | document | warning | target cells non-empty | `columns?`, `files?` |
| TBL-003 | document | error | cell values in allowed set | `column`, `values`, `files?` |
| TBL-004 | document | error | cell values match regex | `column`, `pattern`, `files?` |
| TBL-005 | document | error | cross-column conditional (when→then) | `when`, `then`, `section?`, `files?` |
| TBL-006 | project | error | column IDs unique across files | `files`, `column`, `idPattern?` |

## Deliverables / steps

1. Register each rule via `defineRule(metadata, schema, factory)` (P2.03), composing the
   matching primitive (`requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`,
   `crossColumn`, `columnUnique`).
2. Mark `fixable` where deterministic (e.g. TBL-002 empty cell → `TODO`,
   [R2](../requirements/02-rules-engine.md)).
3. Fixtures per rule (focused), structured findings with offending column/value (`data`).

## Decisions applied

- [R9](../requirements/02-rules-engine.md) presets · [R2](../requirements/02-rules-engine.md)
  fixability · [R3](../requirements/02-rules-engine.md) structured data.

## Exit criteria

- [ ] All six TBL rules pass unit + fixture tests with correct severities.
- [ ] TBL-006 attributes duplicates to the right file/line (project scope).

## Hand-off to next

The table primitives are now exercised by real rules — P3.08 can expose them as `custom`
table assertions with confidence.
