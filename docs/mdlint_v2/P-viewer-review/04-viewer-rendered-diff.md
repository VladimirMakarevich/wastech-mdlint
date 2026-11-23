# 04 · Rendered diff and outline markers on the document page

> Part of the [viewer review plan](index.md). Status **Implemented**, pending the rules discussion below.

## Goal

The document page itself shows what changed: changed and added blocks marked at their edge, removed blocks as collapsed placeholders where they stood, changed sections marked in the outline, and a switch between the rendered view, the source diff and no marks at all.

## Decision taken before building

The plan asked for marks on the server, while phase 03 had kept the document page away from git so it never waits for it. Measured on this repository (Windows, 15 changed documents): a cached review costs one `git rev-parse`, about 35 ms per page; a review rebuilt after a save about 360 ms. Agreed with the user: **the document page waits for the cached review**, and the line above the text moves to the server with the switch in it. In exchange the tracker shares one running review between every request that arrives while it is computed, and the watcher starts it as soon as it clears the cache, so the reload a save causes joins work already under way.

## What was built

1. **Core: changes on the head side.** `headChanges(diff)` (`packages/core/src/changes/head-changes.ts`) restates a `TextDiff` in head line numbers: each changed head line is `edited` (paired with the base line it replaces) or `added` (compared with nothing), with its hunk; each run of unpaired removed base lines records the head line it stood after. `changedSections(headings, changes)` lists the headings whose section — to the next heading of the same or a higher level — holds a changed line or a removal point. Both exported from core.

2. **Block ranges.** `markSourceLines` adds `data-line-end` beside `data-line` from the same position, on every top-level block, list item and scrolling-block wrapper.

3. **Marks.** `packages/viewer/src/change-marks.ts` builds a block tree (top-level blocks, lists, items, lists nested in items or block quotes) from those ranges and marks a block `data-change="added"` when every text line in it is new, `changed` when it holds a new or edited line or lost lines that were part of it; the innermost block wins, a list is never marked itself, a wholly new block is marked once. Which block lost a removed line is read from the base: the surviving base block the line sat in, and whether it was that block's first, middle or last line — so a table's last row or a wrapped paragraph's first line marks that block, not its neighbor. `data-change-hunks` lists the hunks behind each mark. Front matter is a block of its own; its mark travels as `RenderedDocument.frontmatterChange` to the card `page.ts` draws.

4. **Removed blocks.** `renderDocument` takes an optional `DocumentChange`; the base text goes through the same pipeline (`renderTree`), and every base block whose text lines all left without a counterpart — outermost first, so a wholly removed list is one block — is put back folded where it stood: between top-level blocks, or as an item inside a list when the place is strictly between its items, an ordered list keeping the item's number. Neighbors from one place share a fold ("2 blocks removed", "1 list item removed"). Ids, anchor names and base line numbers are stripped; code is highlighted after insertion; links resolve against the head corpus, so a link only the base could follow shows as missing. Removed front matter comes back as its raw text.

5. **The bar.** CSS draws a bar in the left margin (amber changed, green added, red for a removed fold), stepping out past a list item's bullet through a `--list-indent` property the lists now carry. `client/change-marks.ts` lays a button over each bar that opens the block's hunks below it, cloned from a `<template class="change-hunks">` the server renders with `renderDiff`, so the browser never draws a diff of its own. A changed raw `<details>` keeps its bar without a button, since a closed `<details>` hides everything but its summary.

6. **Outline.** `page.ts` puts a dot (`span.outline-change`, labeled for assistive technology) in the outline entry of each section `changedSections` returns. The outline spy is untouched.

7. **Mode switch and banner.** `renderChangeBanner` in `changes.ts` draws the line above the text on the server: letter, "Modified in this branch · +1 −2", a segmented row of links Rendered / Source (`?diff=source`) / Off (`?diff=off`), and a link to the card on the Changes page. Source replaces the article with the document's diff and drops the outline and the front matter card; Off renders the page as before, banner kept. `client/changes.ts` no longer draws the banner; it keeps the header count and the tree letters.

8. **Server.** `sendDocument` asks the tracker for the work-tree review — the only one whose line numbers are the rendered file's — and uses a document's entry only when its head text is the text being rendered. Marked renders are cached per review object, which the tracker replaces after every watcher batch and every move of `HEAD` or the base. `ChangeTracker` gained the shared pending review and a generation counter, so a review overtaken by `invalidate` is neither cached nor joined. `DocumentReview` now carries `baseText` and `headText` (not in any `/api/*` payload).

9. **Print and narrow screens.** In print the bars become a left border and the switch, buttons, opened hunks and removed folds are left out. On a narrow screen the bars stay; the source line numbers already hide there.

## Where it differs from the plan

- **Inline word marks were not attempted.** Changed words are marked in the Source view and on the Changes page; the rendered page marks whole blocks. The README says so under Known limits.
- **A document the branch added gets no block marks**, only the banner: every block would carry the same mark the banner already gives.
- **The banner moved to the server** (planned as phase 03's script banner gaining a switch): the switch must work without script, and a server-rendered banner does not push the text down after load.
- **The hunk opens inside a list item, not full width**, on every screen: a `<div>` cannot follow an `<li>` inside its list. Its diff table scrolls sideways where it is narrow.
- **A removed blank line marks a block only from strictly inside a block without nested lists**, such as a code block; between list items it is the list's spacing, and counting it would mark the neighbor of a removed item.

## Tests

- Core `head-changes.test.ts`: edited, added, a rewrite as removal plus addition, removal at the top, a removed line between two edited ones, hunk indexes, CRLF/no change; sections around a change, a removal at a section's end, nothing changed.
- Viewer `render-changes.test.ts`, small fixtures without git: a changed paragraph alone; a list item not its list; a nested item not its parent; a table, a code block and front matter each as a unit; added blocks, a wholly new item marked once; a table that lost its last row; a paragraph that lost its first or last line marked, not its neighbor; a removed loose-list item leaving its neighbors unmarked; an unchanged document; a removed paragraph folded in place; a removed ordered item put back with its number; a whole removed list as one block; one fold for neighbors; no ids or line numbers in the removed copy; a removed code block highlighted; removed links against the current corpus; removed front matter.
- Viewer `changes.test.ts`, on a git branch: the served HTML already carries marks, the removed item and the hunk template; the banner sits above the front matter with the three views; the outline marks exactly the changed sections; `?diff=source` shows the diff and no outline; `?diff=off` shows no marks; an unchanged document has no banner; an added document has a banner and no marks; concurrent reviews share one result and an overtaken review is not kept.
- `render.test.ts` updated for `data-line-end`. No new process-boundary guard: every new behavior is visible in-process through the HTTP server.

## Still open

Before this merges, agree with the user on the drafted changes to `.agents/rules/`, together with phase 03's: `architecture.md` (the viewer's marks on a document page come from core's `headChanges` and `changedSections` over the review's diff; the base side is rendered by the same pipeline) and `security.md` (a document page, not only the Changes section, runs read-only `git`, one `rev-parse` per request with a cached review).

## Done when

- [x] A changed document's page marks its changed and added blocks and shows removed ones where they stood.
- [x] Changed sections are marked in the outline.
- [x] Rendered, Source and Off are one click apart and kept in the address.
- [x] All of it is rendered on the server and covered by render tests.
- [ ] The rules changes are agreed with the user.
