# P3.05 · Content-quality rules (CTX-001/002/003)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

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
| CTX-001 | document | warning | no empty/placeholder sections | `section?`, `placeholders?`, `files?` |
| CTX-002 | document | warning | all checklist items checked | `section?`, `files?` |
| CTX-003 | project | warning | glossary alias usage → canonical | `glossary`, `termColumn`, `aliasColumn?`, `section?`, `files?` |

## Deliverables / steps

1. CTX-001 composes `noPlaceholders` + empty-section detection via `extract-section-body`.
   **Placeholder set (locked 2026-07-02, audit 3.1):**
   - Default set: `["TBD", "TODO", "WIP", "FIXME", "N/A"]` (these five, exactly).
   - The `placeholders` option **extends** the default set (union — honoring "extensible");
     it does not replace it.
   - **Matching is case-insensitive and whole-body:** a section is flagged when its trimmed
     body is empty/whitespace, or equals one of the placeholder tokens (optionally with a
     trailing `:`). **Not substring** — prose that merely mentions "TODO" is not flagged.
2. CTX-002 composes `allChecked` over `checkItems` (optionally scoped to a section).
3. CTX-003 is project-scope: read glossary table → build alias→canonical map → scan `content`
   of matched files → warn on alias usage with the canonical replacement.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) presets · [R3](../requirements/02-rules-engine.md)
  structured findings (suggest canonical via `data`).

## Exit criteria

- [ ] CTX-001, CTX-002, CTX-003 pass unit + fixture tests.
- [ ] CTX-001 flags empty + whole-body placeholder sections (case-insensitive), does not flag prose that only mentions a token, and unions `placeholders` with the locked default set.
- [ ] CTX-003 reports canonical replacement for each alias usage.

## Hand-off to next

Content/checklist primitives are validated for `custom` (P3.08); CTX placeholder detection
feeds the `-fix` skill policy (P8/S8).
