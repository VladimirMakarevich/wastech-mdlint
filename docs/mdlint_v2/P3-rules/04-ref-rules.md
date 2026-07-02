# P3.04 · Reference rules (REF-001…006)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Implement the six reference-integrity rules — link/anchor/image resolution and ID
traceability — reusing current link logic and the [P3.01](01-shared-rule-utils.md) utils.

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
   **Link resolution incl. i18n (decided 2026-07-02, audit — P3 REF gap):** relative links
   (`./x.md`, `../x.md`) resolve **relative to the source file** — locale-agnostic. Root-relative
   links (`/x`) go through `siteRouter` (preset + `contentDir` + `defaultLocale`); for a source
   under a non-default locale subtree, resolve to the **same-locale** target first, falling back
   to `defaultLocale` only when the same-locale file is absent.
2. REF-002 validates link anchors against heading slugs from `ParsedDocument`
   ([P1.02](../P1-parsed-document/02-block-structure.md)).
3. REF-005/006 are project-scope traceability over table cells (definitions vs references),
   reporting dangling refs (error) and orphan defs (warning). Definitions/references are
   **column-based** (`definitions`/`references`/`idColumn`, `idPattern` validating the token) —
   the **same discovery** the graph's id-ref edges use ([P4.01](../P4-graph/01-context-graph-model.md),
   audit 5.5), via the shared `extractDefinedIds(doc, idRef)` helper (audit 2.1). One notion of
   "defined ID" across REF-005 and the graph. **Orphan/dangling (audit — P3 REF gap):** since
   discovery is column-based there is no "implicit" definition table — REF-005 **requires both**
   `definitions` and `references`; a missing `references` column is a
   [C7](../requirements/01-configuration.md) config error, not a silent pass. **Orphan def** =
   a defined ID appearing in **no** `references` cell across the corpus (warning); **dangling
   ref** = a `references` ID with no matching definition (error).
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
