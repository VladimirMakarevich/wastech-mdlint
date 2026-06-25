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

1. `describeRules(config.rules)` → grouped descriptions by category (Table Structure, Section
   Order, Project Structure, References, Checklist, Content Quality, Graph Integrity, LLM).
2. Pull text/category from the metadata source ([R6](../requirements/02-rules-engine.md)) — one
   source feeds README, schema, and this.
3. Describe **custom rules** ([R9](../requirements/02-rules-engine.md)) too (target + assertion
   summary), so compiled skills reflect project-specific rules.

## Decisions applied

- [R6](../requirements/02-rules-engine.md) metadata-driven · [R9](../requirements/02-rules-engine.md)
  describe custom rules.

## Exit criteria

- [ ] Built-in + LLM + custom rules all produce readable, grouped descriptions.
- [ ] Descriptions come from the metadata source (no duplicate text).

## Hand-off to next

P5.04 places these under the "Document Rules" section of the synthesized skill.
