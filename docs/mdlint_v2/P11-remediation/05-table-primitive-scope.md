# P11.05 · Table primitives — honor `exclude`, use stateless `g`/`y` regex

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Done**. Findings **M-2** ([post-P9 audit](../audit-2026-07-25-post-p9.md)) and
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

- [x] `columnUnique` honors `exclude` with or without `files`; no false `error` on excluded files.
- [x] `columnMatches` is order-independent under `g`/`y` flags (reset, stripped, or rejected).
- [x] Regression tests cover both the `exclude`-only and the `g`-flag cases.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **M-2 fix**: `columnUnique` (`packages/core/src/engine/primitives/table.ts`) now calls
  `fileMatches` unconditionally, dropping the `options.files !== undefined` precondition. The
  `ColumnUniqueOptions.files` field comment was updated to note that scoping is actually enforced
  through the `fileMatches` callback (which already honors both `files` and `exclude` at its call
  sites in `rules/tbl.ts` and `rules/custom.ts`), not through this field being read directly inside
  the primitive. `options.files` itself is now unread inside `columnUnique` — left in place as a
  documented, deliberate wart rather than restructuring the exported option shape, per this task's
  "do not restructure the primitive vocabulary" constraint.
- **TP-1 fix — reset over reject**: `columnMatches` now resets `regex.lastIndex = 0` immediately
  before each per-row `test()` call, rather than rejecting `g`/`y` in the flags schema. The
  alternative (schema rejection) is explicitly suggested by the source research report, but this
  task's own step 3 requires a regression test where a `"flags":"g"` config **produces correct
  findings** rather than a validation error — that's only possible if `g`/`y` stay legal. No schema
  changes were made; the entire code fix is inside `table.ts`, matching the task's "same file"
  framing. Because `g`/`y` remain accepted while carrying no meaning for a per-cell membership
  test, `docs/guide/rules/TBL-004.md` and the `columnMatches` bullet in `docs/guide/rules/custom.md`
  now say so explicitly — an accepted-but-inert option is exactly the kind of thing a reader would
  otherwise have to infer from the source.
- `columnUnique`'s `idPattern`-derived regex and `crossColumn`'s `evaluateCondition` regex were
  checked and are structurally unaffected: `idPattern` has no accompanying `flags` field in either
  schema (`tbl.ts`, `assert.ts`), so it can never carry `g`/`y`; `evaluateCondition` compiles a fresh
  `RegExp` per call rather than hoisting one outside the row loop, so it was never stateful.
- **Tests**: `packages/core/test/primitives.test.ts` gained primitive-level regression tests for
  both fixes (order-independence under `"flags":"g"`; `exclude`-only `fileMatches` with
  `options.files` omitted). `packages/core/test/rules-tbl.test.ts` gained rule-level (`lintFiles`)
  regression tests for `TBL-004` and `TBL-006`, and its `fixtureRepo` helper gained a
  `mkdir(recursive: true)` step (matching the helper already used in `rules-sec.test.ts` and
  siblings) to support a nested `archive/old.md` fixture.
- **No changes needed** to `docs/guide/rules/TBL-006.md` (it already documents `files`/`exclude` as
  narrowing the participating file set — this fix makes reality match the existing promise rather
  than changing it), `rules/tbl.ts` / `rules/custom.ts` (no schema/wiring changes; both already
  build the `fileMatches` closure correctly), `docs/mdlint_v2/glossary.md` (no term added, renamed,
  or retired), or `packages/cli/schema.json` (no schema shape changed).
