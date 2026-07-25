# P11.14 · `init`-scan honesty + CLI-plumbing micro-fixes

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Findings **L-7 … L-11**
> ([post-P9 audit](../audit-2026-07-25-post-p9.md)). Depends on
> [P11.08](08-init-exclude-anchoring.md) (same config-writer / `init` surface).

## Goal

Close the remaining LOW `init`-scan and CLI-plumbing gaps in one pass over the shared surface, so
`init` proposes and writes an honest config and the small CLI seams behave as documented.

## Problem (from the audit)

- **L-7 — `init` proposes hidden/gitignored trees as doc clusters.** `discovery/repo-scan.ts:126`
  prunes only `DEFAULT_NOISE_DIR_NAMES`; `.gitignore` is read nowhere. `.github/**`, `.venv/**`, and
  `generated-docs/**` land in `include`, and since the written config leaves `respectGitignore` at its
  `false` default, they are linted.
- **L-8 — `merge` silently destroys all JSONC comments.** `config-writer.ts:365-371` re-serializes
  preserved keys via `JSON.stringify`. Acknowledged in-code (`config-writer.ts:24-26`) but not
  reported: `formatWriteSummary` (`init-command.ts:553-556`) says only "Merged X: 1 new rule(s)
  appended", while [`docs/guide/configuration.md:5`](../../guide/configuration.md) advertises comments
  as a feature.
- **L-9 — deselecting all clusters inverts to "lint the whole repo".**
  `init-command.ts:640-644` → `include: []` → `config-writer.ts:376` omits the key → `lintFiles`
  substitutes `**/*.md`. The fake prompter always returns all clusters
  (`init.e2e.test.ts:103`), so the case is untested.
- **L-10 — written `$schema` dangles in the normal `npx` scenario.** `init-command.ts:773` emits
  `./node_modules/@wastech-mdlint/cli/schema.json` when there is no local dependency — a path that
  does not exist. Six tests assert the string (`init.e2e.test.ts:391,425,706,805,875,916`); none
  assert the target exists.
- **L-11 — micro-fixes.** `schema --out <relative>` resolves from `process.cwd()` not the io-seam
  `cwd` (`commands.ts:356`, though `handleCompile` fixed this class at `:384-391`); `pnpm-workspace.yaml`
  is truncated at the first blank line (`workspace-packages.ts:82-84`); `detectPackageManager` looks
  only at the root (`package-manager.ts:28-52`); `readExistingRuleIds` (`init-command.ts:237-247`) has
  no production caller yet 11 tests over 127 lines; two CI-workflow decline paths return `undefined`
  silently (`init-command.ts:500-507`); no top-level rejection handler in the bin (`index.ts:14`).

## Deliverables / steps

1. **L-7:** read `.gitignore` during the repo scan (or default the written `respectGitignore` to
   `true`) so hidden/ignored trees are not proposed or linted. Keep the default explicit and
   documented.
2. **L-8:** report comment loss in `formatWriteSummary` when a `merge` re-serializes a
   comment-bearing config (e.g. "merged; JSONC comments were not preserved"), so the guide's promise
   and the behavior agree.
3. **L-9:** treat "all clusters deselected" as an explicit choice (write an empty/interactive-confirmed
   include, or re-prompt) rather than silently inverting to whole-repo; cover it with a prompter that
   returns no clusters.
4. **L-10:** make the written `$schema` point at a target that exists in the `npx` scenario (or fall
   back to a resolvable local path), and add a test that the referenced schema file exists.
5. **L-11:** resolve the `schema --out` relative path from the io-seam `cwd` (mirror `:384-391`); parse
   the whole `pnpm-workspace.yaml`; broaden `detectPackageManager` beyond the root where sensible;
   remove or wire `readExistingRuleIds`; make the CI-decline paths return an explicit result; add a
   top-level rejection handler in `index.ts` (coordinate with [P11.01](01-cli-bin-noop.md)).

## Out of scope

The `exclude` anchoring fix (M-4) — that is [P11.08](08-init-exclude-anchoring.md). This task assumes
that landed. Each L-11 item is small and independently testable; none require redesign.

## Exit criteria

- [ ] `init` does not propose or lint hidden/gitignored trees (`.github`, `.venv`, `generated-docs`).
- [ ] A `merge` over a comment-bearing config reports that comments were not preserved.
- [ ] Deselecting all clusters does not silently lint the whole repo; the case is tested.
- [ ] The written `$schema` resolves to an existing file in the `npx` scenario, asserted by a test.
- [ ] The L-11 micro-fixes are addressed, each with a focused test where behavior changed.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
