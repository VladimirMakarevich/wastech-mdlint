# P5.06 · Compile tests & fixtures

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Lock compile behavior: deterministic content, correct sections, presets, budget, and CLI I/O.

## Sequence

- **Previous:** [P5.05 — compile config + CLI](05-compile-config-cli.md).
- **Next:** **Phase P6 — `init` command** (see [roadmap](../index.md)).
- **Depends on:** P5.01–P5.05 · **Blocks:** P7's `compile-context` confidence.

## Deliverables / steps

1. Unit tests: header/frontmatter (schema-valid), architecture/rules/dependencies/workflow
   sections, command presets (`claude|generic|none`), budget summary, metadata counts, CJK,
   empty/edge cases, and compile-without-`config.compile` (throws).
2. **Determinism test:** two runs over the same input produce byte-identical output (S4).
3. e2e: `compile` writes to default + custom `--outdir`; `--dry-run` writes nothing.

## Decisions applied

- Determinism ([S4](../requirements/04-skills-compile.md)) · frontmatter schema
  ([S1](../requirements/04-skills-compile.md)) · focused fixtures (AGENTS.md).

## Exit criteria

- [ ] All sections + presets + budget covered; determinism test green.
- [ ] `--dry-run` / `--outdir` behavior verified.
- [ ] Phase P5 [exit criteria](index.md) satisfied.

## Hand-off to next

P6 builds `init`; P7 wraps `compileContext` as the MCP `compile-context` tool with the same
deterministic output.
