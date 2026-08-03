# P11.06 · Escape regex substitution in `REF-004` / `CTX-003`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Findings **M-1** (run crash) and **L-1** (lost matches), [post-P9 audit](../audit-2026-07-25-post-p9.md).

## Goal

Directory and alias names must not be interpolated into a `RegExp` unescaped. Today one form crashes the whole lint run and another silently miscounts — the "unescaped/unsafe regex substitution" class the audit's [§4](../audit-2026-07-25-post-p9.md) calls out.

## Problem (from the audit)

**M-1 — `REF-004` interpolates a directory name unescaped.** `packages/core/src/engine/rules/ref.ts:242`:

```ts
new RegExp(`(^|[^A-Za-z0-9_-])${zone}([^A-Za-z0-9_-]|$)`).test(body);
```

`zone` is a directory name from `context.projectFiles` (`ref.ts:221-226`). A directory named `c++` → `SyntaxError: Invalid regular expression … Nothing to repeat` — the **entire run crashes with a stacktrace** instead of a structured diagnostic; `we)ird` → `Unmatched ')'`. Names like `node.js` or `v2(beta)` do not crash but **match wrongly** (`.` matches any char; parens become a group). The correct escaper is 170 lines away in the same package — `packages/core/src/engine/rules/ctx.ts:70-73` (`wholeWordRegex`) escapes exactly this. Separately, `:242` rebuilds the regex inside a triple-nested loop (documents × headings × zones).

**L-1 — `CTX-003` loses adjacent alias occurrences.** `ctx.ts:70-73` builds `(^|[^A-Za-z0-9_])(alias)([^A-Za-z0-9_]|$)` and consumes the boundary characters via `matchAll` (`ctx.ts:152`), so two occurrences separated by a single character cannot both match: `api api api` reports **2**, not 3. [`docs/guide/rules/CTX-003.md:10`](../../guide/rules/CTX-003.md) promises "reports each occurrence." The fix is a lookahead / `\b`-style boundary that does not consume the separator.

## Deliverables / steps

1. **M-1:** escape `zone` with the same helper `ctx.ts` uses (extract the escape logic into a shared util if cleaner) before building the `REF-004` regex, and hoist the compiled regex out of the inner loop so it is not rebuilt per heading/zone.
2. **L-1:** change the `CTX-003` boundary to a non-consuming lookahead (or `\b`) so adjacent occurrences separated by one character are both counted.
3. Tests: a `c++` / `we)ird` directory no longer crashes `REF-004` and produces correct declared-zone results; `node.js` no longer matches spuriously; `api api api` reports 3 occurrences for `CTX-003`.

## Exit criteria

- [x] `REF-004` never throws on a regex-special directory name; matches are literal, not pattern-wise.
- [x] The `REF-004` regex is compiled once per zone set, not inside the innermost loop.
- [x] `CTX-003` counts every occurrence, including adjacent ones (guide claim satisfied).
- [x] Regression tests cover the crash, the spurious-match, and the adjacency cases.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **Shared escaper**: `escapeRegExp` was added to `packages/core/src/engine/regex.ts` (the same module both `ref.ts` and `ctx.ts` already reach into for `regexStringSchema`/`compileRegex`), not exported from `packages/core/src/index.ts` — it is an internal rule-file helper, not a public type/config-key/CLI-flag/MCP-tool/rule-ID, so no glossary entry applies. Both `ref.ts` and `ctx.ts` now import it instead of `ref.ts` interpolating `zone` raw and `ctx.ts` keeping its own private inline escape (`term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`), which is now the shared function's body.
- **M-1 fix (`ref.ts`)**: `REF-004`'s `allZones: Set<string>` became `zoneMentionRegexes: Map<string, RegExp>`, built in the same single pass over `context.projectFiles` the old `Set` used, guarded by `.has(zone)` so each zone's regex compiles exactly once regardless of how many files in `context.projectFiles` share that zone. The regex source now escapes `zone` via `escapeRegExp` before interpolation, so a directory literally named `c++` or `we)ird` no longer throws (`SyntaxError`), and `node.js` matches only the literal string, not `node` + any-char + `js`. The boundary character classes (`[^A-Za-z0-9_-]`, hyphen-inclusive) are unchanged — only the escaping and the compile-once hoist changed, not what counts as a zone mention.
- **L-1 fix (`ctx.ts`)**: `wholeWordRegex`'s trailing boundary changed from a consuming alternation group (`([^A-Za-z0-9_]|$)`) to a zero-width lookahead (`(?=[^A-Za-z0-9_]|$)`). `matchAll` no longer advances `lastIndex` past the separator character, so adjacent occurrences separated by exactly one boundary character are all reachable — `"api api api"` (or `"gql gql gql"`) now reports 3 occurrences instead of 2. The leading boundary (`match[1]`, still a capturing group, used at `ctx.ts` for the line-number offset) is untouched. `escapeRegExp` replaced the function's own inline escape line; the boundary character class (`[^A-Za-z0-9_]`, no hyphen) is unchanged, so the whole-word requirement itself wasn't loosened — verified by a companion no-separator test (`"gqlgql"` still reports zero matches).
- **Tests**: `packages/core/test/rule-utils.test.ts` gained a `describe("escapeRegExp", ...)` block covering the `c++`/`we)ird`/`node.js` cases (using `regexStringSchema.safeParse` rather than a literal `new RegExp("c++")`, since ESLint's `no-invalid-regexp` rule statically flags an invalid-pattern literal argument). `packages/core/test/rules-ref.test.ts` gained three `REF-004` regression cases: a `c++` zone (crash + correct declared-zone match), a `we)ird` zone (crash-only, no link needed since the regex is built for every zone in `context.projectFiles` regardless of whether the current document links to it), and a `node.js` zone (proves the fix turns a prior false-negative — `.` matching `X` — into a correct violation report). `packages/core/test/rules-ctx.test.ts` gained two `CTX-003` cases: adjacent occurrences (`"gql gql gql"` → 3 findings) and a no-separator control (`"gqlgql"` → 0 findings).
- **Guide**: `docs/guide/rules/REF-004.md` and `docs/guide/rules/CTX-003.md` already promised the now-fixed behavior ("whole token"/"reports each occurrence"), so this task made the code match an existing promise rather than documenting a new one. Each page gained one clarifying note for the edge the bug hid: that a zone name and an alias are compared as literal text (punctuation such as the `.` in `node.js` is not a wildcard), and that CTX-003 only checks the boundaries around an alias instead of consuming them, so back-to-back occurrences are each counted. No changes needed to `docs/mdlint_v2/glossary.md` (no public term added, renamed, or retired) or `packages/cli/schema.json` (no option-schema change on either rule).
