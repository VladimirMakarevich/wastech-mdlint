# 06 · Review state: reviewed marks, queue, "since my last review"

> Part of the [viewer review plan](index.md).

## Goal

A person marks what they have reviewed. The viewer keeps that per content — across branches, rebases and restarts — shows what is still left and what changed after it was reviewed, and can show the diff since the last review instead of since the base branch.

## Steps

1. **Model.** Per repository, a mark per document path: the hash of the text that was reviewed and a reference to its snapshot. The hash is SHA-256 of phase 02's normalized text, not git's blob id: uncommitted text has no blob, and with `core.autocrlf` the blob and the work-tree file differ. A changed document's status is computed, never stored:
   - **unreviewed** — no mark;
   - **reviewed** — the mark's hash equals the current hash;
   - **changed since review** — a mark exists and the hash differs.

   "Skipped" is not a separate record: it is a document in the change set whose current text carries no mark. Marks are also looked up by hash, so a document renamed without edits stays reviewed, and switching to a branch where a file has the same text finds it reviewed. A deleted document is reviewed once its deletion is marked.

2. **Snapshots.** The diff since the last review needs the reviewed text. Committed text could be fetched from git, but uncommitted text never was stored anywhere, so the store keeps each reviewed text content-addressed under its hash — Markdown is small — and drops snapshots no mark refers to on each write.

3. **Location.** The user's state directory, never the work tree and never `.git`: `%LOCALAPPDATA%\wastech-mdlint\viewer\` on Windows, `~/Library/Application Support/wastech-mdlint/viewer/` on macOS, `$XDG_STATE_HOME/wastech-mdlint/viewer/` or `~/.local/state/wastech-mdlint/viewer/` on Linux; `--state-dir <dir>` overrides it, for tests and portable setups. Inside, one directory per repository, named by a hash of the realpath of the git common directory — every worktree of one clone shares a history, a fresh clone starts empty — with that path written inside for a person looking at the folder. Without git, the realpath of the viewer root is the key.

4. **Writes.** Through core's `writeFileAtomic`, with read-modify-write serialized inside the process and the file re-read before each change, so two viewers on one clone merge their marks rather than the last one overwriting the other's. A failed write is reported to the page and the mark is not shown as set.

5. **Endpoint.** `POST /api/review/mark` with `{ path, hash, reviewed }`:
   - `hash` is the one the page showed; if the file's current hash differs, the request is refused with 409, so a person can only mark the version they actually saw — the rule the config save follows for the version the page edited;
   - guarded like the config requests by `changeRequestProblem`: this server's `Origin`, same-origin fetch metadata, `application/json`, the per-process token and the 256 KiB body limit. The token is carried by the Changes and document pages as well as the config page;
   - refused when `--host` is not a loopback address, since it records one person's review on this machine; on loopback it needs no flag, because it writes nothing in the repository.

   GET never writes. "Opened" — a weaker hint than reviewed — stays in the browser's `localStorage` as a best-effort convenience that may reset on another port, and is not part of the server state.

6. **Interface.**
   - Changes cards: a "Viewed" checkbox that collapses the card once checked, a status chip, and a header count such as "Changes · 5 left of 12".
   - Keys: `v` marks or unmarks the focused card or the open document; `n` and `p` go to the next and previous unreviewed document in reading order — referenced documents before the ones that reference them, by core's `topologicalSort` over the subgraph of changed documents, with cycles broken by path so the order is deterministic.
   - Tree: a dot on changed documents not yet reviewed; the "Changed only" switch gains "Unreviewed only".
   - Document banner: the status and the same checkbox.

7. **Second baseline.** The Changes page and the banner offer "Compare with: base branch / my last review". For a document with a mark the diff runs from its snapshot to the current text; one without a mark falls back to the base branch. Phase 02's diff takes two texts, so nothing here is git-specific.

8. **Clearing.** "Reset review for this change set" unmarks the documents currently listed; removing the repository's folder in the state directory clears everything, and the README says where it is.

## Tests

- Store: CRLF and LF text hash the same; concurrent writes from two store instances merge; unreferenced snapshots removed; a rename with identical text stays reviewed; a mark made on one branch holds on another with the same text.
- Write failure, tagged `@boundary-guard write-failure`: with the state directory made unwritable, a mark leaves no temporary file and no half-written state, the request reports the failure, and the page does not show the mark as set.
- Endpoint: a foreign `Origin`, a missing token, a wrong content type and a non-loopback `--host` are refused; a stale hash gets 409; a plain GET changes nothing in the store.
- Interface: the reading order with a cycle; the diff since the last review uses the snapshot.

## Docs

`packages/viewer/README.md`: What it shows (Viewed, the statuses, the keys, the two baselines), Run it (`--state-dir`), Security (the viewer now writes outside the repository — what, where, under which guards — and still writes nothing inside it without `--allow-config-writes`), Known limits. Draft the changes to `.agents/rules/security.md` (Viewer Safety: the mark request joins the list of requests with a body; the state directory) and `.agents/rules/testing.md` (the new guard in the write-failure row) and discuss them with the user before merging.

## Done when

- [ ] Marks follow content across branches, rebases, renames and restarts, stored outside the work tree.
- [ ] The tree, the header and each card show what is left and what changed since review; `v`, `n` and `p` work.
- [ ] The diff since the last review is one click away.
- [ ] The mark endpoint is guarded like the config save, and its write path has a write-failure guard.
