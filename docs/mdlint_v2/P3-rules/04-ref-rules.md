# P3.04 · Reference rules (REF-001…006)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Implement the six reference-integrity rules — link/anchor/image resolution and ID
traceability — reusing MVP link logic and the [P3.01](01-shared-rule-utils.md) utils.

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md) (site-router, glob).
- **Next:** sibling family tasks; then [P3.08](08-custom-rule.md), [P3.09](09-rule-tests-and-cutover.md).
- **Depends on:** P3.01 · **Parallel with:** P3.02/03/05/06/07 · **Blocks:** P3.08, P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| REF-001 | document | error | relative links resolve | `exclude?`, `siteRouter?` |
| REF-002 | document | error | anchors match heading slugs | `files?` |
| REF-003 | document | error | images resolve | `exclude?` |
| REF-004 | document | error | cross-zone links declared in zone Dependencies | `zonesDir`, `dependencySection?` |
| REF-005 | project | error | ID traceability (refs↔definitions) | `definitions`, `references`, `idColumn`, `idPattern` |
| REF-006 | project | warning | stability consistency | `stabilityColumn`, `stabilityOrder`, `definitions`, `references`, `idColumn?`, `idPattern?` |

## Deliverables / steps

1. REF-001/003 compose `linkResolves`/`imageResolves` (existsSync + `documents` + site-router).
2. REF-002 validates link anchors against heading slugs from `ParsedDocument`
   ([P1.02](../P1-parsed-document/02-block-structure.md)).
3. REF-005/006 are project-scope traceability over table cells (definitions vs references),
   reporting dangling refs (error) and orphan defs (warning).
4. `siteRouter` from `settings` with per-rule override ([C5](../requirements/01-configuration.md)).

> REF rules use the `documents` map + `existsSync` + site-router (no full graph needed). The
> graph-dependent rules are GRP-* ([P3.06](06-grp-rules.md)).

## Decisions applied

- [C5](../requirements/01-configuration.md) site-router · [R7](../requirements/02-rules-engine.md)
  scoping · [R3](../requirements/02-rules-engine.md) structured findings.

## Exit criteria

- [ ] All six REF rules pass unit + fixture tests.
- [ ] REF-002 anchor slugs match GitHub semantics; REF-005 reports dangling vs orphan correctly.

## Hand-off to next

P3.08 can offer link/image/anchor assertions in `custom`; P4's semantic graph (id-ref/anchor
edges, G1) later enriches what REF-002/005 can express.
