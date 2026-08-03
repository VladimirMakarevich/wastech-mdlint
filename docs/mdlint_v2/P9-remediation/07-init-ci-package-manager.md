# P9.07 · `init` CI workflow respects the detected package manager

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit finding **L-7** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make the CI workflow that `init` generates consistent with the package manager `init` already detects, or document that npm-universal is a deliberate choice.

## Problem (from the audit)

`init` detects bun/pnpm/yarn/npm, but `buildCiWorkflowYaml` (`packages/core/src/discovery/config-writer.ts:123-155`) always emits `npm install --no-save @wastech-mdlint/cli` + `npx wastech-mdlint lint`, and `init-command.ts` never passes the detected `packageManager` through. In a pnpm/bun workspace the generated CI job ignores the project's lockfile/workspace resolution. The detection result is silently discarded here.

## Deliverables / steps

1. Thread the detected `packageManager` from `init-command.ts` into `buildCiWorkflowYaml`.
2. Emit the install/run invocation for that manager (e.g. `pnpm dlx` / `bunx` / `yarn dlx` / `npx`), or select the corresponding `setup-node`/`setup-*` step.
3. **Or**, if npm-universal-via-`setup-node` is intentional, add a one-line comment in `config-writer.ts` and a note in the `init` docs stating the CI workflow is deliberately npm-based regardless of local PM — so the discarded detection is a documented choice, not a bug.
4. Update/extend the `init` config-writer test to cover whichever behavior is chosen.

## Exit criteria

- [x] Generated CI either uses the detected package manager or documents npm-universal by design.
- [x] A test pins the chosen behavior.
- [x] `npm test` green.

## Implementation notes

- **Chose npm-universal by design over threading the manager through.** The audit's own guess — "probably a deliberate simplification, but the detection result is silently discarded" — is the root cause the fix addresses: the simplification was reasonable, only undocumented. The install step only fetches the external `@wastech-mdlint/cli` tool into a scratch `node_modules`; it never touches the target repo's own dependency graph or lockfile, so a bun/pnpm/yarn repo's lockfile is simply irrelevant to what this step does. `actions/setup-node` already provides npm on every runner, so branching per manager would only add setup actions (`pnpm/action-setup`, `oven-sh/setup-bun`, …) for a step whose behavior would not actually change.
- **`detectPackageManager`/`scanRepository` are unchanged** — the detected manager is still surfaced in the `init` draft summary (`Package manager: pnpm.`, etc.); only `buildCiWorkflowYaml`'s doc comment and the surrounding docs were touched, per the task's scoping constraint.
- **Documented in five places** so the decision doesn't silently re-drift: a rationale comment on `buildCiWorkflowYaml` (`packages/core/src/discovery/config-writer.ts`), this task file, the glossary's `config-writer.ts` entry, the P6.04 task's CI-workflow deliverable/implementation notes, and the `init` section of `README.md`.
- **Test pins the CLI-integration behavior, not just the pure function.** `buildCiWorkflowYaml` already had no `packageManager` parameter to vary, so a unit test alone could not have caught the audit's actual concern (the detection reaching `init-command.ts` and then going nowhere). Extended `packages/cli/test/init.e2e.test.ts`'s package-manager-detection suite with one case per lockfile (bun/pnpm/yarn/npm) asserting the written `.github/workflows/wastech-mdlint.yml` is still the npm-based template even though the same run's draft summary reports the non-npm manager.
