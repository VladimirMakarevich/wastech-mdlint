# P3.09 · Rule tests, README table, schema sync, `scan→lint` cutover

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Close the lint-parity milestone: full test coverage, generated docs/schema, and the
`scan → lint` cutover that removes the legacy legacy pipeline.

## Sequence

- **Previous:** all rule families ([P3.02–P3.08](index.md)) implemented.
- **Next:** **Phase P4 — ContextGraph + graph/slice/impact** (see [roadmap](../index.md)).
- **Depends on:** P3.02–P3.08 · **Blocks:** start of P4 and the M2 milestone sign-off.

## Inputs (from previous work)

- All built-in + LLM + custom rules; the metadata source (P2.03) and schema generator (P2.06);
  the `lint` command + legacy `scan` from [P2.07](../P2-rule-engine/07-first-rules-lint-command.md).

## Deliverables / steps

1. **Coverage:** every rule has unit + focused-fixture tests; add a core-pipeline integration
   test running a representative ruleset over a fixture repo.
2. **Generated docs:** README rule table generated from the metadata source
   ([R6](../requirements/02-rules-engine.md)); `schema.json` regenerated; **sync test green**.
3. **`scan → lint` cutover** ([D4](../index.md)): make `scan` a hidden alias of `lint`,
   **remove the legacy legacy pipeline** and the old sectioned-config code paths (greenfield,
   [D2](../index.md)). Update `--help`.
4. Verify exit codes (0 pass / 1 findings / 2 operational) across the full ruleset.
5. Tick the Phase P3 [exit criteria](index.md).

## Decisions applied

- [D4](../index.md) cutover · [D2](../index.md) greenfield removal · [R6](../requirements/02-rules-engine.md)
  generated docs/schema.

## Exit criteria

- [ ] All 22 built-in + LLM + custom rules covered by tests; integration test green.
- [ ] README rule table + `schema.json` generated and in sync.
- [ ] `scan` is a hidden alias of `lint`; legacy pipeline removed; no dead code.
- [ ] **Milestone M2 (lint parity+) reached.**

## Hand-off to next

P4 begins with a complete, tested rule engine and a single `lint` entry point; it adds the
rich `ContextGraph` and refactors GRP rules onto it (R5/G6).
