# P14.03 · `init` disclosure and the hidden-directory default

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-14](../remediation-backlog-2026-08-05.md) (High), [W-15](../remediation-backlog-2026-08-05.md) (Medium, **decision**). Sources: field F-11 (major) — split into its two separable halves. Depends on [P13.02](../P13-correctness/02-default-exclude.md).

## Goal

Make `init` tell the user what its excludes dropped, and decide whether one of those excludes belongs in a lint-time config at all. The disclosure half is a defect; the default half is a decision. They ship together because the disclosure is what makes the default survivable either way.

## Problem

**W-14 — `init` never discloses what its hidden-directory exclude drops.** Measured on a real monorepo: `init --yes` printed 5 include patterns and 11 exclude globs, then left the corpus at **139 files where `git ls-files` tracks 202**. The 63-file gap is entirely `"**/.*/**"`: `.claude/` (28), `.agents/` (23), `backend/.rules/` (6), `mobile/.rules/` (6). `comm` against `git ls-files` showed nothing else missing and nothing extra — so the number is fully accounted for, and nothing said so. A user reads the include list, sees `docs/`, `backend/`, `mobile/`, `tasks/`, and has no reason to suspect `.claude/` was considered and dropped.

**The information is demonstrably available at write time.** `graph`'s own `coverage.filesOutsideCorpus` already lists 12 of these files as linked-but-outside-the-corpus — the field test called it the single best diagnostic in the graph report, and it is exactly this task's evidence.

**W-15 — is the lint-time exclude the right default?** The rationale in `discovery/repo-scan-constants.ts` is sound for the **scan**: `.github`, `.venv`, `.husky` hold tooling Markdown that would pollute cluster inference, and hidden directories are pruned by shape because a name list can never enumerate them (recorded as audit L-7). But that pruning decision is then written out as a permanent **lint-time** exclude (`HIDDEN_DIR_EXCLUDE_GLOB` in [`packages/core/src/config/corpus-scope.ts`](../../../packages/core/src/config/corpus-scope.ts), moved there from `discovery/config-writer.ts` by [P13.02](../P13-correctness/02-default-exclude.md)), and those are different questions. P13.02 widened the question rather than answering it: the same glob is now the default for **every** run, so the dot-directory Markdown is outside the corpus with no config at all, not only after `init`.

Why it matters for this product specifically: in the field-test target the dot-directories hold `.claude/skills/`, `.agents/rules/`, and two `.rules/` sets — 31% of the tracked corpus, and precisely the LLM-facing documentation this tool exists to lint. **This repository has the same shape.**

## Deliverables / steps

1. **W-14 — report the count and the reason** in `init`'s summary, e.g. "63 Markdown files were excluded because they live in hidden directories." Derive it from the scan rather than re-walking: the scan already knows what it pruned and why, and a second walk is a second thing to disagree with the first. This makes the default self-correcting even if W-15 keeps it.
2. **W-14 — disclose per reason, not as one total.** The 11 written excludes are not one class: `**/node_modules/**` dropping vendored Markdown is unsurprising, `**/.*/**` dropping `.claude/skills/` is the finding. A single "N files excluded" number invites the user to ignore it.
3. **W-15 — decide, and record the decision either way.**
   - **(A) Separate the two questions:** keep the hidden-directory prune in the scan (where its rationale holds) and stop writing it as a lint-time exclude, or write it narrowed to the tooling directories that motivated it.
   - **(B) Keep the exclude** and record it in [`accepted-behaviors.md`](../accepted-behaviors.md), with W-14's disclosure requirement as its stated condition and a guide home that says so.
   - Direction (A) changes what `init` writes for every repository; direction (B) does not. Both are defensible, and the register exists for exactly this.
4. **Interaction with [P13.02](../P13-correctness/02-default-exclude.md):** that task shipped the lint-time defaults, and it decided **extend** — a user `exclude` is appended to the default list and deduped, so `init`'s written excludes do not shadow anything and nothing needs reconciling. What follows is this task's to settle: `init` may stop writing the entries the default already covers (the whole list, today), which turns that block from _establishing_ the exclusions into _disclosing_ them — exactly deliverable 2's distinction.
5. **Test:** `init --yes` on a fixture with Markdown in a dot-directory must name the excluded count in its summary. This is the second of the two fixtures [P16.01](../P16-release-readiness/01-test-debt.md) enumerates — build it here and let that task assert the corpus comparison against a tracked-file list in both directions.
6. **Glossary.** The `init` and `generateInitConfig` entries describe the written excludes in detail; whichever direction W-15 takes, they must end up describing it.

## Out of scope

Widening what `init` infers (that is W-39, in [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)). Changing the scan's own pruning rationale — it is sound and audit L-7 recorded why a name list cannot replace it.

## Exit criteria

- [x] `init --yes` on a repository with Markdown in a dot-directory names the excluded count **and the reason** in its summary.
- [x] The disclosure distinguishes classes of exclusion rather than printing one total.
- [x] W-15 is resolved either in code or as a row in [`accepted-behaviors.md`](../accepted-behaviors.md) with a guide home that states the behavior.
- [x] The relationship between `init`'s written `exclude` and P13.02's lint-time default is stated (replace or extend), and the two do not silently duplicate each other.
- [x] The glossary's `init` / `generateInitConfig` entries describe the shipped behavior.
- [x] Gates green.

## Implementation notes

**W-15 → direction (A), narrowed.** The shape-based hidden-directory prune stays in the _scan_, where audit L-7's rationale holds; it is gone from the _lint corpus_. `HIDDEN_DIR_EXCLUDE_GLOB` (`"**/.*/**"`) is deleted from `config/corpus-scope.ts`, and `DEFAULT_EXCLUDE_GLOBS` is now derived from `DEFAULT_NOISE_DIR_NAMES` alone — which gained `.venv` and `.yarn`, taking the default from 11 globs to 12.

Three reasons, and they are recorded next to the constants rather than only here:

- **The two questions have inverted failure modes.** Over-pruning the scan is cheap — an unproposed cluster is one `include` edit away. Over-excluding the lint corpus is silent under-reporting: exit `0`, a plausible file count, and the documents most likely to matter never read. L-7's "a name list can never enumerate them" is an argument about _cluster inference_ and does not transfer.
- **The motivating names are not uniformly junk.** `.github/PULL_REQUEST_TEMPLATE.md` and `.changeset/*.md` are hand-written. What belongs in a lint-time default is the dependency and build trees that _happen_ to be hidden. That yields a stateable rule for future additions, now written at `DEFAULT_NOISE_DIR_NAMES`: **a hidden directory earns a place only when it is a dependency or build tree, never merely for being hidden.**
- **Measured.** 31% of the field-test target's tracked corpus, and this repository has the same shape (`.agents/rules/`, `.claude/`).

`classifyPrunedDirName` (noise checked first, then the dot prefix) is what keeps the two classes apart, and `isPrunedDirName` is redefined in terms of it so the predicate and the classification cannot disagree.

**Deliverable 4 — extend, and `init` keeps writing the list.** P13.02 decided _extend_, so nothing needs reconciling: an `init`-written `exclude` is deduped back to exactly the default by `resolveCorpusScope`. `init` could therefore omit the whole block — and deliberately does not. Extend is precisely what makes _deleting_ one of those lines a no-op, and a bare list of twelve globs invites that dead edit; the key also has to exist for a user to write a negation into. So the duplication stays and is made explicit instead: `generateInitConfig` now emits `//` lines above the key (`leadingComments`) saying the list is the tool's own default, that a user entry extends rather than replaces it, that deleting a line changes nothing, and that `"!**/vendor/**"` is the move that works. That is what "the two do not silently duplicate each other" means here.

**W-14 — the disclosure is derived from the scan's own record.** `scanRepository` returns `pruned: ScanPruning` — a sorted list of `{ path, reason, markdownFileCount? }`. The count comes from the corpus walk re-entered in a `"count"` mode under each pruned hidden root, not from a second traversal, so it applies the same noise names, gitignore layers and `MARKDOWN_EXTENSIONS` the corpus does, by construction. The CLI renders it with `formatScanExclusions`, one line per reason, in the fresh-write branch of `formatDraftSummary` after the `Include (…)` block (never on `merge`, which leaves scope untouched).

**The counting asymmetry is deliberate.** Only the hidden class carries a file count: it is the one whose contents a user plausibly wants linted, and the only one cheap to size. Noise and gitignored lines say "contents not counted" out loud rather than implying a zero — `init` does not walk a dependency tree to count what it is skipping. That bound holds only because `.venv`/`.yarn` are classified _noise_; a later change that moved them would put the count walk inside a virtualenv, which is why the constraint is stated at the classifier. It is also a bound by **name**, so it is incomplete by construction: an unlisted hidden cache (`.tox`, `.gradle`, `.terraform`, …) is still walked to size it, and that residual cost is a row in the register rather than an unstated one — bounding it by _shape_ instead would report a `.claude/skills/` as `0 Markdown files`, which is worse than a slow `init`.

**The suggested `include` pattern splices `MARKDOWN_GLOB_SUFFIX`**, now re-exported from `@wastech-mdlint/core` for the host. The count beside it is produced with `MARKDOWN_EXTENSIONS` (`.md` + `.mdx`), so a hardcoded `.md` tail would advertise a pattern that lints fewer files than the number in the same sentence — the invariant `discovery/markdown-extensions.ts` states for every other `init` proposal.

**Audit L-7 stays fixed, with one narrow residual.** L-7's defect was `init` _proposing_ `.github` and the written config then linting it. After (A) the scan still prunes it and `include` still does not cover it, so an init-written config still does not lint it. The residual: when the scan finds no cluster at all, `include` is omitted and the `**/*.md` default now reaches dot-directories. That needs a repository whose _only_ Markdown lives in dot-directories (any Markdown elsewhere produces at least the `fallback` cluster) — the agent-config repository shape this task is about, so the disclosure branches on it rather than asserting one answer: `formatScanExclusions` takes the draft's include disposition and, in the omitted case, says the default stays in force and those files _are_ linted. The unconditional "add a pattern to lint it" wording would have contradicted the `Include (…)` line two lines above it in the same output.

**Recorded in [`accepted-behaviors.md`](../accepted-behaviors.md):** the scan still prunes hidden directories by shape, so `init` never proposes one (widening inference is W-39/[P16.05](../P16-release-readiness/05-low-severity-cleanups.md), and disclosure is the answer meanwhile); and `compile`'s own `.claude/skills/…/SKILL.md` output re-enters a zero-config corpus, reversing a benign side effect P13.02 noted. A third row records the count walk's cost: `init` now traverses every pruned hidden tree to size it, and `DEFAULT_NOISE_DIR_NAMES` bounds that by name only.

**Fixture for [P16.01](../P16-release-readiness/01-test-debt.md) §2.** `DOT_DIRECTORY_FIXTURE` and its companion `DOT_DIRECTORY_TRACKED_MARKDOWN` are **exported** module-level consts in `packages/cli/test/init.e2e.test.ts`, so that task's both-directions corpus comparison is a set diff over an imported fixture rather than a second dot-directory repository. The fixture gitignores `node_modules/` as a real repository would, which is what makes the companion list a faithful `git ls-files` oracle rather than "tracked minus whatever the test chose to drop". Its tests already pin the `comm` arithmetic (corpus + disclosed hidden = tracked) with the disclosed number read out of the summary rather than restated.
