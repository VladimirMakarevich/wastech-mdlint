# P11.03 · Guard an existing `schema.json` in `init`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **H-4** (data loss,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

`init` must never silently overwrite a user's existing `schema.json`. Today it truncates and replaces
it with the generated schema, with no check and no warning.

## Problem (from the audit)

`packages/cli/src/init-command.ts:783-789` writes the project schema with a bare
`writeFile(schemaPath, …)` and **no `fileExists()` guard**. The asymmetry is the bug: the CI-workflow
write 280 lines above **does** guard (`init-command.ts:505-507`) and is covered by a test
(`init.e2e.test.ts:1017` — "never overwrites an existing CI workflow file"). Reproduced: a user's
44-byte `schema.json` was replaced by the 70,055-byte generated one after
`init . --yes --on-existing merge`.

`schema.json` is a very common filename, and `wastech-mdlint schema` itself defaults to
`--out schema.json`, so a collision is likely. This violates the invariant the module itself cites
(`init-command.ts:39` — "I1's 'no implicit file-clobbering' spirit") and requirement **I1** in
[`docs/mdlint_v2/requirements/06-installation.md`](../requirements/06-installation.md). No tests
cover it.

## Deliverables / steps

1. Add the same existence guard the CI-workflow write uses (`init-command.ts:505-507`) before
   writing the schema at `:783-789`. Respect the `--on-existing` policy consistently with how the
   config write treats an existing config.
2. Surface the outcome in the write summary — an explicit "kept existing `schema.json`" (or
   "overwrote, per `--on-existing overwrite`") line, not a silent skip. Use the repo-relative path
   (see [P11.10](10-cli-exit-contract.md) for the path-normalization invariant).
3. Regression tests mirroring the CI-workflow test: an existing `schema.json` is preserved by
   default and the summary reports it; an explicit overwrite policy still replaces it.

## Exit criteria

- [ ] `init` with an existing `schema.json` does not overwrite it by default and says so in the summary.
- [ ] The `--on-existing` policy governs the schema write the same way it governs the config write.
- [ ] A test asserts the existing `schema.json` is byte-unchanged on the default path.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
