# P8.02 · `wastech-mdlint-init` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

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

- [x] Skill bootstraps a repo end-to-end via CLI `init` + optional CI/README.
- [x] Frontmatter valid; content host-neutral.

## Hand-off to next

P8.05 validates this skill; cross-links to `-fix`/`-impact` for follow-up actions.

## Implementation notes

`skills/wastech-mdlint-init/SKILL.md` is the sole deliverable — a hand-authored, host-neutral
skill, no product code. Frontmatter uses only the keys P8.01's `.strict()` schema permits
(`name`, `description`, `license`, `compatibility`, `metadata.{homepage,source}`); habitual
agent-skill fields (`version`, `allowed-tools`, `tags`) are deliberately absent so it will
pass P8.05's standing validation sweep.

Non-obvious decisions the prose encodes, and why:

- **Transient `init` before the persistent install.** The config should exist before the repo
  commits to a devDependency, so step 2 runs `init` via a package runner (`npx -y`, `pnpm dlx`,
  …) and only step 4 installs the CLI. This resolves a chicken-and-egg the task's linear step
  order glosses over.
- **Version-coupling is enforced in the commands, not just claimed.** Because the skill and CLI
  ship from one P-release tag ([I4/I7](../requirements/06-installation.md)), a bare `@wastech-mdlint/cli`
  (resolves to latest) could pull an incompatible CLI even from a pinned skill install. Every
  run/install command pins `@wastech-mdlint/cli@<skill-version>`, and the README example uses the
  pinned `gh skill install … --pin vX.Y.Z` form. The `compatibility` value is same-tag wording,
  not a version floor; its concrete tag is owned by the P-release single-tag release.
- **Everything runs from the effective init root.** `init` re-roots detection to the found
  config's directory (or the target when none exists), which is also the correct
  package-manager root for a nested `packages/foo/`. The skill `cd`s there once and runs `init`,
  install, `lint`, and any CI rerun from that one directory, so the package manager, written
  config, and lint scope stay aligned — avoiding wrong-project installs and path-doubling.
- **CI workflow is CLI-owned; the README is skill-owned.** The workflow is routed through
  `init --with-ci-workflow` (never hand-authored YAML) to keep it single-sourced. Adding CI
  after the fact means rerunning `init`, and the rerun must reuse the _same_ existing-config
  disposition: `merge` appends only, `overwrite` rebuilds from inference and drops preserved
  `include`/`exclude`/`settings`, so they are not interchangeable. `--on-existing` is documented
  as honored only under `--yes` (interactive reruns answer the prompt instead).
- **No-write outcomes are handled.** `init`'s `skip` and unreadable-`merge` abort produce no
  usable config/PM report, so the skill stops and asks rather than proceeding through
  install/lint on a draft that was never written.

The skill orchestrates and never re-implements inference ([I2](../requirements/06-installation.md));
placeholders resolve to `VladimirMakarevich/wastech-mdlint` per [S7](../requirements/04-skills-compile.md).
No glossary change: `static skill` and `skills/<skill-name>/SKILL.md` are already defined and this
is an instance of them, not a new term.
