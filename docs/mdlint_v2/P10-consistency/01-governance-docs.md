# P10.01 · Fix governance docs (root `src/`/`test/`, post-P3.09 wording, typo)

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit findings **M-7**, **L-4** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make the governance docs describe the actual filesystem: all product code lives in `packages/*`;
the legacy root `src/` and `test/` were removed at the P3.09 cutover.

## Problem (from the audit)

- `AGENTS.md:11` — "The current repository still contains the single-package codebase in `src/`
  and `test/`."
- `.agents/rules/architecture.md:17` — "still contains … code in `src/`", and a doubled-word
  typo: "current single-package single-package code in `src/`."

Both files also instruct agents to "treat the current filesystem state as truth for where code
lives today" — so they simultaneously assert a deleted structure (`packages/core/src/index.ts:5`
records that the legacy pipeline was removed at P3.09). This self-contradiction misdirects where
code lives.

## Deliverables / steps

1. Update `AGENTS.md`'s "Project State" section to state that the single-package code has been
   relocated into `packages/core` (P0.04) and the legacy pipeline removed (P3.09) — the repo is
   now the v2 workspace, not a pre-migration single package.
2. Update `.agents/rules/architecture.md`'s "Current vs Target State" the same way and fix the
   "single-package single-package" doubled word.
3. Keep the "treat the filesystem as truth" guidance — it is now consistent with reality.

## Exit criteria

- [ ] No governance doc claims a root `src/`/`test/` that does not exist.
- [ ] The doubled-word typo is fixed.
- [ ] Wording matches the post-P3.09 workspace layout.
