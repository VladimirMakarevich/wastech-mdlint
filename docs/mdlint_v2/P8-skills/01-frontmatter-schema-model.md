# P8.01 · Frontmatter schema + unified skill model

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Define the typed SKILL.md frontmatter schema and the unified skill model that validates both
static and generated skills.

## Sequence

- **Previous:** [P7.05 — MCP integration tests & docs](../P7-mcp-server/05-integration-tests-docs.md)
  (the surface skills reference).
- **Next:** [P8.02](02-skill-init.md), [P8.03](03-skill-fix.md), [P8.04](04-skill-impact.md).
- **Depends on:** P7 done · **Blocks:** all skill authoring + validation.

## Deliverables / steps

1. Zod **frontmatter schema** ([S1](../requirements/04-skills-compile.md)):
   `name`, `description`, `license`, `compatibility`, `metadata.{homepage, source}`.
2. **Unified skill model** ([S5](../requirements/04-skills-compile.md)):
   `{ id, kind: "static" | "generated", path, frontmatter }` — shared by static skills and the
   compiler output (P5).
3. A validation entry point usable from CI (P8.05) and from the compiler's frontmatter check
   ([P5.04](../P5-compile/04-synthesize.md)).

## Decisions applied

- [S1](../requirements/04-skills-compile.md) schema · [S5](../requirements/04-skills-compile.md) model.

## Exit criteria

- [ ] Frontmatter schema + skill model defined and exported.
- [ ] One validator covers static + generated skills.

## Hand-off to next

P8.02–P8.04 author skills whose frontmatter validates against this schema.
