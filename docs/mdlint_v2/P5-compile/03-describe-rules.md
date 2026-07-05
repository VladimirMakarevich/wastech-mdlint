# P5.03 · `describeRules`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Render human-readable rule descriptions for the generated skill from the **single rule
metadata source** — not raw config JSON.

## Sequence

- **Previous:** [P5.01 — Graph analysis](01-graph-analysis.md).
- **Next:** [P5.04 — Synthesize](04-synthesize.md).
- **Depends on:** the metadata source ([P2.03](../P2-rule-engine/03-registry-metadata.md)) ·
  **Blocks:** P5.04.

## Deliverables / steps

1. `describeRules(configuredRules, registry)` → descriptions grouped by the real
   `RuleMetadata.category` codes. There are **8** built-in category codes
   (`engine/types.ts` — `TBL | SEC | STR | REF | CTX | GRP | SIZE | LLM`), plus `custom`; the
   grouping key is the category code, and any human-friendly labels must be a **total** map over
   all 8 (e.g. Table Structure `TBL`, Sections `SEC`, Project Structure `STR`, References `REF`,
   Content/Context `CTX`, Graph Integrity `GRP`, Size `SIZE`, LLM `LLM`). Note: there is **no
   `CHK` category** — checklist completeness is `CTX-002`, so "Checklist" and "Content Quality"
   are the same `CTX` group (3 rules), and `SIZE` (SIZE-001) must not be dropped.
2. Resolve enabled built-ins from `config.rules`, but pull their text/category from
   `ruleRegistry.getAllMetadata()` ([R6](../requirements/02-rules-engine.md)) — the **same**
   source `generateRuleDocs` (the README rule table, `engine/rule-docs.ts`) already consumes.
   Reuse that metadata read; do not fork a parallel one.
3. Describe **custom rules** ([R9](../requirements/02-rules-engine.md)) too — derive each from its
   `custom` config entry (`description` / `target` / `assert` summary), so compiled skills reflect
   project-specific rules.

## Decisions applied

- [R6](../requirements/02-rules-engine.md) metadata-driven · [R9](../requirements/02-rules-engine.md)
  describe custom rules.

## Exit criteria

- [ ] Built-in + LLM + custom rules all produce readable, grouped descriptions.
- [ ] Descriptions come from the metadata source (no duplicate text).

## Hand-off to next

P5.04 places these under the "Document Rules" section of the synthesized skill.
