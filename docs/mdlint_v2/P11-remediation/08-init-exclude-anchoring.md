# P11.08 · `init` `exclude` prunes noise at every depth

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **M-4** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

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

- [ ] The written `exclude` uses `**/<noise>/**` and prunes noise directories at any depth.
- [ ] A monorepo `init` no longer lints `packages/*/dist/**` or `packages/*/node_modules/**`.
- [ ] The `config-writer` test asserts nested-path exclusion, not just literal presence.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
