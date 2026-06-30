# P3.06 · Graph-integrity rules (GRP-001/002/003)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Implement the three graph-integrity rules to reach lint parity. They use the available graph
build now; [P4](../index.md) refactors them onto the shared `ContextGraph`
([R5](../requirements/02-rules-engine.md)/[G6](../requirements/03-context-graph.md)).

## Sequence

- **Previous:** [P3.01 — Shared rule utils](01-shared-rule-utils.md).
- **Next:** [P3.08 — custom rule](08-custom-rule.md), [P3.09 — cutover](09-rule-tests-and-cutover.md).
- **Depends on:** P3.01 + the relocated MVP graph build (cycle/orphan logic from
  [P0.04](../P0-foundations/04-migrate-mvp-to-core.md)) · **Blocks:** P3.08, P3.09 ·
  **Refactored by:** [P4](../index.md) (R5/G6).

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| GRP-001 | project | error | no circular references | `files?`, `exclude?`, `siteRouter?` |
| GRP-002 | project | warning | every doc has ≥1 incoming ref (except entry points) | `files?`, `entryPoints?`, `siteRouter?` |
| GRP-003 | project | warning | ID chain across stages (stage N IDs appear at N+1) | `chain[{stage,files,idColumn?,refColumn}]`, `idPattern?` |

## Deliverables / steps

1. GRP-001 cycle detection (DFS color-marking / reuse MVP Tarjan SCC); canonicalize cycles to
   avoid duplicate reports; attribute to the first arc.
2. GRP-002 incoming-reference count with `entryPoints` allowlist + site-router resolution.
3. GRP-003 chain traversal across stage files by ID/ref columns.
4. **Sequencing note:** in P3 these may build a local adjacency (reference behavior) to hit
   lint parity; [P4](../index.md) replaces that with the shared `ContextGraph` + explicit
   cycle data ([R5](../requirements/02-rules-engine.md)/[G6](../requirements/03-context-graph.md)).

## Decisions applied

- [C5](../requirements/01-configuration.md) site-router · [R5](../requirements/02-rules-engine.md)
  (refactor target) · [G6](../requirements/03-context-graph.md) explicit cycles.

## Exit criteria

- [ ] GRP-001/002/003 pass unit + fixture tests (cycles, orphans, broken chains).
- [ ] Cycle reports are de-duplicated and attributed.

## Hand-off to next

Lint parity is reachable; P4 unifies these onto the shared graph so the cycle/orphan logic
lives in exactly one place.
