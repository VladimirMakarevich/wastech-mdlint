# 03 · Changes page in the viewer

> Part of the [viewer review plan](index.md).

## Goal

A fourth section, **Changes**, where a person reviews only the documents that changed, the most influential first, as a stream of word-highlighted diffs — and sees that something changed outside the corpus too, instead of never learning about it.

## Steps

1. **Startup and options.** The viewer opens the repository through phase 01 when it loads the corpus and keeps a `GitUnavailable` reason for the page. `cli-args.ts` gains `--base <ref>`; an invalid ref is reported at startup with the hint, not as a crash, and the viewer still starts.

2. **Header.** `page.ts` adds a `changes` section beside Graph, Dashboard and Config, with the number of changed documents. The segment is drawn whenever the viewer root is inside a git work tree; outside one it is absent, since there is nothing to review.

3. **The page.** `/changes` is rendered on the server, so it works without script, like the dashboard:
   - a summary — base ref and short merge-base, head (work tree or `HEAD`), documents changed, lines added and removed, whether the config changed, and "N Markdown files changed outside the corpus" as a `<details>` list;
   - a list of the changed files that jumps to their cards;
   - one card per document in influence order: status (with the old path of a rename), the path linking to the document page, lines added and removed, and the source diff with word highlights. Per-line Markdown highlighting with Shiki under the word marks is the aim; if layering the two proves fragile, plain text with word marks ships first;
   - a deleted document's card shows its removed text, with no page to link to;
   - a card whose diff exceeds a line limit is collapsed and loads its diff from `/api/changes/diff?path=…` when opened, so a branch with fifty changed documents still paints at once.

4. **Ordering by influence.** A core function orders the change set, since a CLI `--since` would need the same order. Tiers, each sorted within itself by the next: the config file; eager agent context — the LLM-001 entrypoints when that rule is configured, plus their closure over the graph's `import` edges through `query` with `direction: "forward"`, so a rules file that `CLAUDE.md` imports sorts above a guide page; then the number of documents that reach the document (`impact` on the head graph, on the base graph for a deleted one), descending; then the path. Phase 05 inserts "has new errors" after the eager-context tier.

5. **Committed only.** An "Include uncommitted" switch, on by default; off, `?worktree=0` limits the set to `merge-base..HEAD`, and the right side of each diff is the `HEAD` text.

6. **JSON.** `/api/changes` returns the ordered `ChangeSet` with each document's diff summary — the data the page renders, as `/api/dashboard` does for the dashboard. `/api/changes/diff?path=…` returns one document's `TextDiff`. A `path` is only compared with the change set's own paths and never joined onto a filesystem path, the rule the graph's `folder` and `focus` already follow; anything else is a 404.

7. **Tree.** A "Changed only" switch above the document tree beside the findings-only switch, and a status letter (A, M or R) on each changed file.

8. **Banner on a changed document.** Above the article: "Changed in this branch · +12 −3 · View diff", linking to its card. Phase 04 adds the rendered markers and the mode switch to this banner.

9. **Freshness.** A save already reaches `Corpus.applyChanges`; that file is re-diffed against its cached base text and the update goes out through the existing live-reload channel. A moved `HEAD` or base — a commit, a checkout, a fetch — is noticed lazily: each `/changes` request and each corpus change batch compares `rev-parse HEAD <base>`, a few milliseconds, against the cached pair and recomputes when either moved. Watching `.git` is deliberately not done here: the watcher skips `.git` so a `git gc` or a fetch never wakes the corpus, and a worktree's git directory lies outside the work tree.

10. **Unavailable states.** The Changes page shows the reason and the hint: a shallow clone names the fetch command, no base names `--base`, an old git names the version found.

## Tests

- Over temporary git fixtures: the segment present inside a work tree and absent outside; ordering — config first, eager context next (a file reached only through an `@` import of an entrypoint), impact count, then path; the outside-corpus count and list; `?worktree=0`; a deleted and a renamed document; an unknown `path` is a 404.
- Host parity: the rows of the HTML page, parsed back, equal `/api/changes` — two formulations, not the renderer's own helper.
- Without script, the page carries every diff it shows.
- `bin.e2e.test.ts`: `--base` accepted; an invalid ref prints the hint and the viewer still serves.

## Docs

`packages/viewer/README.md`: Run it (`--base`); What it shows (Changes, the tree switch and letters, the banner); Security (the viewer runs `git` read-only with the options that keep repository config from starting programs); Known limits (large diffs collapsed; a moved `HEAD` is picked up on the next request). Bring the drafted `.agents/rules/` changes from phase 01, plus the viewer bullet of `architecture.md` (its change set comes from core), to the user before merging.

## Done when

- [ ] Changes lists only corpus documents changed against the merge-base, ordered by influence, with the outside-corpus count.
- [ ] Every card shows a word-highlighted source diff; large ones load on demand.
- [ ] The page works without script, the JSON matches it, and the tree and the banner lead to it.
- [ ] A save, a commit and a checkout are reflected without restarting the viewer.
- [ ] Unavailable states explain themselves and leave every other page working.
