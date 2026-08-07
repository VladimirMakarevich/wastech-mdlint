# P14.02 · CLI exit codes and out-of-repo path rendering

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Backlog: [W-13](../remediation-backlog-2026-08-05.md) (High), [W-17](../remediation-backlog-2026-08-05.md) (Low). Sources: field F-08 (major), F-23 (polish). Depends on [P13](../P13-correctness/index.md).

## Goal

Close the two places where the CLI's own contracts do not hold at their edges: a refusal that reports success, and a path normalization that is correct inside the repository and actively worse outside it.

## Problem

**W-13 — `init --on-existing merge` refuses to write and still exits `0`.** With an unloadable existing config, `init` prints a correct, well-worded refusal — `Not written: the existing config at wastech-mdlint.config.json could not be read, parsed, or validated, so a merge cannot guarantee a valid config with its existing entries preserved. Fix or remove it, then re-run init.` — and exits **`0`**. `lint` given the identical file exits `2`.

The refusal text is right; only the code is wrong. It matters most exactly where `--yes` is documented to belong: **in CI**, where a merge step that silently no-ops reports success. And it is a process-boundary defect by construction — only a real process has an exit code, so no in-process test can see it.

The exit taxonomy this violates is already stated: `1` is reserved exclusively for findings, and every other failure — unknown subcommand, bad flag, nonexistent target, unreadable config, unwritable file — is `2`. A deliberate no-write outcome staying `0` is correct (`--on-existing skip` is one); a refusal caused by an invalid file is not a deliberate no-write.

**W-17 — an out-of-repo `--outdir` renders as `../../../../..`.** Observed: `SKILL.md written to ../../../../../private/tmp/claude-501/.../skill-out/SKILL.md`. The repo-relative POSIX normalization that `AGENTS.md` mandates for public output is right inside the repository and unreadable outside it. The exit-code contract in [`glossary.md`](../glossary.md) already carves out the neighbouring case — "a path outside that directory has only a `../` form — none at all across Windows drives" — so the principle is recorded; what is missing is falling back to the absolute path once the relative form needs a leading `..`.

## Deliverables / steps

1. **W-13:** map `init`'s merge-refusal path to the operational-error exit `2` in [`packages/cli/src/init-command.ts`](../../../packages/cli/src/init-command.ts). Change the code, not the message.
2. **W-13 — check the sibling refusals while there.** `init` has several no-write outcomes and they are not all the same kind: `--on-existing skip` is a deliberate no-write and must stay `0`; an unreadable/unloadable existing config is an operational failure and must be `2`. Enumerate them and make the split explicit in code, so the next reader does not have to infer which is which.
3. **W-13 test:** spawn the built binary, feed it an invalid existing config, assert exit `2` **and** that the refusal text is unchanged. Tag it `@boundary-guard installed-bin-spawn`, and remember the build-before-test rule — the spawn suites assert against `dist/`.
4. **W-17:** in [`packages/cli/src/commands.ts`](../../../packages/cli/src/commands.ts), fall back to the absolute path once the repo-relative form would need a leading `..`. Apply it to the write-summary path rendering, not to the report paths inside a `LintResult` — those are a public data contract and stay repo-relative.
5. **W-17 docs:** the exit-code / path-rendering contract in the glossary and `docs/guide/output.md` states the `../` carve-out; update it to state the absolute-path fallback instead, so the words and the behavior agree again.

## Out of scope

Any other exit code. The field test verified the contract in **all ten** other cases it exercised — including the subtle warnings-only-with-default-`--fail-on` case, a typo'd subcommand, a nonexistent path, a bad `--fail-on` value, and a file passed where a directory is documented — and every one was correct. This task fixes the one that is not; it does not re-open the taxonomy.

## Exit criteria

- [x] `init --yes --on-existing merge` against an unloadable existing config exits `2`, asserted on a spawned process, with the refusal message unchanged.
- [x] `--on-existing skip` still exits `0`; the deliberate-no-write versus operational-failure split is explicit in code. — `InitOutcome`'s six values, switched exhaustively in `initExitCode`.
- [x] The new guard carries `@boundary-guard installed-bin-spawn` and [`packages/core/test/boundary-guards.test.ts`](../../../packages/core/test/boundary-guards.test.ts) still passes. — the guard lands in `bin.e2e.test.ts`, already inventoried under that category, so the inventory needed no edit.
- [x] `compile --outdir <path outside the repo>` prints a path a user can read.
- [x] Report paths inside `--format json` are unchanged (still repo-relative POSIX). — the fallback is reachable only from `handleCompile`; nothing in `formatLintResultJson` or `LintResult` was touched.
- [x] The path-rendering contract in the glossary and `docs/guide/output.md` describes the new fallback.
- [x] Gates green — and `npm run build` before `npm test`, or the spawn guard asserts against a stale `dist/`.

## Implementation notes

- **An enumerated outcome, not a second boolean.** `RunInitCommandResult` now carries `outcome: InitOutcome` — `written`, `skipped`, `declined`, `invalid-existing-config`, `write-failed`, `ci-workflow-write-failed` — and `commands.ts`'s `initExitCode` switches over it with the file's existing `const exhaustiveCheck: never` idiom, so a seventh outcome fails to compile until someone decides its code. Six values for a two-valued decision is the cost; the benefit is that deliverable 2's split is _stated_ where the old `writeFailed` boolean made it inferable and got it wrong. The dividing question is not "was anything written" — four of the six write nothing — but whether the user asked for no write. `wasConfirmed` went with the boolean: nothing outside `init-command.ts` read it, and `outcome` derives it.
- **The refusal text is byte-identical.** `formatNotWrittenSummary` is untouched; only its caller's classification changed. The spawn guard asserts the full sentence as a **literal** rather than importing the formatter, since importing it would only prove the code agrees with itself — which is not what "unchanged byte for byte" means.
- **The guard is a pair, not a single case.** Same unloadable fixture, `merge` → `2` and `skip` → `0`. One case alone pins an exit code; the pair pins the distinction, which is the actual deliverable. It nests inside `bin.e2e.test.ts`'s existing installed-bin `describe` so `linkedEntry` is in scope, and carries its own `@boundary-guard installed-bin-spawn` comment at the guard — the file-level tag at the top does not satisfy a criterion that asks for it _at_ the guard. `init.e2e.test.ts` was the alternative and was declined: it is inventoried only under `write-failure`, so using it would have meant editing the inventory to say something the tree already had.
- **The five in-process expectations were flipped first.** `init.e2e.test.ts` pinned `EXIT_CODE_SUCCESS` for all five merge-abort shapes (unparseable, non-array `rules`, unidentifiable entry, unidentifiable `custom` entry, loader-rejected); all five failed with `expected 2, received 0` before `init-command.ts` was touched. One in-process case was added for `skip` over an _unloadable_ config — the existing skip test used a valid one, so nothing held the two halves of the split against the same input.
- **`toWriteTargetPath` is scoped to the write target, and the asymmetry is recorded rather than left latent.** New helper beside `toRepoRelativePosix` in `operational-errors.ts`, delegating to it for the in-`cwd` case and returning the platform-native absolute path otherwise. Not widened to `formatOperationalError` or `resolveDirectoryArgument`: that would reverse [P11.10](../P11-remediation/10-cli-exit-contract.md)'s promise that a `[path]` passed absolutely is reported relatively, and loosen the "an error never prints an absolute host path" property `operational-errors.test.ts` pins. The residual is a row in [accepted-behaviors](../accepted-behaviors.md). The fallback stays un-POSIX-slashed deliberately: it is a location to paste into a shell, not a report path.
- **The `..` test is on the first path segment, not a string prefix,** so `..\out` and `../out` both trigger the fallback while a sibling directory named `..foo` does not — pinned by its own case. The Windows-drive branch (`path.relative` answering an absolute path) is unreachable on POSIX, so it is covered by `it.runIf(process.platform === "win32")` and genuinely exercised on CI's windows runner rather than faked on a dev machine.
- **`init`'s own path rendering was left alone,** both places. `toRepoRelative` anchors at a repository root found by walking _up_, so it can never produce a `..`; `relativeConfigPath` is target-directory-relative by design (H-3) and `init.e2e.test.ts` asserts a `../../` form for it. Applying the fallback to either would have been a change nothing asked for, and to the second a regression.
- **Docs.** The glossary's `init` and exit-code entries, `docs/guide/cli.md` (the exit-code paragraph, the merge-abort bullet, and the deliberate-no-write list, which now names two outcomes instead of three), `docs/guide/output.md`, `docs/guide/compile.md`, `README.md`, and `skills/wastech-mdlint-init/SKILL.md` — the last because it instructs an agent to read that refusal, which the runner now also sees as a non-zero exit.
