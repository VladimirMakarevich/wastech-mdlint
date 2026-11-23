# 03 · Changes page in the viewer

> Part of the [viewer review plan](index.md). Status **Implemented**, pending the rules discussion below.

## Goal

A fourth section, **Changes**, where a person reviews only the documents that changed, the most influential first, as a stream of word-highlighted diffs — and sees that something changed outside the corpus too, instead of never learning about it.

## What was built

1. **Startup.** `ChangeTracker.open` (`packages/viewer/src/changes.ts`) opens the repository through core. Outside a work tree or without `git` there is no tracker and no section; a repository git refuses (too old, another owner) gets a tracker whose page says why. The first review is computed at startup, so a `--base` that names nothing is printed to stderr there (`RunningViewer.notices`) and the viewer still serves. `cli-args.ts` gained `--base <ref>`; `ViewerOptions.gitEnv` lets a test isolate git from the machine's config.

2. **Header and tree.** `page.ts` draws a `changes` section between Dashboard and Config, and a hidden "Only changed files" switch above the tree, whenever a tracker exists — identically on every page, so the header stays put. The findings switch's classes became `tree-filter-findings`, and `tree-state.ts` shows every switch before the first paint and keeps folders either switch opened out of the saved state.

3. **The page.** `/changes`, rendered on the server: Work tree / Commits only as segmented links (`?worktree=0`), a summary (count, +/−, base ref and short merge-base), a folded list of Markdown changed outside the corpus, the ordered list of documents linking to their cards, then a card per file — the config first when it changed, then each document with its letter, a link to its page (none for a deleted one), _every session_ for eager context, and its diff as a table of line numbers, markers and lines, with changed words or cells as `del` and `ins`.

4. **Order.** Core's `rankByInfluence` with `eagerContextPaths` (`packages/core/src/changes/influence.ts`): eager context, then reach through `impact` on the current graph, then path. A deleted document has reach 0, since the current graph no longer holds it; phase 05's base graph can do better.

5. **JSON.** `/api/changes` lists what the page lists, each document with its card's `anchor`, so a script never derives the id itself; `/api/changes/diff?path=…` gives one document's or the config's `TextDiff`, a path compared only with the review's own.

6. **Cache and freshness.** The tracker keeps one review per mode. The corpus watcher's every batch clears it — a Markdown file outside the corpus or a save back to the committed text changes the review too — and every request asks git, in one process (`GitRepository.revisionKey`, added to core), whether `HEAD` or the base moved, which a commit, `reset --soft` or a fetch does without touching the work tree. A review that could not be made (no base) is retried on each request.

7. **Script.** `client/changes.ts` fetches `/api/changes` and adds the header count, the tree letters and switch, and on a changed document a line above its text — "Modified in this branch · +2 −1 · View diff" — linking to its card. It refreshes on every change event.

## Where it differs from the first plan

- **The count, tree letters and document line are drawn by script**, not on the server. Every page shows them, and none should wait for git on its way to the reader; the findings counts already load the same way. The Changes page itself needs no script.
- **A long diff is folded in the page** (over 300 lines) rather than loaded on demand: one renderer, the server's, instead of a second one in the browser that could disagree with it.
- **Diff lines are plain text with word marks**, without Shiki's Markdown highlighting under them; layering the two adds little to a diff of prose.
- **No separate re-classification on save.** The watcher's batch clears the review, and the next request rebuilds it — a few git processes and the diffs of the changed documents, well under a second on this repository.

## Tests

`packages/viewer/test/changes.test.ts`, on a feature branch built in a temporary repository: the header on every page, the hidden switch, the order (eager, reach, path) and the page's list read back from its HTML against `/api/changes` (`@boundary-guard host-parity`), the config card first and the outside-corpus count, the changed word and the changed cell with the text escaped, links for live documents and none for a deleted one, one diff by path and 404 for anything else, commits only, a new commit noticed with the work tree unchanged, a base that names nothing (startup notice, page, API), and the built bin printing that notice and still serving (`@boundary-guard installed-bin-spawn`). Both tags are in core's guard inventory. `server.test.ts` checks there is no section outside a work tree. Core: `influence.test.ts` (eager closure, rule off, ranking, `revisionKey`). Checked by hand on this repository in the browser, in both themes.

## Still open

Before this merges, agree with the user on the drafted changes to `.agents/rules/`: `security.md` (core runs read-only `git` under the settings phase 01 describes; the viewer's Changes section uses it), `architecture.md` (the viewer's change set and order come from core) and `testing.md` (the guard table names `packages/viewer/test/changes.test.ts` under `installed-bin-spawn` and `host-parity`).

## Done when

- [x] Changes lists only corpus documents changed against the merge-base, ordered by influence, with the outside-corpus count.
- [x] Every card shows a word-highlighted source diff; large ones start folded.
- [x] The page works without script, the JSON matches it, and the tree and the banner lead to it.
- [x] A save, a commit and a checkout are reflected without restarting the viewer.
- [x] Unavailable states explain themselves and leave every other page working.
- [ ] The rules changes are agreed with the user.
