# 04 · Rendered diff and outline markers on the document page

> Part of the [viewer review plan](index.md).

## Goal

The document page itself shows what changed: changed and added blocks marked at their edge, removed blocks as collapsed placeholders where they stood, changed sections marked in the outline, and a switch between the rendered view, the source diff and no marks at all.

## Steps

1. **Block ranges.** `render-document.ts` already gives every block and list item the line it starts on as `data-line`; add the line it ends on from the same mdast position, so a block's range is known without guessing from the next block.

2. **Marks on the server.** Rendering takes the head-side changed ranges and removal points from phase 02's hunks. A block whose range intersects a changed range is marked changed; one that lies wholly inside added lines is marked added. The innermost block wins — the list item, not the whole list — while a table, a code block and the front-matter card are each marked as one unit. Done on the server so the page is right without script and nothing shifts after it loads.

3. **Removed blocks.** Parse the base text with the same `parseDocumentWithTree`, render the blocks that fall inside removed ranges, and insert them at their removal point inside a collapsed `<details>` ("2 blocks removed"). Their links resolve against the head corpus, so a link that resolved only at the base shows as missing — which is what the reader should learn.

4. **Inline word marks.** Start with block-level marks only. Mapping phase 02's word segments onto rendered text nodes is fragile across inline markup; attempt it within this phase only if it maps reliably on the fixtures, otherwise leave it to the source view.

5. **The mark itself.** A bar at the block's left edge, colored for added or changed, clear of the right margin that holds source line numbers. A click on the bar shows that block's hunk from the source diff in place.

6. **Outline.** A heading whose section — from the heading to the next heading of the same or a higher level — intersects a change gets a marker in the outline `page.ts` draws, so the changed sections are visible before scrolling. The outline spy is untouched.

7. **Mode switch.** The banner from phase 03 gains a segmented control (`segmented.ts`): Rendered, Source and Off. The mode is `?diff=` in the address, so it survives a reload and travels in a link; Source shows the document's diff in place of the article; Off is the page as it is today.

8. **Print and narrow screens.** In print the marks stay as a left border and removed placeholders are left out; on a narrow screen the bar stays and the hunk opens full width.

## Tests

Render tests over small fixtures: a changed paragraph marks only that paragraph; a changed list item marks the item, not the list; a table, a code block and front matter each marked as a unit; an added block marked added; a removal inserts its placeholder at the right position with the removed content; a changed section marked in the outline; no marks for an unchanged document or with `?diff=off`; the HTML served without script already carries the marks.

## Docs

`packages/viewer/README.md`, What it shows: the marks, the removed placeholders, the outline markers and the mode switch.

## Done when

- [ ] A changed document's page marks its changed and added blocks and shows removed ones where they stood.
- [ ] Changed sections are marked in the outline.
- [ ] Rendered, Source and Off are one click apart and kept in the address.
- [ ] All of it is rendered on the server and covered by render tests.
