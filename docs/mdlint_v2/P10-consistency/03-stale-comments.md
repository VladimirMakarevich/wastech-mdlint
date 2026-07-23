# P10.03 · Clean stale source comments/notes

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit findings **L-1**, **L-2** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Remove source comments that describe a past state or a nonexistent concept, so readers don't
reverse-engineer false assumptions from them. Comment-only edits — no behavior change.

## Problem (from the audit)

- **L-1** `packages/core/src/markdown/load-documents.ts:141` — comment says `exclude`/
  `respectGitignore` are "not yet config-driven — P2 wires …", but the wiring already exists in
  `engine/lint-files.ts:66-69`. The comment is stale.
- **L-2** `packages/core/src/markdown/document-types.ts:12` — comment references `CHK-001`
  ("checkItems → CHK-001 / CTX-002"). There is no CHK category (checklist completeness is
  CTX-002); this reintroduces the exact phantom category the roadmap warns against.

## Deliverables / steps

1. Rewrite the `load-documents.ts:141` comment to state that `exclude`/`respectGitignore` are
   config-driven via `lintFiles` → `loadDocuments` (drop the "P2 wires" future tense).
2. Remove the `CHK-001` reference in `document-types.ts:12`, leaving only `CTX-002`.
3. Grep for any other `CHK` / "P2 wires" / future-tense-but-done comments and fix in the same pass.

## Exit criteria

- [ ] No `CHK-*` reference remains in source comments.
- [ ] No "not yet config-driven — P2 wires" (or similar already-done future-tense) comment remains.
- [ ] `npm run typecheck` green (comment-only change).
