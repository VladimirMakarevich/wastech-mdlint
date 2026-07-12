# P6.04 · Config writer + local `$schema` wiring

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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
   add rationale **comments** (JSONC, [C4](../requirements/01-configuration.md)). On **merge**
   ([P6.03](03-interactive-prompts.md), audit — P6 merge gap) apply *additive, existing-wins*:
   preserve every existing `rules[]` entry (severity/options) and only append inferred rules
   whose canonical ID is absent; do not touch existing `include`/`exclude`/`settings`.
2. **Schema wiring** ([I3](../requirements/06-installation.md)/[C9](../requirements/01-configuration.md)):
   default `$schema` to the local package path; if custom rules exist, call the frozen
   `generateConfigSchema({ customRules })` ([P2.06 frozen API](../P2-rule-engine/06-schema-generation.md),
   audit 4.1) to write a project-local schema and point `$schema` there. **No remote URL.**
3. Optional ([I6](../requirements/06-installation.md)): offer to drop
   `.github/workflows/wastech-mdlint.yml` — ask first, don't write silently. **Shipped as a
   self-contained workflow** (`npm install --no-save @wastech-mdlint/cli` +
   `npx wastech-mdlint lint …`) rather than a `uses:` reference to the first-class composite Action:
   that Action is [P9.03](../P9-release/03-github-action.md) (Not started), so a `uses:` template
   would be a dead workflow when P6 lands. P9.03 owns swapping this template to the published `uses:`
   form once the Action exists. The workflow is anchored at the repository root (where GitHub loads
   workflows) and, for a subdirectory config, scopes lint to the config's directory and passes
   `--config` (both single-quoted) so the run resolves `include`/`exclude` against the right tree.
4. Print a summary of what was written (repository-relative POSIX paths).

## Decisions applied

- [C3](../requirements/01-configuration.md), [C4](../requirements/01-configuration.md),
  [C9](../requirements/01-configuration.md) · [I3](../requirements/06-installation.md),
  [I6](../requirements/06-installation.md).

## Exit criteria

- [x] Valid config written with canonical IDs + local `$schema`; no remote URL.
- [x] Project schema generated when custom rules are present.
- [x] CI workflow offered (opt-in), not written silently.

## Implementation notes

Decisions that are load-bearing but not obvious from the code:

- **Core generates text, the CLI writes files.** `generateInitConfig` (core) is pure and fs-free —
  it returns the config bytes, the resolved `$schema`, and (when custom rules are present) the
  project schema; `init-command.ts` performs the actual `writeFile`s. Same split as `compile`/`schema`.
- **Fresh writes always emit `exclude`.** The scanner deliberately prunes noise directories
  (`node_modules`, `.git`, `dist`, …), so the written config carries them as an `exclude` list —
  otherwise a config whose `include` falls back to `**/*.md` would re-scan exactly the trees init
  ignored (C1). `merge` never touches an existing `exclude`.
- **Merge is validated through the real loader before writing.** Additive merge preserves the
  existing content verbatim, so the result is only valid if the existing config already loads. The
  merge path runs `loadConfiguration` on the existing file and aborts (writes nothing) on an unknown
  top-level key, unknown rule id, or invalid preserved options — the acceptance bar is a *valid*
  config, and reporting success while writing one the loader rejects would violate it.
- **Merge safety keys entries by identity, not the literal `rule` field.** A built-in is identified
  by its canonical `rule`; a `custom` entry by its canonical `id` (never the string `"custom"`).
  A merge aborts when any entry can't be canonically identified — a bare string, a non-string
  `rule`, or a `custom` entry with a missing/non-string/non-schemaable `id` — because an
  unidentifiable entry can't be diffed against the inferred set without risking a silent duplicate.
- **`$schema` and workflow anchor on discovered roots, not fixed literals.** `$schema` is computed
  relative to the config's own directory (anchored on the actual installed `schema.json`, else the
  repo root), so a subdirectory config points up at the hoisted `node_modules` (`../node_modules/…`).
  The workflow anchors at the `.git` root when one exists (a nested workspace package still anchors
  at the real repo root, not `packages/foo`), falling back to the nearest `package.json`/`node_modules`
  outside git.
- **`skip` is a strict no-write outcome**, and a Ctrl+C at the *post-write* CI-workflow prompt is
  treated as "no workflow" (the config/schema are already on disk, so the write summary must still
  print rather than the whole command unwinding to look like a no-op).
- **CI template is self-contained, not `uses:`** — see deliverable 3; `buildCiWorkflowYaml` is the
  single swap point once P9.03 publishes the Action.

## Hand-off to next

P6.05 verifies the written config lints cleanly; P8's `-init` skill calls this CLI `init` and
adds the README/GitHub Actions orchestration on top.
