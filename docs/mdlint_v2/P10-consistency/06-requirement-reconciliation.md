# P10.06 · Reconcile requirement/plan text

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit findings **L-8**, **L-9**, **L-10** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Align a few requirement/plan sentences with the shipped code, so the higher-precedence task files
and the requirement text no longer disagree. Documentation-only.

## Problem (from the audit)

- **L-8** `requirements/02-rules-engine.md` R7 ("uniform `files`/`exclude` base for *every* rule")
  is literally contradicted: `fileScopeShape` (`rules/scope.ts:10`) is omitted by REF-001/003/004/
  005, LLM-001, SIZE-001 (SIZE uses `overrides[].pattern`). The P3 task tables (higher precedence)
  don't promise `files?` on those, so the code matches the *specific* plan — R7's general text
  needs a one-line reconciliation.
- **L-9** `requirements/05-mcp-server.md:13` (M1 table) shorthand says "graph/slice/impact/lint",
  omitting `lint-files`; the detail paragraph (24-28) is correct. Doc shorthand only.
- **L-10** P5.04 (step 5) says to define the skill frontmatter schema "here" (in `synthesize.ts`),
  but it lives in `compile/skill-frontmatter.ts` (still core/compile). Single-source is preserved;
  only the task wording is stale.

## Deliverables / steps

1. R7: add a sentence noting scoping shape is per-rule (identity/project rules that operate over
   the whole corpus intentionally omit `files?`), deferring to the P3 task tables as authoritative.
2. Fix the M1 table cell to list all five structured tools (or say "5 structured tools + compile").
3. Correct P5.04's wording to point at `compile/skill-frontmatter.ts` (couple with
   [P9.05](../P9-remediation/05-custom-heading-target.md) if regenerating docs).

## Exit criteria

- [ ] R7 text no longer contradicts the shipped per-rule scoping.
- [ ] The M1 table matches its own detail paragraph.
- [ ] P5.04 names the actual schema location.
