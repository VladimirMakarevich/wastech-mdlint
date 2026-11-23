# 02 · Change set and text diff in core

> Part of the [viewer review plan](index.md). Status **Implemented** in `packages/core/src/changes/`.

## Goal

From git's list of changed paths and the corpus the viewer already holds, produce the data the review shows: which corpus documents changed and how, whether the config changed, which changed Markdown lies outside the corpus, which linked code lines moved, and a line-and-word diff of each document. Everything here except the one git sequence is a pure function over text and paths, so it is deterministic, testable without git, and independent of the user's diff configuration.

## What was built

1. **Classification — `classifyChanges(changes, corpus)`.** `corpus` is the documents the host loaded, its `ScopeTester` and the config's repository-relative path. Changes split into corpus `documents`, `configChanged`, `outsideCorpus` (changed Markdown the corpus does not hold, as changes with their status) and `otherFiles`, each sorted by path. A deleted or renamed-away document counts when the current scope would hold its path — the current config's view of the base, not the base config's. A rename that crosses the scope's edge becomes an addition or a deletion on the corpus side, with its other half reported where outside changes go. A renamed config is a config change.

2. **One sequence for every host — `collectChangeSet(repository, { base?, worktree, corpus })`.** It resolves the base, finds the merge-base, lists changes and classifies them, returning a `ChangeSet` (the classification plus `base`, `mergeBase`, `head` and `worktree`) or phase 01's `GitUnavailable` unchanged. `mergeBase` and `head` together tell a host when its copy is stale.

3. **Normalization — `normalizeText`.** CRLF and a lone CR become LF and a leading BOM is dropped, before any diff and, in phase 06, any hash. A lone CR counts as a line ending as the Markdown parser counts it, so diff line numbers are the parsed document's.

4. **Line diff without a new dependency.** `sequence-diff.ts` is Myers' algorithm over any sequence with a custom equality, trimming the common start and end first, and treating the middle as wholly replaced past 2000 edits, where the per-edit memory would otherwise grow with the square of the edits. Chosen over the `diff` package because core is published and the review needs equality jsdiff would have to be bent to (a table cell compared without its padding). A test checks the script is minimal on 300 generated cases against a longest-common-subsequence count.

5. **`diffText(base, head, options)`** returns hunks with three lines of context (merged when they touch), every line numbered on the sides it exists on, `added` and `removed` counts, and `newlineAtEndChanged` for the one change no line shows. Removed lines come before added ones in a block, as `git diff` prints them.

6. **Words and cells.** In each change block, removed and added lines are paired by an order-preserving dynamic program that maximizes total similarity, kept only at 0.5 or above; past 400 comparisons a block is paired line by line instead. Paired lines carry `segments`, the changed ones marked. Words are runs of Unicode letters and digits, so Cyrillic works; Markdown markers (`**`, a run of backticks, `](`, `![` and the like) are tokens of their own, so a changed link target highlights only the target. Rows listed by `tableRowLines(document)` — header, delimiter and body rows from the parsed table, not a regex — are compared by cell, with the padding ignored, so a column realigned by a formatter highlights only the cell that changed.

7. **Code lines — `lineCorrespondence(base, head)` and `lineRangeKept(runs, start, end)`.** The runs of unchanged lines, as plain data, and whether a head range still shows what the same base range showed: false when a line in it was edited, or a change above shifted it, true again when changes above cancel out. The host picks which changed files to compute this for (those a document links to); core does not decide what is linked.

## Moved to phase 03

Caching. A change set and the base texts are cached for as long as the viewer process lives, keyed by `mergeBase` and `head`; a one-shot CLI run has nothing to keep. Core supplies what the cache needs — the key and a per-document `diffText` to re-run on a save — and phase 03 owns the cache.

## Tests

`sequence-diff.test.ts` (empty, identical, the textbook example, 300 generated cases against a minimal count, custom equality, the edit limit, determinism); `text-diff.test.ts` (normalization; line endings and a BOM are no change; a Cyrillic word; a link target; a rewritten line left whole; pairing with the most similar of several lines; a realigned table; hunk grouping and numbering; added and deleted files; the final line break; table rows from a parsed document; kept and lost line ranges); `change-set.test.ts` (classification tables, renames across the scope's edge, a renamed config, and `collectChangeSet` on a fixture repository). The git fixture helpers moved to `test/support/git-fixture.ts`, shared with phase 01's tests.

## Done when

- [x] Core exports the change-set classification and collection, text normalization, line and word diff, and the code-range helpers, with explicit types.
- [x] Every diff and classification is covered by unit tests that need no git.
- [ ] A change set is cached and a single save re-diffs one file — in phase 03.
