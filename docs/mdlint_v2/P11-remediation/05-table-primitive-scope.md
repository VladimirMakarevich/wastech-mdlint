# P11.05 · Table primitives — honor `exclude`, use stateless `g`/`y` regex

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Findings **M-2** ([post-P9 audit](../audit-2026-07-25-post-p9.md)) and
> **TP-1** ([`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md)).

## Goal

Two determinism/scope defects in `packages/core/src/engine/primitives/table.ts` both produce false
`error`-severity findings from a legal config. Fix them together — same file, same "table primitive
emits wrong findings" class.

## Problem (from the audits)

**M-2 — `columnUnique` ignores `exclude` when `files` is absent.** `table.ts:267` gates on
`if (options.files !== undefined && !fileMatches(document.path)) continue;`. `fileMatches` =
`matchesFileScope(path, options)` honors **both** `files` and `exclude` (`rules/tbl.ts:286`,
`rules/custom.ts:109`) — but it is only called when `files` is set. So a config with `exclude` and no
`files` skips the scope check entirely and flags excluded files:

| config                                              | result                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `{"column":"ID","exclude":["archive/**"]}`          | **`archive/old.md:3 Duplicate value "REQ-1"` — false `error`** |
| `{"column":"ID","files":["**/*.md"],"exclude":[…]}` | clean                                                          |

This is strictly worse than `p9-09`'s SC-1 (a silent no-op): here the no-op produces false `error`
findings in a shipped rule (`TBL-006`) and in any declarative `custom` with `columnUnique`. `exclude`
is documented for `TBL-006` at [`docs/guide/rules/TBL-006.md:31`](../../guide/rules/TBL-006.md).

**TP-1 — `columnMatches` reuses a stateful `g`/`y` `RegExp` across rows.** `table.ts:137` compiles
the pattern once, then `:147` calls `regex.test(value)` inside the per-row loop. With `g` or sticky
(`y`) flags a `RegExp` is stateful — `test()` advances `lastIndex` across calls, even over different
strings (MDN / ECMA-262 §22.2.6.16) — so valid cells after the first are wrongly flagged and the
result is **order-dependent**. `regexFlagsSchema` (`engine/regex.ts:25`) only checks flags are legal,
so `g`/`y` pass. Both `TBL-004` (`rules/tbl.ts:207`) and `custom` `columnMatches`
(`primitives/assert.ts:67`) are affected. The safe pattern sits next door: `contentNotMatch` consumes
state via `matchAll` (`primitives/content.ts:22`).

## Deliverables / steps

1. **M-2:** call `matchesFileScope` unconditionally in `columnUnique` (`table.ts:267`) — drop the
   `options.files !== undefined` precondition — so `exclude`-only configs are honored.
2. **TP-1:** make the per-row test stateless — reset `regex.lastIndex = 0` before each `test()`, or
   strip/reject `g`/`y` in the `columnMatches`/`TBL-004` `flags` schema (a membership test has no use
   for either; schema rejection is self-documenting). If rejecting, note the constraint in the
   [`TBL-004` guide](../../guide/rules/TBL-004.md).
3. Tests: an `exclude`-only `columnUnique` config leaves excluded files unflagged; a `"flags":"g"`
   `columnMatches` over a multi-row column produces order-independent, correct findings. (Broader
   `exclude` coverage across rules is [P12.01](../P12-consistency/01-exclude-coverage.md).)

## Exit criteria

- [ ] `columnUnique` honors `exclude` with or without `files`; no false `error` on excluded files.
- [ ] `columnMatches` is order-independent under `g`/`y` flags (reset, stripped, or rejected).
- [ ] Regression tests cover both the `exclude`-only and the `g`-flag cases.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
