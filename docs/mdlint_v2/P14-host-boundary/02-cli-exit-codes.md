# P14.02 · CLI exit codes and out-of-repo path rendering

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-13](../remediation-backlog-2026-08-05.md) (High), [W-17](../remediation-backlog-2026-08-05.md) (Low). Sources: field F-08 (major), F-23 (polish). Depends on [P13](../P13-correctness/index.md).

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

- [ ] `init --yes --on-existing merge` against an unloadable existing config exits `2`, asserted on a spawned process, with the refusal message unchanged.
- [ ] `--on-existing skip` still exits `0`; the deliberate-no-write versus operational-failure split is explicit in code.
- [ ] The new guard carries `@boundary-guard installed-bin-spawn` and [`packages/core/test/boundary-guards.test.ts`](../../../packages/core/test/boundary-guards.test.ts) still passes.
- [ ] `compile --outdir <path outside the repo>` prints a path a user can read.
- [ ] Report paths inside `--format json` are unchanged (still repo-relative POSIX).
- [ ] The path-rendering contract in the glossary and `docs/guide/output.md` describes the new fallback.
- [ ] Gates green — and `npm run build` before `npm test`, or the spawn guard asserts against a stale `dist/`.
