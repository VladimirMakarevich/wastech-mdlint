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
| SIZE-001 | document | configurable | file over byte / line / token budget | `bytes?:{warn?,error?}`, `lines?:{warn?,error?}`, `tokens?:{warn?,error?}`, `overrides[{pattern,bytes?,lines?,tokens?}]` |
| LLM-001 | project | configurable | eager-import budget per entrypoint over limit | `entrypoints`, `maxTokensPerEntrypoint`, per-type limits? |

## SIZE-001 — Configuration schema

Each metric is optional; omitting it disables that check entirely.

```jsonc
{
  "rule": "SIZE-001",
  "options": {
    "bytes":  { "warn": 49152, "error": 65536 },  // 48 KB warn, 64 KB error
    "lines":  { "warn": 300,   "error": 500 },
    "tokens": { "warn": 1500,  "error": 3000 },
    "overrides": [
      { "pattern": "CLAUDE.md",          "bytes": { "warn": 24576, "error": 32768 } },
      { "pattern": "skills/**/SKILL.md", "bytes": { "warn": 18432, "error": 24576 } }
    ]
  }
}
```

Threshold semantics:

- A file crossing `warn` but not `error` → `severity: "warning"` finding — printed to console,
  does **not** trigger `--fail-on error` exit.
- A file crossing `error` → `severity: "error"` finding — exits non-zero under `--fail-on error`.
- The C2 `severity` rule override acts as a **ceiling clamp**: `"severity": "warning"` downgrades
  even error-threshold crossings to warnings; `"severity": "error"` upgrades warn-threshold findings;
  `"severity": "off"` suppresses all SIZE-001 output (R1).
- Each `overrides` entry supplies independent per-metric thresholds; unspecified metrics fall back to
  the top-level `bytes`/`lines`/`tokens` options.

## Deliverables / steps

1. SIZE-001: per-file **byte / line / token** check.
   - **Line count:** count `\n` occurrences in the raw source (or `ParsedDocument` line metadata if
     available).
   - **Token estimate:** reuse MVP `estimateTokens = ceil(len/4)`, kept behind one function so a
     real tokenizer can replace it later.
   - **Two-tier thresholds:** each metric (`bytes`, `lines`, `tokens`) may declare an optional
     `warn` threshold and/or an optional `error` threshold independently. A finding is emitted at
     `"warning"` severity when only the `warn` threshold is crossed; at `"error"` severity when the
     `error` threshold is crossed. Both may fire for the same metric if both thresholds are set and
     the file exceeds them (only the `error` one matters for CI, but both appear in the report).
   - **C2 clamp:** see threshold semantics above (R1).
   - **Glob overrides:** each entry in `overrides` supplies independent `bytes`/`lines`/`tokens`
     thresholds for a pattern, falling back to top-level options for unspecified metrics.
   - **Structured finding data (R3):** `data: { metric, actual, warnAt?, errorAt? }` on every
     SIZE-001 `LintMessage`.
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
