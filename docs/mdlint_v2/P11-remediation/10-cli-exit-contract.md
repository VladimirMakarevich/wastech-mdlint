# P11.10 · CLI exit-code contract + command routing

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Findings **M-6** (wrong exit code / absolute paths) and **M-7** (swallowed
> subcommand), [post-P9 audit](../audit-2026-07-25-post-p9.md). Both break CI the same way.

## Goal

CI must be able to tell "the linter found problems" (`1`) from "the command failed to run" (`2`), and
a typo in a CI step must fail loudly rather than pass green.

## Problem (from the audit)

**M-6 — operational failures exit `1`, not `2`, and print absolute paths.**
`packages/cli/src/program.ts:370-372` maps everything that is not a `CliUsageError`/`ConfigError` to
`EXIT_CODE_RUNTIME_ERROR` — but that constant is wired such that
`wastech-mdlint init ./does-not-exist --yes` exits `1` with stderr
`Unexpected error: ENOENT … open '/private/tmp/…/wastech-mdlint.config.json'`. The docs reserve **1**
for "findings at or above `--fail-on`" and **2** for "operational/usage error"
([`docs/guide/cli.md`](../../guide/cli.md) §Exit codes; [`docs/guide/output.md:30-36`](../../guide/output.md)).
The absolute path also breaks the repo-relative POSIX invariant the code cites elsewhere
(`init-command.ts:50-52`, `:539-541`, `commands.ts:421-425`).

**M-7 — unknown subcommand and missing path exit `0 "No problems found."`** `program.ts:111,138`
registers `lint` with `{ isDefault: true }` and `.argument("[path]")`, so any unparsed token becomes a
`lint` path. `wastech-mdlint bogus-command` → `exit 0`; `wastech-mdlint lint ./nope-missing` →
`exit 0`. `cli.test.ts:96-102` covers only an unknown **option**, and its own comment ("a bare
positional becomes the lint `[path]`") documents the hole without testing it.

## Deliverables / steps

1. Map genuine operational/usage failures (config not found, `ENOENT` on a target path, write errors)
   to exit **2**, keeping **1** exclusively for findings at/above `--fail-on`. Audit the
   `program.ts:370-372` catch and the `init`/write error paths.
2. Normalize any path in an operational error message to a repo-relative POSIX path, per the cited
   invariant.
3. Make an **unknown subcommand** an error (non-zero, usage message), rather than a `lint` path.
   Decide and document how a missing/empty `lint [path]` is handled — a nonexistent explicit path
   should not silently succeed.
4. Tests: `bogus-command` exits non-zero with a usage message; `lint ./missing` does not exit
   `0 "No problems found."`; an operational failure exits `2` with a repo-relative path.

## Out of scope

Reworking the default-command design (D4 keeps `lint` default, `scan` a hidden alias). This task
tightens routing and exit mapping, not the command taxonomy.

## Exit criteria

- [ ] Operational/usage failures exit `2`; lint findings exit `1`; clean runs exit `0`.
- [ ] Operational error messages print repo-relative POSIX paths, not absolute ones.
- [ ] An unknown subcommand exits non-zero with a usage message.
- [ ] A nonexistent explicit `lint [path]` does not report `0 "No problems found."`.
- [ ] Regression tests cover the subcommand, missing-path, and exit-code cases.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
