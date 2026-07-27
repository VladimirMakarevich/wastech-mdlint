# P11.08 · `init` `exclude` prunes noise at every depth

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **M-4** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

The `exclude` list `init` writes must keep the noise directories (`node_modules`, `.git`, `dist`, …)
out of the lint corpus **anywhere** in the tree, not only at the repository root.

## Problem (from the audit)

`packages/core/src/discovery/config-writer.ts:96-98` turns `DEFAULT_NOISE_DIR_NAMES` into `${name}/**`
globs. `normalizeConfigGlob` (`packages/core/src/discovery/globs.ts:7-15`) does **not** rewrite these,
because they already contain `/`, so they anchor to the root. In a monorepo, after `init --yes`,
`packages/foo/dist/OUT.md` and `packages/foo/node_modules/somelib/README.md` are linted.

This directly contradicts the comment 5 lines above (`config-writer.ts:91-95`), which promises the
opposite **including this exact case**: "so a written config never re-scans the `node_modules`/`.git`/
`dist`/… trees … including when `include` falls back to the implicit `**/*.md`." `loadDocuments` has
no built-in noise list (`markdown/load-documents.ts:85-91` prunes only by `exclude`), so this written
`exclude` is the only protection.

## Deliverables / steps

1. Emit `**/${name}/**` (match at any depth) instead of `${name}/**` for the default noise globs in
   `config-writer.ts:96-98`, so the written `exclude` matches the comment's promise. Keep the
   deterministic sort.
2. Confirm the change composes with `normalizeConfigGlob` and with an explicit `include`, and does not
   over-exclude a legitimately-named user directory nested under a project (documented behavior).
3. Strengthen the test: `config-writer.test.ts:93-94` currently only asserts the literals are present.
   Add an assertion that a nested `packages/foo/node_modules/**` path is excluded by the written glob.

## Out of scope

`.gitignore`-aware scanning (that is L-7, in [P11.14](14-init-cli-lows.md)) and the fresh-vs-merge
`exclude` policy. This task only fixes the anchoring of the default noise globs.

## Exit criteria

- [x] The written `exclude` uses `**/<noise>/**` and prunes noise directories at any depth.
- [x] A monorepo `init` no longer lints `packages/*/dist/**` or `packages/*/node_modules/**`.
- [x] The `config-writer` test asserts nested-path exclusion, not just literal presence.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **Fix**: one line — `DEFAULT_EXCLUDE_GLOBS` (`config-writer.ts`) maps `DEFAULT_NOISE_DIR_NAMES` to
  `` `**/${name}/**` `` instead of `` `${name}/**` ``. `.sort(compareStrings)` is retained and the
  resulting order is byte-identical to before, since every entry gains the same constant prefix.
- **Zero-segment prefix**: a leading `**/` matches zero leading segments, so this widens the match
  rather than moving it. picomatch compiles a `bos`-anchored `**/` to `(?:^|/|<globstar>/)`, so
  `**/node_modules/**` matches root-level `node_modules/x.md` as well as
  `packages/foo/node_modules/x.md`. This was the one real risk (a naive read would trade a nested
  miss for a root-level regression), so it is pinned as a contract by an explicit root-level
  assertion in `config-writer.test.ts`, not left as an assumption.
- **Correct, not merely wider**: `init`'s own scanner already prunes these directories **by basename
  at every depth** (`collectMarkdownFiles` in `repo-scan.ts`).
  The root-anchored form was never a faithful mirror of what the scan skipped. It also follows that
  **no file the scan proposed can be excluded by the new globs** — the scan never walked into a
  `<noise>/` directory at any depth — so the written `exclude` cannot contradict the written
  `include` (deliverable 2).
- **Accepted tradeoff**: hand-written docs under a nested directory literally named
  `build`/`out`/`target`/`vendor`/… are now pruned too, with `exclude` winning over `include` (C1).
  Bounded by the fact that `init` could never have proposed such files itself, and the written config
  is a user-editable starting point; documented in the comment at the code.
- **The `merge` path is untouched**: only the fresh/overwrite branch writes `exclude`, and the merge
  tests still assert an existing `exclude: ["dist/**"]` round-trips verbatim — a merge must never
  rewrite a user's `exclude`.
- **Tests**: `config-writer.test.ts` replaces the literal-presence checks with semantic
  `matchesConfigGlob` assertions (both M-4 repros, the root-level guard, `.git/config.md` for
  `dot: true`, and two non-excluded doc paths); `load-documents.test.ts` gains a directory-prune case
  proving `shouldPruneDirectory`'s synthetic-child probe matches at depth and at the root;
  `init.e2e.test.ts` gains the end-to-end exit criterion — a monorepo `init --yes` followed by
  `lint --format json`, asserting the written `include` _equals_ `["**/*.md"]` (so the case cannot
  pass vacuously if a future scan-heuristic change narrows it) and that `files` excludes the nested
  `dist`/`node_modules` paths. That e2e failed against the pre-fix build with exactly the audit's
  reported corpus, confirming it reproduces M-4.
- No public export, dependency, or config-schema change, so `packages/cli/schema.json` and the
  generated README tables stay byte-identical (no sync-test churn).
