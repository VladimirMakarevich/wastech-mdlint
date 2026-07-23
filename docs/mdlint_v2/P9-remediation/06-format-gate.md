# P9.06 · Fix and enforce the Prettier format gate

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **M-6** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make `npm run format` meaningful: either green and enforced, or explicitly retired — not a
documented gate that is silently red across the repository.

## Problem (from the audit)

`npm run format` (`prettier --check .`) reports **~203 files** with style issues, while
`.github/workflows/ci.yml`'s `verify` job runs `typecheck`/`lint`/`test`/`build` but **not**
`format`. So the gate documented in `AGENTS.md` and `.agents/rules/testing.md` is red repo-wide
and unenforced.

## Deliverables / steps

1. Run `npx prettier --write .` to normalize the tree (review the diff — it should be pure
   formatting; no behavioral changes).
2. Confirm `.prettierignore` covers generated/vendored artifacts that should not be formatted
   (currently `dist`, `coverage`, `.vitest`, `packages/**/dist`); extend if the write touches
   files that should be excluded (e.g. committed generated `schema.json`, if intentionally raw).
3. Add `npm run format` to the CI `verify` job so drift fails fast.
4. Alternative (if the team decides formatting is not a gate): remove the `format` expectation
   from `AGENTS.md`/`.agents/rules/testing.md` so docs and reality agree. Do **not** leave it
   documented-but-unenforced.

## Exit criteria

- [ ] `npm run format` exits 0 on a clean checkout, **or** the format gate is explicitly removed from the rules docs.
- [ ] If kept: CI enforces `format`; the normalizing commit is formatting-only.
- [ ] No behavioral change from the reformat (tests still green).
