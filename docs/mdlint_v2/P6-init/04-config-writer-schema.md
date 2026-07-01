# P6.04 · Config writer + local `$schema` wiring

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Write the final config and wire it to the **local** schema, optionally dropping a CI workflow.

## Sequence

- **Previous:** [P6.03 — Interactive prompts](03-interactive-prompts.md) (confirmed selections).
- **Next:** [P6.05 — init tests](05-init-tests.md).
- **Depends on:** P6.03 + schema generator ([P2.06](../P2-rule-engine/06-schema-generation.md)) ·
  **Blocks:** P6.05.

## Deliverables / steps

1. Write `wastech-mdlint.config.json` in `cwd`: `$schema` (local path), `include`/`exclude`,
   and `rules` using **canonical IDs** ([C3](../requirements/01-configuration.md)); optionally
   add rationale **comments** (JSONC, [C4](../requirements/01-configuration.md)).
2. **Schema wiring** ([I3](../requirements/06-installation.md)/[C9](../requirements/01-configuration.md)):
   default `$schema` to the local package path; if custom rules exist, run the schema
   generator to write a project-local schema and point `$schema` there. **No remote URL.**
3. Optional ([I6](../requirements/06-installation.md)): offer to drop
   `.github/workflows/wastech-mdlint.yml` referencing the published GitHub Action (P9) —
   ask first, don't write silently.
4. Print a summary of what was written.

## Decisions applied

- [C3](../requirements/01-configuration.md), [C4](../requirements/01-configuration.md),
  [C9](../requirements/01-configuration.md) · [I3](../requirements/06-installation.md),
  [I6](../requirements/06-installation.md).

## Exit criteria

- [ ] Valid config written with canonical IDs + local `$schema`; no remote URL.
- [ ] Project schema generated when custom rules are present.
- [ ] CI workflow offered (opt-in), not written silently.

## Hand-off to next

P6.05 verifies the written config lints cleanly; P8's `-init` skill calls this CLI `init` and
adds the README/GitHub Actions orchestration on top.
