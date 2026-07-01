# P8.02 · `wastech-mdlint-init` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Author the bootstrap skill that orchestrates the CLI `init` and layers GitHub Actions/README
on top — an AI-driven wrapper over a now self-sufficient CLI.

## Sequence

- **Previous:** [P8.01 — Frontmatter schema](01-frontmatter-schema-model.md) and the CLI
  `init` ([P6](../P6-init/index.md)).
- **Next:** [P8.05 — Skills validation](05-skills-validation.md).
- **Depends on:** P8.01, P6 · **Parallel with:** P8.03, P8.04.

## Deliverables / steps

1. `skills/wastech-mdlint-init/SKILL.md` with valid frontmatter (P8.01).
2. Workflow: detect existing config → run smart CLI `init` ([P6](../P6-init/index.md), which
   now does cluster detection + inference) → confirm draft → install `@wastech-mdlint/cli`
   via the detected package manager → run `lint` once → **offer** GitHub Actions + README
   (ask first).
3. Since the CLI `init` is smart ([I2](../requirements/06-installation.md)), the skill
   **orchestrates** rather than re-implements inference.
4. Host-neutral, no Claude-specific syntax; placeholders → our repo
   ([S7](../requirements/04-skills-compile.md)).

## Decisions applied

- [I2](../requirements/06-installation.md) (skill orchestrates smart CLI) ·
  [S7](../requirements/04-skills-compile.md) host-neutral.

## Exit criteria

- [ ] Skill bootstraps a repo end-to-end via CLI `init` + optional CI/README.
- [ ] Frontmatter valid; content host-neutral.

## Hand-off to next

P8.05 validates this skill; cross-links to `-fix`/`-impact` for follow-up actions.
