# P3.03 · Section + structure rules (SEC-001/002, STR-001)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Implement section-presence/order and project-structure rules over the section primitives.

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md).
- **Next:** sibling family tasks; then [P3.08 — custom rule](08-custom-rule.md).
- **Depends on:** P3.01 · **Parallel with:** P3.02, P3.04–P3.07 · **Blocks:** P3.08, P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| SEC-001 | document | error | required sections present | `sections`, `files?` |
| SEC-002 | document | error | sections appear in order | `order`, `level?`, `section?`, `files?` |
| STR-001 | project | error | required files exist in project | `files` |

## Deliverables / steps

1. SEC-001/002 compose `sectionPresent` / `sectionOrder`; report `line: 0` when a section is
   absent (no precise line), as the reference does.
2. STR-001 is project-scope: check `projectFiles` for required paths; attribute missing-file
   messages sensibly.
3. Fixtures: missing section, out-of-order sections, missing required file.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) presets · [R7](../requirements/02-rules-engine.md) scoping.

## Exit criteria

- [ ] SEC-001/002 and STR-001 pass unit + fixture tests.
- [ ] Order checks honor `level`/`section` constraints.

## Hand-off to next

Section primitives are validated for the `custom` rule (P3.08); structure checks are ready
for `init`'s suggested rule set (P6).
