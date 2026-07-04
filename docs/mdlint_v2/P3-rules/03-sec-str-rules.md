# P3.03 · Section + structure rules (SEC-001/002/003, STR-001)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **S→M** · Status **Done**.

## Goal

Implement section-presence/order and project-structure rules over the section primitives,
including template-based section conformance (SEC-003).

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md).
- **Next:** sibling family tasks; then [P3.08 — custom rule](08-custom-rule.md).
- **Depends on:** P3.01 · **Parallel with:** P3.02, P3.04–P3.07 · **Blocks:** P3.08, P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| SEC-001 | document | error | required sections present | `sections`, `files?` |
| SEC-002 | document | error | sections appear in order | `order`, `level?`, `section?`, `files?` |
| SEC-003 | project | error | sections match a reference file's heading structure | `template`, `files?`, `exclude?`, `level?` |
| STR-001 | project | error | required files exist in project | `files` |

## Deliverables / steps

1. SEC-001/002 compose `sectionPresent` / `sectionOrder`; report `line: 0` when a section is
   absent (no precise line), as the reference does.
2. STR-001 is project-scope: check `projectFiles` for required paths; attribute missing-file
   messages sensibly.
3. **SEC-003** — template-driven section conformance:
   - Load the file at `template` (repo-relative path) from `documents`; if not present in
     the discovered set, resolve and parse it on demand. If the template file does not exist
     on disk → emit one `error` finding attributed to the config and **skip** all per-file
     checks for this rule instance (no false positives when the template is intentionally absent).
   - Extract the heading structure from the template up to depth `level` (default: all levels).
     The extracted list is an ordered set of heading texts at each depth.
   - For each file matched by `files` (excluding the template itself and any paths in
     `exclude`): check that every heading from the template structure is present. Order is
     **not** enforced by this rule (use SEC-002 for that).
   - Report each missing heading as a separate finding with `line: 0` (section absent).
   - `level` option (integer, default: no limit) caps which heading depth is compared
     (e.g. `level: 2` checks only `##` headings).
4. Fixtures: missing section, out-of-order sections, missing required file, template-conformance
   pass/fail, missing-template skip.

### SEC-003 configuration example

```jsonc
{
  "rule": "SEC-003",
  "options": {
    "template": "docs/adr/0001-record-architecture-decisions.md",
    "files": ["docs/adr/**/*.md"],
    "exclude": ["docs/adr/0001-record-architecture-decisions.md"],
    "level": 2
  }
}
```

## Decisions applied

- [R9](../requirements/02-rules-engine.md) presets · [R7](../requirements/02-rules-engine.md) scoping.
- SEC-003 is project-scope (needs to load the template alongside checked documents) even
  though each finding is attributed to an individual file.

## Exit criteria

- [ ] SEC-001/002 and STR-001 pass unit + fixture tests.
- [ ] Order checks honor `level`/`section` constraints.
- [ ] SEC-003 passes unit + fixture tests: conformance pass, missing heading, missing
      template (skip), `level` cap, `exclude` list.

## Hand-off to next

Section primitives are validated for the `custom` rule (P3.08); structure checks are ready
for `init`'s suggested rule set (P6).
