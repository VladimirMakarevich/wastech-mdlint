# P11.04 · Bound `findConfig` walk-up + honest prompt path

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Audit finding **H-3** (data loss outside the project,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

`init` must not reach outside the project to decide which config to overwrite, and it must show the
user the honest path of a config it found.

## Problem (from the audit)

`packages/core/src/config/find-config.ts:21-37` walks up to the **filesystem root** with no boundary.
Its consumer `packages/cli/src/init-command.ts:604-619` then re-points `cwd` at
`path.dirname(existingConfigPath)`. Reproduced: `init .` inside a fresh empty sub-project overwrote
the **parent directory's** config (destroying `"include":["parent-only.md"]`) and wrote nothing to
the target.

Two aggravating details:

1. **Inconsistent boundary.** `findRepositoryRoot` (`init-command.ts:419-450`) and
   `findInstalledSchemaDir` (`:459-467`) already stop at `os.homedir()` with a comment about exactly
   this danger. The one walk that decides **which file to clobber** is unbounded.
2. **Dishonest prompt.** `relativeConfigPath` (`init-command.ts:616-619`) is computed as
   `path.relative(cwd, existingConfigPath)` **after** `cwd` was re-pointed at that config's own
   directory, so `../../wastech-mdlint.config.json` can never render. The prompt
   (`init-prompter.ts:44`) says "An existing config was found at `wastech-mdlint.config.json`" even
   when it is three directories up.

Additionally, an explicit `[path]` argument is silently ignored when any ancestor has a config:
`init packages/foo --yes --on-existing overwrite` overwrote the repo-root config and created nothing
under `packages/foo`. [`docs/guide/cli.md`](../../guide/cli.md) documents `[path]` as "Directory to
scan" and says nothing about root override.

## Deliverables / steps

1. Bound the `findConfig` walk-up at the repository root (or `os.homedir()`, matching its siblings in
   `init-command.ts`). Keep `--config` override behavior unchanged.
2. Compute the user-facing path relative to the **original** `cwd`, before any re-pointing, so a
   config found in an ancestor renders as `../…`. Align the prompt text (`init-prompter.ts:44`).
3. When `[path]` is given explicitly, do not re-root onto a discovered ancestor config — honor the
   target directory. Reconcile [`docs/guide/cli.md`](../../guide/cli.md) with the final behavior.
4. Tests: `init .` in a sub-project with a parent config does not touch the parent; the prompt shows
   the true relative path; explicit `[path]` writes to that path and leaves ancestors untouched.

## Out of scope

Changing `findConfig`'s role in the normal `lint` load path beyond adding the boundary. This task
constrains the walk and fixes the `init` consumer; it does not redesign config discovery.

## Exit criteria

- [ ] `findConfig` stops at the repository root / home boundary, consistent with `init-command.ts`.
- [ ] `init .` in a nested empty project never overwrites an ancestor's config.
- [ ] The existing-config prompt shows the path relative to the original `cwd` (e.g. `../../…`).
- [ ] An explicit `[path]` is honored, not overridden by a discovered ancestor config.
- [ ] Regression tests cover the nested-project and explicit-`[path]` cases.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
