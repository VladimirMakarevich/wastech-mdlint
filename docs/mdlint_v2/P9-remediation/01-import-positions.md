# P9.01 · Fix line/column for multi-line `@import` blocks

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **M-1** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Report the correct `line`/`column` for every `@import` in a document, including imports that are
not on the first line of their paragraph.

## Problem (from the audit)

remark packs consecutive non-blank lines into a **single** `text` node. `extractImports`
(`packages/core/src/markdown/parse-document.ts:209-232`) attributes every regex match to
`node.position.start.line` and computes `column` as a byte offset from the node start. So in a
block like the one in this repo's own `CLAUDE.md`:

```
@AGENTS.md
@.agents/rules/architecture.md
@.agents/rules/coding-style.md
```

the 2nd and 3rd imports are reported at `line: 1` with a bogus large `column`. The `rawTarget`
set is complete — only positions are wrong. Import positions feed D3 eager-import budgeting and
the `import` graph edges (which carry `line` for G3 explainability), so anchored findings/edges
point at the wrong location.

## Deliverables / steps

1. In `extractImports`, compute each match's absolute offset within `node.value`, then derive the
   real line/column by counting newlines before the match (relative to `node.position.start`),
   rather than using the node start line for all matches.
2. Keep the existing `@`-locating logic for the column of the `@` within its own line.
3. **Regression test** in `parse-document.test.ts`: a multi-line `@import` block asserting each
   import's `line` and `column` (single-line imports already covered at `:145-159`).

## Exit criteria

- [x] Each import in a multi-line block reports its own correct `line`/`column`.
- [x] New multi-line-block test fails on the old code and passes on the fix.
- [x] `npm run typecheck && npm test` green.
