# P8.05 · Skill validation tests + host-neutrality check

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Validate all three skills against the schema and assert host-neutrality + correct surface
references.

## Sequence

- **Previous:** the three skills ([P8.02](02-skill-init.md), [P8.03](03-skill-fix.md),
  [P8.04](04-skill-impact.md)).
- **Next:** **Phase P9 — Distribution & release** (see [roadmap](../index.md)).
- **Depends on:** P8.02–P8.04 · **Blocks:** single-tag release (P9).

## Deliverables / steps

1. CI test: every `skills/*/SKILL.md` frontmatter validates against the schema
   ([P8.01](01-frontmatter-schema-model.md)/[S1](../requirements/04-skills-compile.md)).
2. **Host-neutrality check** ([S7](../requirements/04-skills-compile.md)): no Claude-specific
   command-injection syntax; placeholders (`vladimir-makarevich` / `wastech-ctxlint.dev`) are
   gone, replaced with `VladimirMakarevich/wastech-ctxlint`.
3. Sanity-check referenced commands/tools exist in the actual CLI/MCP surface
   (a guard against skill ↔ product drift).

## Decisions applied

- [S1](../requirements/04-skills-compile.md), [S5](../requirements/04-skills-compile.md),
  [S7](../requirements/04-skills-compile.md).

## Exit criteria

- [ ] All skills pass frontmatter validation in CI.
- [ ] Host-neutrality + placeholder checks pass; referenced commands/tools exist.
- [ ] Phase P8 [exit criteria](index.md) satisfied.

## Hand-off to next

P9 tags the validated skills together with the npm packages under one version (I4/I7).
