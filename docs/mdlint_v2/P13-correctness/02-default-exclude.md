# P13.02 · A lint-time default `exclude`

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-02](../remediation-backlog-2026-08-05.md) (Blocker). Sources: field F-06 (blocker; the symptom was independently reproduced by audit F25 and mis-graded LOW there). Depends on [P13.01](01-glob-semantics.md).

## Goal

Make the zero-config first run — `npx wastech-mdlint lint .`, the path a new user takes before reading anything — prune the directories no Markdown analyzer should read. Today it prunes nothing.

## Problem

[`packages/core/src/markdown/load-documents.ts`](../../../packages/core/src/markdown/load-documents.ts) around `:147` reads `exclude: options.exclude ?? []`. There is no lint-time default. The only `node_modules` literals in `core/src` live in `discovery/repo-scan-constants.ts` (the `init` scan's noise list) and `discovery/config-writer.ts` (what `init` writes) — **both `init`-only** — so a user who never runs `init` gets no pruning whatsoever. The schema declares no `default` for `exclude` or `respectGitignore` either, so an editor cannot show one.

**Measured on a real monorepo (202 tracked `.md`, 323 excluding `node_modules`):** 3063 files instead of 323, of which 2740 sat under a **nested** `mobile/node_modules/`; 19.30 MB parsed instead of ~1.9 MB; 31 s wall instead of 2 s. Exit `0`, zero findings — because the zero-config ruleset is empty, so the blow-up is silent in every direction. The same run after `init` took 2 s over 139 files, which is the cost of this defect measured directly.

**Why the audit reproduced it and did not file it.** Audit F25's own verification pulled `node_modules/pkg/README.md` into the corpus and filed that as a LOW documentation gap about pattern anchoring. It never asked why `node_modules` was a candidate at all — because its method asks whether code contradicts a documented claim, and no document promises a default `exclude`. The field test's plan _expected_ the pruning, and that expectation is what turned a passing observation into a blocker.

## Deliverables / steps

1. **Ship a lint-time default `exclude`.** At minimum the any-depth set `init` already writes for the same reason: `**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/.git/**`. Prefer reusing the constant behind `discovery/config-writer.ts` rather than introducing a second list — two lists that must agree is the shape of the next drift.
2. **Anchoring matters here.** Write the defaults in the depth-agnostic form, per [P13.01](01-glob-semantics.md)'s rule; a root-anchored `node_modules/**` default would reproduce the field test's F-07 under-exclusion inside the product itself.
3. **Declare the default in the generated schema** so an editor surfaces it, and regenerate `packages/cli/schema.json` plus any README table in the same change (the byte-sync tests will otherwise fail).
4. **Decide `respectGitignore` separately, and land it after [P13.03](03-gitignore-precedence.md).** Its default is `false` today. Whether it should become `true` is a distinct question — a repository's `.gitignore` is not the same statement as "do not lint this" — so either change it deliberately with a note, or leave it and say so. **Sequencing is load-bearing here:** until P13.03 fixes the root-first-wins layer precedence (W-11), a nested `!keep.md` cannot re-include a file a root pattern ignored, so a `true` default would put that silent under-reporting on the zero-config path — the same failure class this task exists to close, arriving through the fix. Ship the `exclude` default whenever; flip `respectGitignore` only once P13.03 has landed, and if the two are done in one pass, say so in the change. Whichever way it is decided, declare the resolved default in the generated schema alongside `exclude` (step 3) so neither key is invisible to an editor.
5. **Add the boundary guard.** A three-file fixture with **no config**: `docs/a.md`, `mobile/node_modules/leftpad/README.md`, `node_modules/rightpad/README.md`. It must lint exactly one file. Tag it `@boundary-guard shared-exclude` so [`packages/core/test/boundary-guards.test.ts`](../../../packages/core/test/boundary-guards.test.ts) holds the pairing — the nested copy is the half an in-repo fixture has never had.
6. **Fix the two stale plan numbers this created.** [`field-test-2026-08-05-debates.md`](../field-test-2026-08-05-debates.md) Phase 3 expects 323 files and asserts that `node_modules` is excluded by default. After this task that expectation becomes correct; update the plan so the number reads as a passing check rather than a known-wrong one.
7. **Update the guide.** `docs/guide/configuration.md` should state what is excluded before the user writes anything, and that a user-supplied `exclude` replaces rather than extends it (or extends it — decide, and say which).

## Out of scope

Performance work on the parse path. The 31 s was 3063 files, not a slow parser; pruning is the fix. Also out of scope: making `init`'s written `exclude` and the lint-time default diverge — if they must differ, that belongs in [P14.03](../P14-host-boundary/03-init-disclosure.md), which owns the `init`-vs-lint distinction.

## Exit criteria

- [ ] The three-file no-config fixture lints exactly one file, and the guard carries `@boundary-guard shared-exclude`.
- [ ] `packages/cli/schema.json` records the default for `exclude` **and** for `respectGitignore`, regenerated rather than hand-edited, with its byte-sync test green.
- [ ] Whether a user `exclude` replaces or extends the default is decided, implemented, and documented — the decision is stated in `docs/guide/configuration.md`, which also lists what is excluded before the user writes anything.
- [ ] The `respectGitignore` default is decided either way, with the reason stated; if it becomes `true`, [P13.03](03-gitignore-precedence.md) landed first.
- [ ] The field-test plan's Phase 3 expectation of 323 files is restored as correct.
- [ ] Gates green.
