# 07 · Deferred ideas, built

> Part of the [viewer review plan](index.md). Status **Implemented**, pending the rules discussion and the [follow-ups](follow-ups.md).

## Goal

The ideas from the same discussion that phases 01–06 left out. The plan first meant each to wait until 01–06 had been used and become its own plan; the user asked for all of them after 06, with every blocking point recorded in [follow-ups](follow-ups.md) rather than stopping on it.

| Idea | What it needed |
| --- | --- |
| Per-section marks: a section stays reviewed while its own text is unchanged, even when another section of the same document moved on | A stable section identity across heading renames, and a decision on whether renaming a heading resets its section's mark |
| File history on the banner: the commits that last touched the document and when | `git log --follow -z` through core's git module; commit dates are deterministic for a given repository state. Author names are personal data, so shown only on a loopback binding, as absolute paths are |
| Blame in the margin: the commit that last touched each block | `git blame --porcelain` mapped onto the block ranges from phase 04, sharing the right margin with the source line numbers |
| `--since <ref>` for the CLI's `lint` and `impact` and as an option of the existing MCP tools | Phases 01, 02 and 05 from core; a host-parity guard for the new option. No new MCP tool, so the six read-only tools stay six |
| Refreshing open Changes pages the moment `HEAD` moves, without waiting for a request | A watcher on the git common directory and the worktree's own git directory, limited to `HEAD` and refs, kept apart from the corpus watcher |
| Expanding context in a diff ("show 20 more lines") and showing a moved paragraph as a move rather than a deletion plus an addition | Phase 02's hunks carrying their surrounding lines; a moved-block pass over matched removals and additions |

## What was built

1. **Core owns the branch review.** `reviewBranch`, `branchContext` and `analyzeSince` (`packages/core/src/changes/branch-review.ts`) are what the viewer's `ChangeTracker.compute` and `review-context.ts` did; the viewer now calls them, `review-context.ts` is gone, and the CLI and MCP reuse them. `since-report.ts` builds the "since" answers (`sinceLintResult`, `sinceImpact`, `renderSinceHeader`); `classifyChangeImpact` merges one `impact` walk per changed file.
2. **`--since`.** `lint --since <ref>` reports and gates on the findings the work tree adds since the merge-base with `<ref>`, with a header line and a `since` object (`ref`, `base`, `mergeBase`, `head`, `changed`, `removed`); `--fix` with it exits 2. `impact --since <ref>` takes the place of `<file>`: `files` instead of `file`, plus `since`. MCP `lint-files` and `impact-analysis` take `since` and return the same; `impact-analysis` needs exactly one of `file` and `since`. Nothing to compare (no git, not a work tree, a ref that names nothing) exits 2 / answers `INVALID_INPUT` with git's remedy. Guide pages `cli.md`, `mcp-server.md`, `output.md` and the generated MCP inventory updated.
3. **Ref watcher.** `GitRepository.gitDir` beside `commonDir`; `watchGitRefs` watches `HEAD` in the work tree's git directory, `HEAD` and `packed-refs` in the common one and `refs/` recursively, lock files ignored. On a burst the server rebuilds the work-tree review and broadcasts `git` only when it is a new review; the Changes page, a changed document's page and a graph or dashboard showing the branch reload, the header count and tree refresh.
4. **History.** `GitRepository.fileHistory` (`log --follow -z`, dates as UTC `YYYY-MM-DD`, `--no-show-signature`, and `log.showSignature=false` for every git call so no gpg runs); `/api/history?path=` (corpus documents only, author on loopback only); a **History** disclosure in the banner, loaded by `client/history.ts` when opened.
5. **Blame.** `GitRepository.blame` (`blame --porcelain --no-textconv`) and `parseBlamePorcelain`; `renderDocument` takes a `LineAnnotator` that sets `data-blame` and `title` on every element with source lines; `blame.ts` picks the newest line of each block (`uncommitted` first). `?blame=1` from a **Blame** link in the header, on every document page in a git work tree; skipped when the file on disk is not the text the corpus holds.
6. **Diff.** `diffText` marks moves (`movedTo`, `movedFrom`); `contextGaps` lists the unchanged lines between hunks. `renderDiff(diff, headText)` puts them in hidden `tbody.diff-gap` rows behind a button `client/diff-expand.ts` shows (twenty at a time, nearest the change first) and tints moved lines with where they went.
7. **Section marks.** Core's `documentSections` cuts a document at its `h2`/`h3` headings plus the text before the first, keyed by slug, each its own text without trailing blank lines. The store's index is format 2 (`sections` per path and key, ten versions each; format 1 still read). Marking a document records its sections; `POST /api/review/section` marks one; a document whose sections are all reviewed counts as reviewed. The outline draws each section's box and state.

## Where it differs from the plan

- **Renaming a heading resets its section's mark**, the decision the plan left open (follow-up 9). The text before the first section has no outline entry (follow-up 16).
- **Blame lives in the header and the address**, not in the banner, so it works on unchanged documents too; **history only in the banner** of changed documents (follow-ups 11, 12).
- **Context opens only with script**; without it a diff reads as before.
- **`impact --since` leaves deleted documents out of `files`** (follow-up 5).

## Tests

- Core: `since-report.test.ts` (`classifyChangeImpact`; findings added and removed since a ref; impact; a ref that names nothing), `git-history.test.ts` (`parseBlamePorcelain`; history across a rename; blame of an uncommitted line), `diff-moves-gaps.test.ts`, `sections.test.ts`, `git-repository.test.ts` (`topLevelPath`, `gitDir` of an added worktree, `log.showSignature` in the environment).
- CLI `since.e2e.test.ts` (spawned with the fixture's git environment): text, JSON and exit codes; nothing to compare exits 2; `--fix` refused; `impact --since`, neither or both refused.
- MCP: `host-parity.test.ts` gains a `since` block — CLI and MCP text byte for byte, findings, `since` and the impact record (`@boundary-guard host-parity`, already in the inventory); `impact-analysis.test.ts` refuses neither/both and answers outside a work tree with git's reason.
- Viewer: `git-watch.test.ts` (`isRefChange`; a commit sends `git`, another branch's ref does not), `history-blame.test.ts`, `render-diff.test.ts`, `review-store.test.ts` (format 1 read; sections kept and counted), `review.test.ts` (section marks from the outline; the stale section hash; responses carry sections).

## Still open

Before this merges, agree with the user on the drafted changes to `.agents/rules/`, together with phases 03–06:

- `security.md` — the CLI and the MCP server now run read-only git for `--since` / `since`, through core's runner; `log` and `blame` run with signature checks off; the viewer reads `HEAD` and refs through a watcher on the git directories; author names are shown only on a loopback binding.
- `architecture.md` — core owns the branch review (`reviewBranch`, `branchContext`, `analyzeSince`, `sinceLintResult`, `sinceImpact`) for all three hosts, and `documentSections`, `contextGaps` and the moves for the viewer.
- `testing.md` — `packages/cli/test/since.e2e.test.ts` and the viewer's new suites are not process-boundary guards; the `since` parity lives in `packages/mcp-server/test/host-parity.test.ts`, already in the table.

Everything else that waits on the user is in [follow-ups](follow-ups.md).

## Done when

- [x] Sections, history, blame, `--since`, the ref watcher, context and moves work and are tested.
- [x] User documentation updated in the same change: the viewer README and the CLI, MCP and output guides.
- [ ] The rules changes and the follow-ups are settled with the user.
