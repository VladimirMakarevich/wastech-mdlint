# P10.01 · Fix governance docs (root `src/`/`test/`, post-P3.09 wording, typo)

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit findings **M-7**, **L-4** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make the governance docs describe the actual filesystem: all product code lives in `packages/*`; the legacy root `src/` and `test/` were removed at the P3.09 cutover.

## Problem (from the audit)

- `AGENTS.md:11` — "The current repository still contains the single-package codebase in `src/` and `test/`."
- `.agents/rules/architecture.md:17` — "still contains … code in `src/`", and a doubled-word typo: "current single-package single-package code in `src/`."

Both files also instruct agents to "treat the current filesystem state as truth for where code lives today" — so they simultaneously assert a deleted structure (`packages/core/src/index.ts:5` records that the legacy pipeline was removed at P3.09). This self-contradiction misdirects where code lives.

## Deliverables / steps

1. Update `AGENTS.md`'s "Project State" section to state that the single-package code has been relocated into `packages/core` (P0.04) and the legacy pipeline removed (P3.09) — the repo is now the v2 workspace, not a pre-migration single package.
2. Update `.agents/rules/architecture.md`'s "Current vs Target State" the same way and fix the "single-package single-package" doubled word.
3. Keep the "treat the filesystem as truth" guidance — it is now consistent with reality.

## Exit criteria

- [x] No governance doc claims a root `src/`/`test/` that does not exist.
- [x] The doubled-word typo is fixed.
- [x] Wording matches the post-P3.09 workspace layout.

## Implementation notes

Documentation-only change; no product code touched.

- The fix is stated as **history plus a present-tense fact** ("relocated into `packages/core` at P0.04, legacy pipeline removed at the P3.09 cutover; there is no root `src/` or `test/`") rather than a bare "code lives in `packages/*`". Naming the two cutover tasks lets a reader who encounters a stale `src/` reference elsewhere date it instead of re-deriving the migration from git history.
- `AGENTS.md`'s opening framing sentence changed too, not just the bullet the audit cited. The bullet was the false claim, but "is being rebuilt from the current single-package implementation" carried the same wrong tense; correcting only the bullet would have left the section reading as pre-migration.
- The "treat the current filesystem state as truth" / "treat the v2 roadmap as truth" bullets are deliberately kept verbatim. They were never wrong — they were the half of the contradiction that pointed at reality, and they are the guidance that keeps this class of drift self-correcting.
- `.agents/rules/coding-style.md`'s "Repository Structure" bullet was fixed even though the audit (M-7) did not cite it. Its claim was conditional ("until P0 fully lands, code may still live in `src/` and `test/`"), and the condition has since resolved, so it is the same defect in another governance file. Exit criterion 1 is written generally rather than per-file, which is the bar applied here.

Deliberately out of scope, so a later reader does not mistake these for oversights:

- `docs/mdlint_v2/index.md:5` ("turning the current single-package implementation into…") still uses pre-migration framing. It is the roadmap's backward-looking statement of why the roadmap exists, not a live "where does code live today" instruction paired with a filesystem-as-truth directive — so it is not the contradiction this task targets.
- The audit report stays frozen as a historical record; findings are closed here, not edited there.
- Surrounding forward-looking cautions ("do not invent post-P0 package layout", "do not fake future package boundaries", "the target architecture is an npm-workspaces monorepo") still read as if the workspace were pending, now that all three packages exist. They assert no false current state, so they were left alone to keep this diff auditable against M-7/L-4; rewording them into the shipped-present tense is a separate consistency pass.
