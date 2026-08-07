# P17.01 · Dead links and absent documents

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Backlog: [W-43](../remediation-backlog-2026-08-05.md) (Medium), [W-44](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F6 (MEDIUM; **citation corrected** by the QA pass — the 11th link is at `audit-2026-07-25-post-p9.md:3`, not `:31`), F5 (MEDIUM). Depends on [P16](../P16-release-readiness/index.md). Blocks [P17.02](02-self-linting-config.md).

## Goal

Clear every dead link inside the plan of record, so that [P17.02](02-self-linting-config.md)'s CI gate is green the day it lands rather than red on known debt.

## Problem

**W-43 — 17 dead links inside the plan.** Reproduced by the product's own `REF-001` with an externally supplied config: exactly **17 problems**. Re-run in the current tree after P13–P16, over `docs/**/*.md` + `README.md` with `REF-001`/`REF-002` enabled: still exactly 17, all `REF-001`, at the same sites. The round that added 60-odd plan files introduced no new dead link. They break down as:

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

- [x] `REF-001` over `docs/**` with an externally supplied config reports **zero** problems, down from 17.
- [x] Each of the five `Status **Done**` header citations points at a document that actually contains the finding, or says plainly that the evidence was in the deleted report.
- [x] No link into `tasks/pending/` remains in the plan.
- [x] Bare code-span mentions of the deleted report were reviewed rather than swept.
- [x] `AGENTS.md:39` and `index.md:5`/`:11` no longer reference `PLAN.md` or `docs/plan/`.
- [x] `npm run format` green on every touched file.

## Implementation notes

**Baseline 17, post-fix 0 — the number [P17.02](02-self-linting-config.md)'s first green CI run is measured against.** Both runs used the built CLI and a config held outside the tree, since the repository still has none of its own:

```bash
npm run build
cat > "$TMPDIR/mdlint-p17-01.json" <<'JSON'
{ "include": ["docs/**/*.md", "README.md"],
  "rules": [{ "rule": "REF-001" }, { "rule": "REF-002" }] }
JSON
node packages/cli/dist/index.js lint . --config "$TMPDIR/mdlint-p17-01.json"
```

Before: `✖ 17 problems (17 errors, 0 warnings)` — all `REF-001`, at exactly the sites this task file enumerates, with `REF-002` contributing none. After: `No problems found.`, exit `0`. The config omits `$schema` because the root config object is strict and the key is optional; `docs/**/*.md` is root-anchored while a bare `README.md` is not, and the default `exclude` extends rather than replaces, so no noise directory needed restating.

**All five `Status **Done**` citations took the escape clause, because no surviving audit restates their findings.** Checked by searching both frozen reports for each ID: `BL-1`, `OG-1` and `SC-3` appear in neither. `TP-1`, `SC-1` and `SC-2` appear in the post-P9 audit only as cross-references — `SC-1` characterized in passing at `:131`, all three named in the systemic-cause section at `:212`–`:214`, `TP-1` corroborated at `:203` as the only instance of its class — and none of the three defects (the stateful `RegExp` in `table.ts`, the inert `GRP` schema keys, the `SIZE-001` override collapse) is described there. Repointing any of them at a surviving report would have produced exactly the failure mode this task exists to prevent: a citation that resolves and cites nothing. Each header now names the finding, records that the `p9-09` report was removed in `d96b64c`, and points at its own Problem section as the surviving record. P11.05 and P11.13 additionally link the post-P9 audit for what it genuinely does corroborate, stated precisely so the link cannot be mistaken for the defect's source. No anchor links were added, which keeps `REF-002` at zero — the five Problem headings are not identically worded.

**The frozen audit was delinked, not edited.** `audit-2026-07-25-post-p9.md:3` held the eleventh link. The two audits are frozen by policy and are the sole definition site for the finding IDs four phases cite, so the link wrapper was stripped and the code span left in place — the same bare form that file already uses for the report at `:31`. No word of its Russian text changed.

**The four `tasks/pending/` links became plain code spans that say why they cannot be links.** `tasks/` is gitignored (`.gitignore:23`), so nothing under it exists in a clone. The P11 index's Execution note also asserted a stale premise — both release-blockers have since landed — so it now reads in the past tense.

**Reviewed and left: mentions are not links.** These name or describe the deleted report or the absent v1 paths in prose or a code span and are legitimate history — an audit describing what another audit did, or a plan file recording where a requirement came from: `audit-2026-07-25-post-p9.md:1`, `:9`, `:31`, `:32`, `:131`, `:203`, `:210`; `index.md:102`, `:244`, `:253`, `:305`; `P11-remediation/index.md:9`, `05-table-primitive-scope.md:18`, `11-llm-dedup.md:3`; `P12-consistency/index.md:9`, `04-mcp-custom-rules.md:11`, `06-process-boundary-tests.md:11`; `P3-rules/07-llm-rules.md:7`; `requirements/03-context-graph.md:52`; `remediation-backlog-2026-08-05.md:121`, `:526`, `:530`, `:533`; and the three research documents under `docs/research/audit-v2-implementation/`, which are the report that raised these findings.

**W-44 kept a pointer to the history rather than deleting the referent.** `AGENTS.md:39` now states that `PLAN.md` was deleted in `957a1ca` and is recoverable from git history while `docs/plan/` was never tracked at all — verified: `git log --all -- docs/plan` is empty. One sentence changed, nothing else in the governance file. The roadmap's `index.md:5` lost its `docs/plan/` comparison clause outright, since a directory that was never tracked has no honest re-target; `:11` keeps its sentence with the `PLAN.md` link replaced by the commit that deleted it.

**Documentation only.** No product code, interfaces, package metadata or dependencies, and no test file: the permanent guard against this class is [P17.02](02-self-linting-config.md)'s CI step, and this task's acceptance test is the product run recorded above. Nothing was accepted instead of fixed, and no term was added or retired, so neither the [accepted-behaviors register](../accepted-behaviors.md) nor the [glossary](../glossary.md) changes.

**One nearby falsehood surfaced rather than fixed.** `index.md:376` says the phase files mirror "the v1 `docs/plan/` granularity". That is a bare code span, so it is outside this task's link scope — but `docs/plan/` was never tracked, which makes the statement false rather than merely dangling. Left for [P17.06](06-register-and-roadmap.md), which owns roadmap accuracy.
