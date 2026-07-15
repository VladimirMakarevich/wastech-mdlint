# P8.01 · Frontmatter schema + unified skill model

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Reuse the typed SKILL.md frontmatter schema (defined and exported by core in
[P5.04](../P5-compile/04-synthesize.md), S1) and build the unified skill model + a validator that
covers both static and generated skills.

## Sequence

- **Previous:** [P7.05 — MCP integration tests & docs](../P7-mcp-server/05-integration-tests-docs.md)
  (the surface skills reference).
- **Next:** [P8.02](02-skill-init.md), [P8.03](03-skill-fix.md), [P8.04](04-skill-impact.md).
- **Depends on:** P7 done · **Blocks:** all skill authoring + validation.

## Deliverables / steps

1. **Reuse the core frontmatter Zod schema** ([S1](../requirements/04-skills-compile.md)) exported
   in [P5.04](../P5-compile/04-synthesize.md) (`name`, `description`, `license`, `compatibility`,
   `metadata.{homepage, source}`) — do **not** redefine it. P5 is its first consumer; a single
   schema keeps generated and static skills provably identical (S1). If static skills need extra
   fields, extend the core schema, don't fork it.
2. **Unified skill model** ([S5](../requirements/04-skills-compile.md)):
   `{ id, kind: "static" | "generated", path, frontmatter }` — shared by static skills and the
   compiler output (P5).
3. A validation entry point usable from CI (P8.05) and by the compiler's frontmatter check
   ([P5.04](../P5-compile/04-synthesize.md)), both wrapping the one core schema.

## Decisions applied

- [S1](../requirements/04-skills-compile.md) schema · [S5](../requirements/04-skills-compile.md) model.

## Exit criteria

- [x] Skill model + validator defined and exported, both bound to the **core** frontmatter schema
      (from P5.04) — not a second copy.
- [x] One validator covers static + generated skills.

## Implementation notes

- **Two entry points, one schema.** The model + validator live in the new
  `packages/core/src/skills/skill-model.ts` and *import* `skillFrontmatterSchema` from
  `compile/skill-frontmatter.js`; the frontmatter schema was **not** moved out of `compile/`
  (that module is done and byte-stable, and P5's imports point at it). Two wrappers exist because
  the two callers need opposite ergonomics: `validateSkill` (non-throwing `safeParse`, sorted
  issues) serves P8.05 CI, which must report every bad skill in one pass; `parseSkillFrontmatter`
  (throwing) serves `synthesize`, whose existing ZodError-on-invalid contract is pinned by a test.
  `synthesize` now routes through `parseSkillFrontmatter`, so the compiler is a genuine consumer of
  the shared validator rather than merely importing the same schema.
- **`path` is validated, not trusted.** `Skill.path` is public core data, so `skillModelSchema`
  enforces the repo-relative POSIX invariant in core instead of leaving normalization to callers:
  it rejects backslash separators, drive/absolute roots, and any empty/`.`/`..` segment (which also
  rules out `//`, trailing slashes, `./` prefixes, and root-escaping). Rejection surfaces as a
  validation issue rather than silent normalization, so CI can point at the offending skill.
- **Determinism.** `validateSkill` sorts its issue array (by path, then message) so a multi-skill
  report is stable regardless of Zod's internal issue order.

## Hand-off to next

P8.02–P8.04 author skills whose frontmatter validates against this schema.
