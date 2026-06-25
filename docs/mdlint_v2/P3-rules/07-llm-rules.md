# P3.07 · LLM rules (SIZE-001, LLM-001)

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Preserve the MVP's LLM context-hygiene features ([D3](../index.md)) as first-class rules in
the new engine, so the original PLAN.md mission rides on top of the doc-integrity rules.

## Sequence

- **Previous:** [P2.07 — First rules + `lint`](../P2-rule-engine/07-first-rules-lint-command.md)
  already introduced SIZE-001 as the engine proof; this task finishes it and adds LLM-001.
- **Next:** [P3.08 — custom rule](08-custom-rule.md), [P3.09 — cutover](09-rule-tests-and-cutover.md).
- **Depends on:** P2.07 + the relocated MVP `llm/{imports,budget}` ([P0.04](../P0-foundations/04-migrate-mvp-to-core.md)) ·
  **Parallel with:** P3.02–P3.06 · **Blocks:** P3.09.

## Rules

| ID | Scope | Severity | Checks | Key options |
| --- | --- | --- | --- | --- |
| SIZE-001 | document | configurable | file over byte/token budget | `maxBytesDefault`, `overrides[{pattern,maxBytes}]`, `maxTokens?` |
| LLM-001 | project | configurable | eager-import budget per entrypoint over limit | `entrypoints`, `maxTokensPerEntrypoint`, per-type limits? |

## Deliverables / steps

1. SIZE-001: per-file byte/token check (reuse MVP `estimateTokens = ceil(len/4)`, kept behind
   one function so a real tokenizer can replace it later); glob overrides.
2. LLM-001: build the eager-import tree from `ParsedDocument.imports`
   ([P1.03](../P1-parsed-document/03-references-extraction.md)), sum own+imported tokens per
   entrypoint, report over-limit with percentage; surface cycles/missing imports as the MVP did.
3. Express both through the engine (metadata + options schema), not as bespoke pipeline steps.

## Decisions applied

- [D3](../index.md) preserve LLM features as rules · isolated token estimator (swappable) ·
  [R3](../requirements/02-rules-engine.md) structured findings (token totals, % over).

## Exit criteria

- [ ] SIZE-001 and LLM-001 pass unit + fixture tests (overrides, budgets, cycles).
- [ ] The MVP's size / eager-import / context-budget behavior is fully represented.

## Hand-off to next

These rules also feed the compiled skill's context-budget summary
([S6](../requirements/04-skills-compile.md), P5) and the import edges in the graph (G1, P4).
