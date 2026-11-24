# 06 · Review state: reviewed marks, queue, "since my last review"

> Part of the [viewer review plan](index.md). Status **Implemented**, pending the rules discussion below.

## Goal

A person marks what they have reviewed. The viewer keeps that per content — across branches, rebases and restarts — shows what is still left and what changed after it was reviewed, and can show the diff since the last review instead of since the base branch.

## Decisions taken before building

Agreed with the user:

- **Store.** One folder per clone in the user's state directory — `%LOCALAPPDATA%\wastech-mdlint\viewer\`, `~/Library/Application Support/wastech-mdlint/viewer/`, `$XDG_STATE_HOME/wastech-mdlint/viewer/` (a relative value ignored) or `~/.local/state/wastech-mdlint/viewer/`; `--state-dir` overrides it. The folder is `<clone name>-<16 hex of sha256(realpath of the git common dir)>`, created owner-only (`0700`) with the first mark. Inside: `review.json` (format 1, the common dir for a person reading it, per path the hashes of its reviewed texts newest first), `texts/<sha256>.md` and, only while writing, `review.lock`.
- **History per path**, ten versions, so a branch whose text was reviewed before finds it reviewed although another version was reviewed in between. No timestamps are stored.
- **No flag on loopback; off entirely with another `--host`** — no box, no status, the request refused (403) — since a mark records this user's review on this machine.
- **Concurrency.** Writes in one process are queued; across processes a lock file created with `wx` is held for the read-modify-write; a lock older than 10 s is taken over, a fresh one waited for up to 3 s, then 503.
- **Failure.** A failed write answers 500 and removes the text it had just added; an index that does not parse or carries a newer format is refused (409) and left as it is. GET creates nothing.
- **`n` and `p` follow the Changes page's order**, not a topological sort: `topologicalSort` emits a node after the nodes linking to it — the opposite of what the plan asked — and leaves cycle members out, and a second order would make "next" jump around the page.
- **No store without git**, since there is no Changes section to mark from. **"Opened" in `localStorage`** was not built.

## What was built

1. **Core.** `GitRepository.topLevelPath(relPath)`, so marks are keyed from the work tree's top level and two viewers started in different folders of one clone share them.
2. **Store.** `packages/viewer/src/review-store.ts`: `contentHash` (SHA-256 of `normalizeText`), `ReviewMarks.status` (reviewed when the hash is marked under the path, the rename's old path or any path — the empty text of a deletion only under its own path; changed since review with the newest version as `since`; unreviewed), `ReviewStore` (`read`, `snapshot`, `update` with `mark`, `unmark` — removing the text under every path — and `reset` — forgetting every version of the listed paths), `cloneFolder`. `state-dir.ts` picks the default folder per platform.
3. **Glue.** `review-state.ts`: statuses for a review (`markReview`, `markOf`), `SinceReview` (a document's review restated against a reviewed text, cached per review and version, so the rendered marks, the Source view and the cards reuse phase 04's code), request parsing, the chip and the hidden "Viewed" checkbox.
4. **Endpoints.** `POST /api/review/mark` `{ path, hash, reviewed, worktree }` and `POST /api/review/reset` `{ worktree, documents: [{ path, hash }] }`, both in `CHANGE_ROUTES`. The text marked is the review's own for that comparison, never the request's, and only when its hash is the one sent; otherwise 409. A saved mark is broadcast as a `review` event. `/api/changes` gives each document `review: { status, hash }` and a top-level `review` (`left`, `total`, or why marks cannot be read); `/api/changes/diff?…&since=review` the diff since the review.
5. **Pages.** The token is on the Changes page and a changed document's page when marks are on. Changes: "Compare with: Base branch / My last review" (`?since=review`, kept by every link), "N of M documents reviewed" with **Reset review**, a chip and `data-review` on every row and card, a "Viewed" box per card, a reviewed card folded to its header. Banner: chip, box, and the compare switch where an earlier version was reviewed; with `since=review` all three views show the changes since the review, or "Unchanged since your review".
6. **Script.** `client/review.ts` sends a mark and shows only what the server answered, keeps the count, folds the card, says why a mark failed; `v`, `n`, `p`. `client/changes.ts`: the header count becomes `left/total`, a dot beside each file left (amber when changed since review), and an "Only files left to review" switch drawn when marks are on.

## Where it differs from the plan

- **The config card has no "Viewed" box**: marks are for documents, and the queue counts documents.
- **Requests carry `worktree`**, because Commits only shows a different text than the work tree; **reset is its own route** and names the documents the page listed, each checked like a mark.
- **A reviewed document compared with its last review** shows that nothing changed, rather than falling back to the base branch; a card or page that falls back says so.
- **Card sizes and findings stay against the base branch** with My last review; the README says so.
- **The interface test of a reading order with a cycle was dropped** with the topological order. The keys and the checkbox were checked by hand in the browser; the HTML they act on is pinned by the HTTP tests.

## Tests

- `review-store.test.ts`: CRLF, LF and BOM hash the same; default folder per platform, relative XDG ignored; folder names; reading creates nothing; reviewed, changed and unreviewed; rename and any-path lookup; a deletion counted for its own path; earlier versions kept, ten at most; sorted, top-level keys; unmark under every path and unreferenced texts dropped; reset; concurrent marks from two stores merge; a stale lock taken over; a held lock answered as busy; an unreadable or newer index refused and untouched; `@boundary-guard write-failure` on POSIX (a read-only folder: failure reported, earlier marks whole, no temp file or lock).
- `review.test.ts` (git fixture): boxes and token where marks are on and none on an unchanged page; GETs leave the state directory empty; the count before marking; a mark, then the page's rows read back from `data-review` against `/api/changes` (`@boundary-guard host-parity`), the folded card, unmark; a stale hash and a path outside the review get 409, a malformed body 400; foreign `Origin`, missing token, `text/plain`, cross-site fetch metadata refused, GET 405; marks survive a restart and the diff, page and cards since the review; a mark holds on another branch and after a move; reset; `@boundary-guard write-failure` everywhere (a file in the state directory's place: 500, nothing written, nothing shown as marked); no marks outside a work tree. `--state-dir` parsing.
- Core: `topLevelPath` and one `commonDir` for two roots of one clone. `changes.test.ts`: the parity list reads rows that now carry `data-review`. The guard inventory lists both new files.

## Still open

Before this merges, agree with the user on the drafted changes to `.agents/rules/`, together with phases 03–05:

- `security.md`, Viewer Safety — the read-only bullet gains the review mark (refused with a non-loopback `--host`, which could otherwise record a review as this user); the token is carried by the config, Changes and changed documents' pages; a new bullet: marks are the viewer's one write outside the repository — per clone, keyed by a hash of the git common directory's realpath, an index of paths and content hashes plus the reviewed texts, owner-only, in the user's state directory or `--state-dir`; a mark names the text the page showed (409 otherwise), is written atomically under a lock every viewer of the clone shares, a failed write is reported with the previous state whole, and `GET` creates nothing there.
- `testing.md` — the guard table lists `packages/viewer/test/review.test.ts` under `host-parity` and `write-failure`, and `packages/viewer/test/review-store.test.ts` under `write-failure`.
- `architecture.md`, optional — the viewer's review marks and their store are its own, statuses computed from core's `normalizeText`, the diff since a review from core's `diffText`.

`CLAUDE.md` eager context is at 9994 of 10 000 tokens (LLM-001), so any of these drafts needs a rules file compressed or split first, which is the user's decision.

## Done when

- [x] Marks follow content across branches, rebases, renames and restarts, stored outside the work tree.
- [x] The tree, the header and each card show what is left and what changed since review; `v`, `n` and `p` work.
- [x] The diff since the last review is one click away.
- [x] The mark endpoint is guarded like the config save, and its write path has a write-failure guard.
- [ ] The rules changes are agreed with the user.
