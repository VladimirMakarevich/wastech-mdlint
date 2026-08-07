# P16.04 · Dev tooling: argv interpolation and a regex replacement string

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Backlog: [W-54](../remediation-backlog-2026-08-05.md) (Medium), [W-55](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F28 (LOW there — Medium here because it is the one item that breaches a security rule outright), F40 (LOW, latent). Depends on [P15](../P15-output-contracts/index.md).

## Goal

Close the two places where developer tooling builds a command or a document by string interpolation, against a repository rule that forbids exactly that.

## Problem

**W-54 — the WSL npm wrapper interpolates argv into a `cmd.exe` line.** [`scripts/run-npm-windows.sh`](../../../scripts/run-npm-windows.sh) `:17` flattens the argument vector into one string (`npm_args="$*"`) and `:19` interpolates both it and the repository path, unquoted, into a `cmd.exe` command line — so a checkout path containing a space or an ampersand breaks or injects. The same line passes `--engine-strict=false`, suppressing the Node constraint all three packages declare, **on the one platform combination these scripts exist to cover**.

The rule it breaches is explicit: [`.agents/rules/security.md`](../../../.agents/rules/security.md) requires explicit argument vectors rather than shell interpolation. Scope is honestly dev-only — no package's `files` ships it, and the audit checked the two process spawns in product code and found both compliant (explicit argv, no shell). That is why it is Medium rather than High, and also why there is no excuse for leaving it: the fix has no product risk.

**W-55 — the docs generator uses generated content as a regex replacement string.** [`scripts/generate-docs.mjs`](../../../scripts/generate-docs.mjs) `:38` and `:42` interpolate generated content into the **replacement** string of `String.prototype.replace`, where `$` is a metacharacter — so a `$&`, `` $` ``, `$'`, or `$n` in any rule or MCP tool description would expand instead of being written. The `$1`/`$2` in those same templates are deliberate, which is exactly why the payload cannot be trusted to be inert.

**Latent, not live:** both generated strings were regenerated and contain zero `$`-sequences. The damage, if it fired, would be a corrupted `README.md` with the END marker in the middle, then a docs-sync failure on bytes nobody wrote — a confusing failure far from its cause.

This is the **replacement-string half** of a class `P11.06` already closed inside the rules, and [`packages/core/src/discovery/repo-scan.ts`](../../../packages/core/src/discovery/repo-scan.ts) `:82` already does the right thing for the same reason.

## Deliverables / steps

1. **W-54:** rewrite the wrapper to use an explicit argument vector. If `cmd.exe` must remain in the chain, quote both the path and each argument rather than flattening; the four wrapper scripts that feed it should pass through unchanged from the caller's perspective.
2. **W-54:** drop `--engine-strict=false` and resolve the engines question with [P16.03](03-published-payload.md) — the two are the same decision seen from two sides, and fixing one alone reinstates the contradiction. [P16.03](03-published-payload.md) already decided it: root `.npmrc` sets `engine-strict=true`, so this deliverable is mechanical — drop the flag and let the file govern instead of re-deciding.
3. **W-54:** verify with a checkout path containing a space, which is the reproduction that costs nothing and is the likeliest real-world trigger.
4. **W-55:** pass a **replacer function** at both call sites, matching what `repo-scan.ts:82` already does for the same reason. A function's return value is used literally, so the class closes rather than being escaped case by case.
5. **W-55:** regenerate after the change and confirm the README's generated blocks are byte-identical to before — the point is that inert input stays inert, so a diff here would mean the fix changed behavior it should not have.
6. **W-55 — consider a guard.** A test that feeds a description containing `$&` through the generator and asserts the literal survives is cheap and pins the class. Without it the next generator call site reintroduces it.

## Out of scope

Any change to product `spawn` calls — both were checked and are compliant. Reworking the WSL wrapper's purpose or the four scripts that feed it.

## Exit criteria

- [x] The WSL wrapper uses an explicit argument vector, or quotes the path and every argument.
- [x] A checkout path containing a space works.
- [x] `--engine-strict=false` is gone, and the engines decision from [P16.03](03-published-payload.md) is what governs instead.
- [x] Both `generate-docs.mjs` call sites pass a replacer function.
- [x] Regenerated README blocks are byte-identical to before the change.
- [x] A guard pins that a `$`-sequence in a description survives literally.
- [x] Gates green.

## Implementation notes

**W-54 — the command line is no longer built, rather than built more carefully.** The wrapper `cd`s into the repository on the bash side and `exec cmd.exe /d /s /c npm "$@"`, letting WSL interop translate the working directory for the Windows child. The permitted alternative — keep `cd /d "…" && npm …` as one string and quote the pieces — was not taken: a correct cmd quoting routine written in bash is the part that goes subtly wrong (caret escaping, and `%VAR%` has no command-line escape at all), so quoting would have preserved the construction and moved the risk into a hand-rolled algorithm. Removing the construction is what [`.agents/rules/security.md`](../../../.agents/rules/security.md) (Command Execution) actually asks for. `/d /s /c` is kept verbatim; `/s` is inert once the string after `/c` no longer starts with a quote, which the wrapper says in place. The four callers and `verify-wsl.sh` are unchanged.

**The UNC refusal is a pre-existing limitation made legible, not a new one.** Interop translates a WSL-filesystem checkout to `\\wsl.localhost\…`, which cmd.exe silently refuses as a working directory — it falls back to `C:\Windows`, and npm then reports a missing script, a failure that reads as a broken repository. The old `cd /d \\wsl$\…` form failed on exactly the same thing, less clearly. `wslpath -w` is now used only for this check, and the wrapper exits non-zero naming the path.

**`%VAR%` residual, stated in the wrapper rather than fixed.** cmd.exe expands `%VAR%` in whatever command line it ends up with, under any construction. The four callers pass literal words only. Not an [accepted-behaviors](../accepted-behaviors.md) row: that register is for product behavior, and this is internal to a dev script whose own comment carries it.

**Engines: deferred, not re-decided.** `--engine-strict=false` is gone and the root `.npmrc` from [P16.03](03-published-payload.md) governs, which npm reads from the working directory the wrapper now `cd`s into. The consequence is intended and written next to the code so it is not re-added: a Windows Node below `>=24.17.0` now fails `install-wsl.sh`, on the one platform combination that was suppressing the floor.

**Verification is a stub harness, not a live WSL run.** Real WSL + `cmd.exe` was not available on the implementing host, so `packages/core/test/wsl-wrapper.test.ts` stubs `wslpath` and `cmd.exe` on `PATH` and copies the six scripts into a checkout named `checkout with space`. It pins the exact argv (`/d /s /c npm run build`, …) for each of the four callers, `verify-wsl.sh`'s four steps in order, the handed-over working directory (proved by spawning from _outside_ the checkout), exit-code propagation, the UNC refusal, and — as the class assertion — that no argument contains `&&` or `engine-strict`. Confirmed to have teeth: against the pre-change wrapper, 7 of its 9 tests fail. What it cannot show is that interop's cwd translation and cmd's `PATHEXT` resolution of `npm` behave as reasoned; both fail loudly rather than silently if not. It also asserts the root `.npmrc` still sets `engine-strict=true`, so the joint decision cannot be re-opened from either end.

**W-55 — one helper, so the class closes at the seam.** Both splices go through `replaceGeneratedBlock()` in [`scripts/generated-block.mjs`](../../../scripts/generated-block.mjs), which uses a replacer function (whose return value is used literally) exactly as [`repo-scan.ts`](../../../packages/core/src/discovery/repo-scan.ts) does. It was extracted into its own module rather than left inline because a guard needs an importable seam: `generate-docs.mjs` writes files at module scope, so no test can import it. New behavior, deliberately: a missing marker pair now throws instead of silently no-opping, which previously surfaced only as a byte diff in another package's docs-sync suite, far from the cause.

**Byte-identical regeneration confirmed.** `npm run build && npm run generate:docs` left `README.md` and `packages/cli/schema.json` at their pre-change SHA-256 (`9648c4d5…`, `c6725b98…`).

**The guard covers the next call site, not just this one.** `packages/core/test/generated-block.test.ts` feeds `$&`, `` $` ``, `$'`, `$1` and `$$` through the helper and asserts both the literal text and that the marker pair still occurs exactly once — `$&` alone would splice a copy of the whole matched block, END marker included, which is the corruption W-55 describes. It also asserts the wrapper shape the two docs-sync extraction regexes key on. Following the `release:check` precedent in `package-payload.test.ts`, it reads the script text as well: `generate-docs.mjs` must call the helper twice and call no `.replace()` of its own, because a behavioral test over today's two call sites stays green when a third is added with an interpolated replacement string.

**No inventory, glossary, or register changes.** No sixth `@boundary-guard` category, for the reason [P16.03](03-published-payload.md) already recorded when it declined one: these are in-process assertions, and the five categories answer a different systemic cause. Nothing here adds or renames a public type, config key, CLI flag, MCP tool, rule ID, or assertion primitive, so the glossary's `generate:docs` entry stays accurate as written.
