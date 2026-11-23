# 02 · Change set and text diff in core

> Part of the [viewer review plan](index.md).

## Goal

From git's list of changed paths and the corpus the viewer already holds, produce the data the review shows: which corpus documents changed and how, whether the config changed, which changed Markdown lies outside the corpus, which linked code lines moved, and a line-and-word diff of each document. Everything here is a pure function over text and paths, so it is deterministic, testable without git, and independent of the user's diff configuration.

## Steps

1. **Classify changed paths against the corpus.** Given the head corpus (`loadContext`'s documents and graph) and its scope (`resolveCorpusScope`), split the changed paths into:
   - corpus documents — added, modified, deleted or renamed (old and new path both kept). A deleted document is in the change set when its path matches the head scope's globs, since it no longer exists to be loaded; a rename that crosses the scope boundary is an add or a delete on the corpus side;
   - the config file `wastech-mdlint.config.json`, as its own entry, since it changes what the corpus is;
   - Markdown outside the corpus (`isMarkdownFile`), as a count and a list, so a narrowed scope never reads as "no changes";
   - every other changed file, kept for step 6.

2. **Normalize text.** Before any diff or hash, CRLF becomes LF and a leading BOM is dropped, on both sides. With `core.autocrlf=true` on Windows the base blob holds LF and the work-tree file CRLF, and without this every line of every file would differ. Phase 06 hashes the same normalized text.

3. **Line diff.** A Myers diff over lines, grouped into hunks with three lines of context, each line carrying its base and head line numbers. It is computed in JavaScript rather than taken from `git diff`, because phase 06 compares two texts git never stored (a reviewed snapshot and the current file), and because git's output follows the user's diff configuration. Choose in this phase between the `diff` package (jsdiff: mature, no dependencies) as a pinned core dependency and a small Myers implementation in core, which keeps the published package's dependency list unchanged. Either way the hunk format is core's own type, not the library's.

4. **Word diff inside changed lines.** Within a hunk, pair removed and added lines by order, or by similarity when the counts differ, and diff each pair by tokens: runs of Unicode letters and digits, so Cyrillic works; whitespace runs; punctuation; and Markdown markers such as `**`, `` ` ``, `[` and `](` as tokens of their own, so a changed link target highlights the target and not the whole link. A pair below a similarity threshold stays a whole-line removal and addition, because a rewritten paragraph highlighted word by word is noise.

5. **Table rows.** A changed line that the parsed document places inside a GFM table (from its positions, not a regex) is diffed by cell, so the changed cell is what lights up.

6. **Changed code lines.** For changed non-Markdown files that a corpus document links to, compute the head-side line ranges that were edited and the first line that moved, from the same line diff over their base and head text. That is all phase 05 needs to tell whether a link to `#L12-L20` points at edited lines or at lines a change above them shifted.

7. **Types and caching.** Explicit, JSON-serializable public types — `ChangeSet` (base ref, base commit, merge-base, head as work tree or commit, sorted entries, `configChanged`, `outsideCorpus`) and `TextDiff` (hunks of lines of segments) — so `/api/changes` returns them without reshaping. A change set is keyed by merge-base, `HEAD` and the work-tree state, and a single saved file is re-diffed against its cached base text rather than recomputing the whole set.

## Tests

Pure unit tests over string pairs, no git: CRLF against LF is no change; a BOM is no change; one changed Cyrillic word highlights that word; a changed link target highlights the target; a changed table cell; a rewritten paragraph stays whole lines; an empty file; a whole file added or deleted; hunk and segment order stable.

Classification tests over an in-memory corpus and a synthetic changed-path list: added, modified, deleted and renamed documents; a rename into and out of the scope; a config change; Markdown outside the corpus counted and listed; a changed code file with the ranges a link would check.

## Docs

Internal until phase 03 renders it.

## Done when

- [ ] Core exports the change-set classification, text normalization, line and word diff, and the changed-code-range helper, with explicit types.
- [ ] Every diff and classification is covered by unit tests that need no git.
- [ ] A change set is cached and a single save re-diffs one file.
