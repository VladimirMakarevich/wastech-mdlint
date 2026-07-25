# P11.06 · Escape regex substitution in `REF-004` / `CTX-003`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Findings **M-1** (run crash) and **L-1** (lost matches),
> [post-P9 audit](../audit-2026-07-25-post-p9.md).

## Goal

Directory and alias names must not be interpolated into a `RegExp` unescaped. Today one form crashes
the whole lint run and another silently miscounts — the "unescaped/unsafe regex substitution" class
the audit's [§4](../audit-2026-07-25-post-p9.md) calls out.

## Problem (from the audit)

**M-1 — `REF-004` interpolates a directory name unescaped.** `packages/core/src/engine/rules/ref.ts:242`:

```ts
new RegExp(`(^|[^A-Za-z0-9_-])${zone}([^A-Za-z0-9_-]|$)`).test(body);
```

`zone` is a directory name from `context.projectFiles` (`ref.ts:221-226`). A directory named `c++` →
`SyntaxError: Invalid regular expression … Nothing to repeat` — the **entire run crashes with a
stacktrace** instead of a structured diagnostic; `we)ird` → `Unmatched ')'`. Names like `node.js` or
`v2(beta)` do not crash but **match wrongly** (`.` matches any char; parens become a group). The
correct escaper is 170 lines away in the same package — `packages/core/src/engine/rules/ctx.ts:70-73`
(`wholeWordRegex`) escapes exactly this. Separately, `:242` rebuilds the regex inside a triple-nested
loop (documents × headings × zones).

**L-1 — `CTX-003` loses adjacent alias occurrences.** `ctx.ts:70-73` builds
`(^|[^A-Za-z0-9_])(alias)([^A-Za-z0-9_]|$)` and consumes the boundary characters via `matchAll`
(`ctx.ts:152`), so two occurrences separated by a single character cannot both match: `api api api`
reports **2**, not 3. [`docs/guide/rules/CTX-003.md:10`](../../guide/rules/CTX-003.md) promises
"reports each occurrence." The fix is a lookahead / `\b`-style boundary that does not consume the
separator.

## Deliverables / steps

1. **M-1:** escape `zone` with the same helper `ctx.ts` uses (extract the escape logic into a shared
   util if cleaner) before building the `REF-004` regex, and hoist the compiled regex out of the
   inner loop so it is not rebuilt per heading/zone.
2. **L-1:** change the `CTX-003` boundary to a non-consuming lookahead (or `\b`) so adjacent
   occurrences separated by one character are both counted.
3. Tests: a `c++` / `we)ird` directory no longer crashes `REF-004` and produces correct declared-zone
   results; `node.js` no longer matches spuriously; `api api api` reports 3 occurrences for `CTX-003`.

## Exit criteria

- [ ] `REF-004` never throws on a regex-special directory name; matches are literal, not pattern-wise.
- [ ] The `REF-004` regex is compiled once per zone set, not inside the innermost loop.
- [ ] `CTX-003` counts every occurrence, including adjacent ones (guide claim satisfied).
- [ ] Regression tests cover the crash, the spurious-match, and the adjacency cases.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
