# P11.14 · `init`-scan honesty + CLI-plumbing micro-fixes

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Findings **L-7 … L-11** ([post-P9 audit](../audit-2026-07-25-post-p9.md)). Depends on [P11.08](08-init-exclude-anchoring.md) (same config-writer / `init` surface).

## Goal

Close the remaining LOW `init`-scan and CLI-plumbing gaps in one pass over the shared surface, so `init` proposes and writes an honest config and the small CLI seams behave as documented.

## Problem (from the audit)

- **L-7 — `init` proposes hidden/gitignored trees as doc clusters.** `discovery/repo-scan.ts:126` prunes only `DEFAULT_NOISE_DIR_NAMES`; `.gitignore` is read nowhere. `.github/**`, `.venv/**`, and `generated-docs/**` land in `include`, and since the written config leaves `respectGitignore` at its `false` default, they are linted.
- **L-8 — `merge` silently destroys all JSONC comments.** `config-writer.ts:365-371` re-serializes preserved keys via `JSON.stringify`. Acknowledged in-code (`config-writer.ts:24-26`) but not reported: `formatWriteSummary` (`init-command.ts:553-556`) says only "Merged X: 1 new rule(s) appended", while [`docs/guide/configuration.md:5`](../../guide/configuration.md) advertises comments as a feature.
- **L-9 — deselecting all clusters inverts to "lint the whole repo".** `init-command.ts:640-644` → `include: []` → `config-writer.ts:376` omits the key → `lintFiles` substitutes `**/*.md`. The fake prompter always returns all clusters (`init.e2e.test.ts:103`), so the case is untested.
- **L-10 — written `$schema` dangles in the normal `npx` scenario.** `init-command.ts:773` emits `./node_modules/@wastech-mdlint/cli/schema.json` when there is no local dependency — a path that does not exist. Six tests assert the string (`init.e2e.test.ts:391,425,706,805,875,916`); none assert the target exists.
- **L-11 — micro-fixes.** `schema --out <relative>` resolves from `process.cwd()` not the io-seam `cwd` (`commands.ts:356`, though `handleCompile` fixed this class at `:384-391`); `pnpm-workspace.yaml` is truncated at the first blank line (`workspace-packages.ts:82-84`); `detectPackageManager` looks only at the root (`package-manager.ts:28-52`); `readExistingRuleIds` (`init-command.ts:237-247`) has no production caller yet 11 tests over 127 lines; two CI-workflow decline paths return `undefined` silently (`init-command.ts:500-507`); no top-level rejection handler in the bin (`index.ts:14`).

## Deliverables / steps

1. **L-7:** read `.gitignore` during the repo scan (or default the written `respectGitignore` to `true`) so hidden/ignored trees are not proposed or linted. Keep the default explicit and documented.
2. **L-8:** report comment loss in `formatWriteSummary` when a `merge` re-serializes a comment-bearing config (e.g. "merged; JSONC comments were not preserved"), so the guide's promise and the behavior agree.
3. **L-9:** treat "all clusters deselected" as an explicit choice (write an empty/interactive-confirmed include, or re-prompt) rather than silently inverting to whole-repo; cover it with a prompter that returns no clusters.
4. **L-10:** make the written `$schema` point at a target that exists in the `npx` scenario (or fall back to a resolvable local path), and add a test that the referenced schema file exists.
5. **L-11:** resolve the `schema --out` relative path from the io-seam `cwd` (mirror `:384-391`); parse the whole `pnpm-workspace.yaml`; broaden `detectPackageManager` beyond the root where sensible; remove or wire `readExistingRuleIds`; make the CI-decline paths return an explicit result; add a top-level rejection handler in `index.ts` (coordinate with [P11.01](01-cli-bin-noop.md)).

## Out of scope

The `exclude` anchoring fix (M-4) — that is [P11.08](08-init-exclude-anchoring.md). This task assumes that landed. Each L-11 item is small and independently testable; none require redesign.

## Exit criteria

- [x] `init` does not propose or lint hidden/gitignored trees (`.github`, `.venv`, `generated-docs`).
- [x] A `merge` over a comment-bearing config reports that comments were not preserved.
- [x] Deselecting all clusters does not silently lint the whole repo; the case is tested.
- [x] The written `$schema` resolves to an existing file in the `npx` scenario, asserted by a test.
- [x] The L-11 micro-fixes are addressed, each with a focused test where behavior changed.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

**L-7 — two causes, both fixed at the scan and mirrored in the write.** `.github`/`.venv` are _hidden_; `generated-docs` is _gitignored_. `collectMarkdownFiles` now prunes via the new shared `isPrunedDirName` (dot-prefixed OR in the noise list) and threads gitignore layers, and `collectPackageJsonDirs` uses the same predicate so workspace detection cannot disagree with the Markdown walk. The gitignore matcher was **extracted, not re-implemented**: `IgnoreLayer` / `readIgnoreLayer` / `isGitIgnored` moved verbatim out of `markdown/load-documents.ts` into `discovery/gitignore-layers.ts`, so the lint corpus and the pre-config scan share one implementation. The fresh write mirrors both prunes — a hidden-directory `exclude` glob alongside the existing noise globs, plus an explicit `respectGitignore: true`.

> **Divergence from [C8](../requirements/01-configuration.md).** C8 locks `respectGitignore`'s default to `false`, and this task asks `init` to make it `true`. Not a conflict: the **loader** default is untouched — `init` writes an explicit `true` into the file it generates, where it stays visible and editable. A config whose scan skipped gitignored trees but whose lint reads them is the defect; the requirement is about zero-config behavior, which is unchanged.

**L-8.** `parseExistingConfigFile` now reports `hasComments`, via a new core `containsJsoncComments` built on `jsonc-parser`'s scanner with trivia enabled (token-based, so a `//` inside a string value is not a false positive). One shared `COMMENT_LOSS_NOTE` is rendered twice: in `formatDraftSummary`'s merge line **before** `confirmDraft` — the point being that the user can still decline — and again in `formatWriteSummary`.

**L-9 — `include` is three-valued.** `undefined` omits the key (tool default), `[]` is written literally (lints nothing). The CLI decides with `clustersWereOffered`: deselecting offered clusters is a choice, finding none is not. `GeneratedInitConfig.wroteEmptyInclude` (required, not optional) forces the host to decide whether to surface it; both summaries distinguish the two empty cases.

**L-10.** `packageSchemaRef` became `string | undefined`, and the CLI passes `undefined` when `findInstalledSchemaDir` finds nothing instead of falling back to the repo root. The writer then generates a project-local `./schema.json` — the built-in schema when there are no custom rules — and points at it, so the ref always names a file that exists. `ProjectSchemaReason` (`custom-rules` | `no-installed-package`) rides along on `projectSchema` and on the CLI's `SchemaWriteOutcome`, because the summary's old hardcoded "(custom rules present)" parenthetical would otherwise be false in the new case.

The reason is a **guard**, not just a label. Generating the project schema on the ordinary `npx` path makes `resolveSchemaWriteOutcome`'s `overwritten` branch reachable in every repository for the first time, and `schema.json` is a name other tools already use (an OpenAPI document, a product schema). `--on-existing overwrite` is a disposition for the _config_ — the user never named `schema.json` — so that branch is now restricted to `reason === "custom-rules"`, where the file's contents are determined by the config being written. Under `no-installed-package` a differing existing file always degrades to `kept`, and the summary states the honest consequence: `$schema` points at a file `init` did not generate, so repoint it or move that file aside.

> **Extends [C9](../requirements/01-configuration.md).** C9 describes the project-local schema as the custom-rules case. It now also covers "no installed package schema to point at". Recorded here and in the glossary rather than edited into the locked requirement.

**L-11.**

- `SchemaCommand` gained a required `cwd`; `handleSchema` resolves a relative `--out` against it, mirroring `handleCompile`. `--out` is still echoed back as typed (the documented exception in [`docs/guide/cli.md`](../../guide/cli.md) §Exit codes).
- `extractWorkspaceGlobsFromPnpmYaml` `continue`s on blank lines and full-line comments instead of breaking; the top-level-key check remains the real terminator.
- `detectPackageManager` walks up from `cwd` to the nearest lockfile, stopping after the first directory containing a `.git` and never reaching `$HOME`. This changed one existing expectation: `init docs` inside a repo with a root `package-lock.json` now reports `Package manager: npm.` rather than `not detected` — the old assertion's "Deliberate" comment was rationalizing the bug.
- `readExistingRuleIds` was **removed, not wired**: its logic already lives in `extractExistingRuleIds`, which is on the production path. That is now exported, and the 11 tests were re-targeted onto it plus `readExistingConfigDocument`.
- `CiWorkflowOutcome` gained `kept` and `unsafe-config-path`, so the two paths that returned a bare `undefined` now render a line. Neither is a failure, so `writeFailed` still keys on `"failed"` alone.
- The bin wraps its guarded body in `try`/`catch`. This is an exit-code bug, not cosmetics: `runCli`'s own `try` starts after `readPackageVersion()`, so a rejection from there escaped the top-level `await` and Node exited **1** — the code reserved for findings, re-opening M-6 at the process boundary. It now reports through `formatOperationalError` and exits `2`, covered by a real spawn in `bin.e2e.test.ts`.

**Accepted consequences.**

- In the `npx` scenario the project schema is staged and committed before the config (P11.09's deliberate schema-first ordering), so a config write that fails after it leaves a `schema.json` behind. The partial-write summary names it, which is the contract.
- The two prunes are shared to different depths on purpose. `isPrunedDirName` is used by both the Markdown walk and workspace-package detection, so a hidden tree cannot be visible to one and not the other; the gitignore layers are threaded only through the Markdown walk. A gitignored workspace package is therefore still detected and still produces a scan scope — an empty one, with no Markdown to cluster, so it proposes nothing. Left as-is rather than widened: the asymmetry is invisible in the draft, and workspace detection reads `package.json` files, which `.gitignore` rarely speaks about deliberately.
- The draft the user confirms still does not name the project-local `schema.json` the `npx` path now writes; only the write summary does, after the fact. That is a gap against the same warn-before-confirming discipline L-8 established for comment loss, and is deferred rather than fixed here.
