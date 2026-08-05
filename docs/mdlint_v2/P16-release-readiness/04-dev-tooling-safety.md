# P16.04 · Dev tooling: argv interpolation and a regex replacement string

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**. Backlog: [W-54](../remediation-backlog-2026-08-05.md) (Medium), [W-55](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F28 (LOW there — Medium here because it is the one item that breaches a security rule outright), F40 (LOW, latent). Depends on [P15](../P15-output-contracts/index.md).

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
2. **W-54:** drop `--engine-strict=false` and resolve the engines question with [P16.03](03-published-payload.md) — the two are the same decision seen from two sides, and fixing one alone reinstates the contradiction.
3. **W-54:** verify with a checkout path containing a space, which is the reproduction that costs nothing and is the likeliest real-world trigger.
4. **W-55:** pass a **replacer function** at both call sites, matching what `repo-scan.ts:82` already does for the same reason. A function's return value is used literally, so the class closes rather than being escaped case by case.
5. **W-55:** regenerate after the change and confirm the README's generated blocks are byte-identical to before — the point is that inert input stays inert, so a diff here would mean the fix changed behavior it should not have.
6. **W-55 — consider a guard.** A test that feeds a description containing `$&` through the generator and asserts the literal survives is cheap and pins the class. Without it the next generator call site reintroduces it.

## Out of scope

Any change to product `spawn` calls — both were checked and are compliant. Reworking the WSL wrapper's purpose or the four scripts that feed it.

## Exit criteria

- [ ] The WSL wrapper uses an explicit argument vector, or quotes the path and every argument.
- [ ] A checkout path containing a space works.
- [ ] `--engine-strict=false` is gone, and the engines decision from [P16.03](03-published-payload.md) is what governs instead.
- [ ] Both `generate-docs.mjs` call sites pass a replacer function.
- [ ] Regenerated README blocks are byte-identical to before the change.
- [ ] A guard pins that a `$`-sequence in a description survives literally.
- [ ] Gates green.
