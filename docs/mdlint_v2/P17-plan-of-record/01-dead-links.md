# P17.01 · Dead links and absent documents

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**. Backlog: [W-43](../remediation-backlog-2026-08-05.md) (Medium), [W-44](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F6 (MEDIUM; **citation corrected** by the QA pass — the 11th link is at `audit-2026-07-25-post-p9.md:3`, not `:31`), F5 (MEDIUM). Depends on [P16](../P16-release-readiness/index.md). Blocks [P17.02](02-self-linting-config.md).

## Goal

Clear every dead link inside the plan of record, so that [P17.02](02-self-linting-config.md)'s CI gate is green the day it lands rather than red on known debt.

## Problem

**W-43 — 17 dead links inside the plan.** Reproduced by the product's own `REF-001` with an externally supplied config: exactly **17 problems**. They break down as:

- **11 links across 9 files** point at a report removed in `d96b64c`. Verified in the current tree: 11 markdown-link occurrences across 9 files (there are further bare-code-span mentions of the same name, which are **not** links and must not be swept as if they were). **Five of the 11 are `Status **Done**` task-file header lines whose sole citation for the defect the task claims to fix is the missing file** — which is the half that matters, because it means the evidence for five completed tasks is unreachable.
- **Four** point into gitignored `tasks/pending/`.
- **Two** are W-44's.

**W-44 — `PLAN.md` and `docs/plan/` do not exist.** `AGENTS.md:39` states that historical v1 planning "remains in `PLAN.md` and `docs/plan/`". `PLAN.md` was deleted in `957a1ca` as a side effect of a P8.01 skills commit; `docs/plan/` was **never tracked at all**. The roadmap links to both at `index.md:5` and `:11`. The governance file is the first thing a new contributor or agent reads, so this one is read more often than any other document in this phase.

## Deliverables / steps

1. **Repoint the 11 citations** at the two frozen audit reports that remain. For the five `Status **Done**` header lines, the repointed citation must actually contain the finding the task claims to fix — a link that resolves but cites nothing is the same defect with a green check. If a finding genuinely exists only in the deleted report, say so at the citation rather than pointing at a report that does not contain it.
2. **Drop or re-target the four `tasks/pending/` links.** `tasks/` is gitignored and deliberately outside the format gate, so a link into it can never resolve for a reader who cloned the repository.
3. **Distinguish links from mentions.** Only markdown-link occurrences are dead links; bare code spans naming the old report are prose and may be legitimate history. Sweep the former, review the latter.
4. **W-44:** drop the sentence at `AGENTS.md:39` and the two links at `index.md:5` and `:11`. If the v1 history is worth a pointer, point at the git history that has it rather than at paths that do not exist.
5. **Verify with the product**, not by eye: run `REF-001` over `docs/**` with an externally supplied config and require zero problems before finishing. That is the same run that found them, and it is the acceptance test.
6. **Leave the count reachable.** Note in the change that the pre-fix number was 17, so [P17.02](02-self-linting-config.md)'s first green CI run is verifiable against a stated baseline.

## Out of scope

Adding the repository configuration or the CI step — that is [P17.02](02-self-linting-config.md), and it depends on this task. Rewriting `AGENTS.md` more broadly: `PR.04` owns the governance-file rewrite.

## Exit criteria

- [ ] `REF-001` over `docs/**` with an externally supplied config reports **zero** problems, down from 17.
- [ ] Each of the five `Status **Done**` header citations points at a document that actually contains the finding, or says plainly that the evidence was in the deleted report.
- [ ] No link into `tasks/pending/` remains in the plan.
- [ ] Bare code-span mentions of the deleted report were reviewed rather than swept.
- [ ] `AGENTS.md:39` and `index.md:5`/`:11` no longer reference `PLAN.md` or `docs/plan/`.
- [ ] `npm run format` green on every touched file.
