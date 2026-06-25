# P5.04 · `synthesize` → `CompileResult`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Assemble the final `SKILL.md` — deterministic, host-neutral, schema-valid, and
budget-aware — and return `CompileResult`.

## Sequence

- **Previous:** [P5.02 — Doc profile](02-doc-profile.md) and [P5.03 — Describe rules](03-describe-rules.md).
- **Next:** [P5.05 — compile config + CLI](05-compile-config-cli.md).
- **Depends on:** P5.02, P5.03 · **Blocks:** P5.05.

## Deliverables / steps

1. `synthesize(...)` → `{ skillContent, metadata: { documentCount, ruleCount, componentCount } }`,
   assembling: frontmatter + sections **Document Architecture** (file tree + roles + document
   types), **Document Rules**, **Document Dependencies**, **Workflow**, gated by
   `compile.sections`.
2. **Host-neutral commands** ([S2](../requirements/04-skills-compile.md)): the dependencies
   block is templated by `compile.commandPreset` (`claude|generic|none`); default = plain
   instructions + MCP-tool reference (no `!npx … $ARGUMENTS`).
3. **Determinism + provenance** ([S4](../requirements/04-skills-compile.md)): sorted, no
   timestamps; header "generated from N docs, M rules" + a content hash.
4. **Context-budget summary** ([S6](../requirements/04-skills-compile.md)): reuse the
   SIZE/LLM estimator ([P3.07](../P3-rules/07-llm-rules.md)) — corpus token estimate +
   entrypoints over budget.
5. **Frontmatter schema** ([S1](../requirements/04-skills-compile.md)): validate the emitted
   frontmatter against the shared SKILL.md schema.

## Decisions applied

- [S1, S2, S4, S6](../requirements/04-skills-compile.md) · ([S3 skipped — English scaffold](../requirements/04-skills-compile.md)).

## Exit criteria

- [ ] Output is byte-stable across runs; hash/provenance header present.
- [ ] Command block respects the preset; default is host-neutral.
- [ ] Budget section present; frontmatter validates against the schema.

## Hand-off to next

P5.05 wires config + the CLI command to write/preview this `CompileResult`.
