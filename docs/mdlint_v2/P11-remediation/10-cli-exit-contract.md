# P11.10 · CLI exit-code contract + command routing

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Done**. Findings **M-6** (wrong exit code / absolute paths) and **M-7** (swallowed
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

- [x] Operational/usage failures exit `2`; lint findings exit `1`; clean runs exit `0`.
- [x] Operational error messages print repo-relative POSIX paths, not absolute ones.
- [x] An unknown subcommand exits non-zero with a usage message.
- [x] A nonexistent explicit `lint [path]` does not report `0 "No problems found."`.
- [x] Regression tests cover the subcommand, missing-path, and exit-code cases.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **The root cause of M-6 was a name, so the fix is a rename.** `EXIT_CODE_RUNTIME_ERROR = 1` did
  double duty: `resolveLintExitCode` returned it for _findings_, and `program.ts`'s catch-all returned
  it for _any unexpected throw_ — so an operational failure was indistinguishable from "lint found
  problems". It is now `EXIT_CODE_FINDINGS`, with the whole taxonomy commented in one place, which
  makes the mistake unrepresentable at the call site. `EXIT_CODE_USAGE_ERROR = 2` kept its name (it
  pairs with `CliUsageError`, and the docs already say "operational/**usage** error"); renaming it too
  would have churned ~45 assertion lines for no safety gain. P11.09 predicted exactly this
  ([`09-atomic-writes.md`](09-atomic-writes.md) "only the constant's _name_ is off").
- **The catch-all is now a backstop that exits `2`, not `1`.** It renders through the new
  `formatOperationalError`, which rewrites exactly one message shape: an errno that names its own
  `path`, since that is the message embedding an absolute platform-native path (and, under
  `writeFileAtomic`, the random temp name). So `EACCES` on a config prints
  `Operational error: EACCES on docs/wastech-mdlint.config.json`. Everything else keeps
  `error.message`, which for a backstop is the only diagnostic content there is: substituting a bare
  `code` would reduce a Node programmer error to `Operational error: ERR_INVALID_ARG_TYPE`, and a
  path-less errno message (`ENOSPC: no space left on device, write`) has no path to leak — Node omits
  `path` precisely when the syscall had none to report.
- **M-7 is fixed by dropping `isDefault` and routing the default in argv.** Commander's
  `_parseCommand` dispatches to a default command _before_ it can reach `unknownCommand()`, so no
  operand was ever rejected. `routeDefaultCommand(argv)` prepends `"lint"` only when `argv[0]` is
  absent or is an option that is not program-level (`-h`/`--help`/`-v`/`--version` must stay at the
  program level or `--help` would render _lint's_ help). Commander's own
  `error: unknown command 'x' (Did you mean lint?)` then fires and the existing `CommanderError`
  branch already maps it to `2` — zero new error-message code. The rejected alternative, keeping
  `isDefault` and `stat`ing the operand to decide "path vs. typo", would make routing
  filesystem-dependent.
- **Accepted, documented trade-off: `wastech-mdlint ./docs` is now `error: unknown command './docs'`.**
  Unavoidable — an operand cannot be both "a path" and "a misspelled command name". Compatible with
  what was ever promised (`docs/guide/cli.md`, the glossary: running with **no subcommand** lints the
  cwd), and every invocation in `docs/`, `README.md`, and `skills/` names a subcommand. Now stated
  explicitly in `docs/guide/cli.md` so it is not a silent behavior change.
- **`showHelpAfterError` is a string, and its position in the builder chain is load-bearing.** Placed
  before the `.command()` calls, since commander copies help/output/exit settings onto a subcommand
  only at creation time (`copyInheritedSettings`) — the same trap the existing `exitOverride()` comment
  documents. A string rather than `true`: the full help body after every usage error would bury
  commander's one-line diagnostic.
- **`resolveDirectoryArgument` validates `[path]`/`--cwd` at the CLI boundary**, where argument
  validation belongs (`.agents/rules/architecture.md`), not in core. It resolves against _this run's_
  `cwd` **first**: `loadConfiguration`/`lintFiles` resolve a relative argument against the real
  `process.cwd()`, so a check that stat'ed the raw string would disagree with what core then reads —
  and the generated CI workflow really does emit a relative `lint 'docs'`. Wired into `lint`/`scan`,
  `graph`, `init` (replacing its bare `path.resolve`, preserving `pathWasExplicit`), and
  `compile --cwd`; `slice`/`impact` take no target. Exactly two errnos mean "no usable directory
  here" — `ENOENT` and `ENOTDIR` (a parent segment is a file); anything else (`EACCES`, `ELOOP`) is a
  _different_ operational failure and falls through to the backstop rather than being misreported as
  a bad argument.
- **New `packages/cli/src/operational-errors.ts`** — three pure formatters (`toRepoRelativePosix`,
  `formatOperationalError`, `formatWriteFailure`) with **no** import from `commands.js`, since
  `commands.ts` imports _from_ here for its write handlers. `formatWriteFailure` names the path the
  caller already computed for its success line rather than the errno's own path: under
  `writeFileAtomic` the latter is the staged temp file, which is meaningless to the user. Same
  rationale `formatWriteFailureSummary` documents for `init` (P11.09); this is the host-output
  counterpart, not a duplicate.
- **The two remaining unguarded product writes are converted** — `handleSchema` and `handleCompile`
  wrap `mkdir` + `writeFileAtomic` and rethrow as `CliUsageError`. `compile`'s `relativeOutputPath`
  moved _above_ the write so a failure names the same repo-relative path the success line reports.
  `schema` echoes `command.out` as typed, matching its existing directory-path guard.
- **"Relative, not absolute" is documented with its anchor and its two exceptions, not over-claimed.**
  The second exit criterion is met in the sense that matters — no message interpolates a host path
  _the tool computed_ — but "every path is repository-relative POSIX" would have been false as
  written, so `docs/guide/cli.md` §Exit codes, `docs/guide/output.md`, and the glossary
  **Exit codes** entry state the real contract instead. The anchor is the directory the command works
  in, not a repo root core never computes: with a root config, `lint docs` reports
  `../wastech-mdlint.config.json`. Two exceptions: (1) `schema --out` — and only it — is echoed back
  as typed, because rewriting a user's own argument inside the error that quotes it back to them is
  worse than printing it (a bad `[path]`/`--cwd` is still relativized, even when passed absolutely,
  since `resolveDirectoryArgument` names the resolved target rather than the raw string); (2) a
  target outside the working directory has only a `../` form, and across Windows drives none at all,
  so `path.relative` hands back the absolute target and `toRepoRelativePosix` passes it through (a
  guard could not invent a relative form, only hide which path failed).
- **The absolute-path leak was in core, not only in the CLI.** All three `ConfigError` messages in
  `packages/core/src/config/load-config.ts` interpolated an absolute `configPath`, and both hosts print
  `error.message` verbatim (`program.ts`; MCP's `tool-response.ts`). A new `displayConfigPath` helper
  renders `normalizeRelativePath(path.relative(params.cwd, configPath))`, so the fix lands for MCP too.
  `params.cwd` is the only anchor core has — and hosts pass the directory being analyzed, not the repo
  root (`command.path` for `lint`/`graph`/`slice`/`impact`), so a config found above it renders with
  `../` segments: still relative, still naming the file actually read.
- **Deliberately not fixed here:** `schema --out` resolving against `process.cwd()` (L-11) and the
  absence of a top-level rejection handler — both belong to P11.14. `lint`/`graph`'s `--config` also
  still resolves against `process.cwd()` inside core (MCP and `compile` each work around it locally);
  it is the same class as L-11 and no exit criterion needs it.
- **Tests.** New `packages/cli/test/operational-errors.test.ts` (errno with a path; errno without one
  and a non-errno `ERR_*` code, both of which must keep their message; plain `Error`; non-`Error`
  throw; `cwd`-as-target → `"."` — the separator assertion uses host-native
  `path.join`/`path.relative`, so it is what pins POSIX normalization on Windows). Extended:
  `cli.test.ts` (the argv shapes the routing change moves at once — leading lint option, unknown
  subcommand, bare path, `help lint`, plus the help pointer on a subcommand's unknown option; failed
  `SKILL.md` write via a _directory_ where the file belongs, which is the one portable write fault;
  nonexistent `--cwd`; nonexistent `graph [path]`), `lint.e2e.test.ts` (nonexistent `[path]`, `[path]`
  as a file, relative `[path]` against an injected cwd narrowing the corpus, missing `--config`,
  POSIX/non-root-gated `schema` write failure), `init.e2e.test.ts` (`init ./does-not-exist --yes` no
  longer blames a write), and `bin.e2e.test.ts` (a typo'd subcommand across a real process boundary —
  the CI scenario the defect shipped in). `resolveDirectoryArgument` is pinned at every call site it
  is wired into rather than once, since the wiring is per site and dropping one would not fail
  another's test. Every asserted path is checked with `not.toContain(cwd)` rather than an absolute
  prefix, so the assertion is portable; `schema`'s case asserts the echoed-as-typed contract
  explicitly, plus that the raw fs message and temp name are gone.
- **Docs updated in the same change**, per `AGENTS.md` hygiene: `docs/guide/cli.md` (exit-code table;
  the path-rendering contract and its two limits; `[path]` must be an existing directory; the
  bare-path trade-off), `docs/guide/output.md` (exit-code table, the same contract, plus `init`'s
  partial-write summary as the one operational failure reported on stdout rather than stderr),
  `docs/mdlint_v2/glossary.md` (`lint`'s "default" qualified, a new **Target path validation** entry,
  **Exit codes** extended), and — because the contract only pays off in CI — `README.md`'s CLI notes
  and [`docs/guide/use-cases/adopt-and-ci.md`](../../guide/use-cases/adopt-and-ci.md). No
  `npm run generate:docs` — the byte-synced artifacts are `README.md`'s rule table and
  `packages/cli/schema.json`, and neither changes here.
