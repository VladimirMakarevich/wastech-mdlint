# P9.07 · `init` CI workflow respects the detected package manager

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **L-7** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make the CI workflow that `init` generates consistent with the package manager `init` already
detects, or document that npm-universal is a deliberate choice.

## Problem (from the audit)

`init` detects bun/pnpm/yarn/npm, but `buildCiWorkflowYaml`
(`packages/core/src/discovery/config-writer.ts:123-155`) always emits
`npm install --no-save @wastech-mdlint/cli` + `npx wastech-mdlint lint`, and
`init-command.ts` never passes the detected `packageManager` through. In a pnpm/bun workspace the
generated CI job ignores the project's lockfile/workspace resolution. The detection result is
silently discarded here.

## Deliverables / steps

1. Thread the detected `packageManager` from `init-command.ts` into `buildCiWorkflowYaml`.
2. Emit the install/run invocation for that manager (e.g. `pnpm dlx` / `bunx` / `yarn dlx` /
   `npx`), or select the corresponding `setup-node`/`setup-*` step.
3. **Or**, if npm-universal-via-`setup-node` is intentional, add a one-line comment in
   `config-writer.ts` and a note in the `init` docs stating the CI workflow is deliberately
   npm-based regardless of local PM — so the discarded detection is a documented choice, not a bug.
4. Update/extend the `init` config-writer test to cover whichever behavior is chosen.

## Exit criteria

- [ ] Generated CI either uses the detected package manager or documents npm-universal by design.
- [ ] A test pins the chosen behavior.
- [ ] `npm test` green.
