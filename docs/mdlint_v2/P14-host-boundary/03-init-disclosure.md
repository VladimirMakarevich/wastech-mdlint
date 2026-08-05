# P14.03 · `init` disclosure and the hidden-directory default

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-14](../remediation-backlog-2026-08-05.md) (High), [W-15](../remediation-backlog-2026-08-05.md) (Medium, **decision**). Sources: field F-11 (major) — split into its two separable halves. Depends on [P13.02](../P13-correctness/02-default-exclude.md).

## Goal

Make `init` tell the user what its excludes dropped, and decide whether one of those excludes belongs in a lint-time config at all. The disclosure half is a defect; the default half is a decision. They ship together because the disclosure is what makes the default survivable either way.

## Problem

**W-14 — `init` never discloses what its hidden-directory exclude drops.** Measured on a real monorepo: `init --yes` printed 5 include patterns and 11 exclude globs, then left the corpus at **139 files where `git ls-files` tracks 202**. The 63-file gap is entirely `"**/.*/**"`: `.claude/` (28), `.agents/` (23), `backend/.rules/` (6), `mobile/.rules/` (6). `comm` against `git ls-files` showed nothing else missing and nothing extra — so the number is fully accounted for, and nothing said so. A user reads the include list, sees `docs/`, `backend/`, `mobile/`, `tasks/`, and has no reason to suspect `.claude/` was considered and dropped.

**The information is demonstrably available at write time.** `graph`'s own `coverage.filesOutsideCorpus` already lists 12 of these files as linked-but-outside-the-corpus — the field test called it the single best diagnostic in the graph report, and it is exactly this task's evidence.

**W-15 — is the lint-time exclude the right default?** The rationale in `discovery/repo-scan-constants.ts` is sound for the **scan**: `.github`, `.venv`, `.husky` hold tooling Markdown that would pollute cluster inference, and hidden directories are pruned by shape because a name list can never enumerate them (recorded as audit L-7). But that pruning decision is then written out as a permanent **lint-time** exclude (`HIDDEN_DIR_EXCLUDE_GLOB` in [`packages/core/src/discovery/config-writer.ts`](../../../packages/core/src/discovery/config-writer.ts)), and those are different questions.

Why it matters for this product specifically: in the field-test target the dot-directories hold `.claude/skills/`, `.agents/rules/`, and two `.rules/` sets — 31% of the tracked corpus, and precisely the LLM-facing documentation this tool exists to lint. **This repository has the same shape.**

## Deliverables / steps

1. **W-14 — report the count and the reason** in `init`'s summary, e.g. "63 Markdown files were excluded because they live in hidden directories." Derive it from the scan rather than re-walking: the scan already knows what it pruned and why, and a second walk is a second thing to disagree with the first. This makes the default self-correcting even if W-15 keeps it.
2. **W-14 — disclose per reason, not as one total.** The 11 written excludes are not one class: `**/node_modules/**` dropping vendored Markdown is unsurprising, `**/.*/**` dropping `.claude/skills/` is the finding. A single "N files excluded" number invites the user to ignore it.
3. **W-15 — decide, and record the decision either way.**
   - **(A) Separate the two questions:** keep the hidden-directory prune in the scan (where its rationale holds) and stop writing it as a lint-time exclude, or write it narrowed to the tooling directories that motivated it.
   - **(B) Keep the exclude** and record it in [`accepted-behaviors.md`](../accepted-behaviors.md), with W-14's disclosure requirement as its stated condition and a guide home that says so.
   - Direction (A) changes what `init` writes for every repository; direction (B) does not. Both are defensible, and the register exists for exactly this.
4. **Interaction with [P13.02](../P13-correctness/02-default-exclude.md):** that task ships lint-time defaults. If it decides a user `exclude` **replaces** the defaults, `init`'s written excludes now shadow them and the two lists must be reconciled; if it **extends**, `init` can stop writing the ones the default already covers. Check which, and say so.
5. **Test:** `init --yes` on a fixture with Markdown in a dot-directory must name the excluded count in its summary. This is the second of the two fixtures [P16.01](../P16-release-readiness/01-test-debt.md) enumerates — build it here and let that task assert the corpus comparison against a tracked-file list in both directions.
6. **Glossary.** The `init` and `generateInitConfig` entries describe the written excludes in detail; whichever direction W-15 takes, they must end up describing it.

## Out of scope

Widening what `init` infers (that is W-39, in [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)). Changing the scan's own pruning rationale — it is sound and audit L-7 recorded why a name list cannot replace it.

## Exit criteria

- [ ] `init --yes` on a repository with Markdown in a dot-directory names the excluded count **and the reason** in its summary.
- [ ] The disclosure distinguishes classes of exclusion rather than printing one total.
- [ ] W-15 is resolved either in code or as a row in [`accepted-behaviors.md`](../accepted-behaviors.md) with a guide home that states the behavior.
- [ ] The relationship between `init`'s written `exclude` and P13.02's lint-time default is stated (replace or extend), and the two do not silently duplicate each other.
- [ ] The glossary's `init` / `generateInitConfig` entries describe the shipped behavior.
- [ ] Gates green.
