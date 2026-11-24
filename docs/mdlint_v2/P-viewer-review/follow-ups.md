# Follow-ups

> Part of the [viewer review plan](index.md). Blocking points and open decisions collected while phases 01–07 were built, to settle once the whole plan has landed. Each says what it blocks and what was done in the meantime.

## Agreement needed

| # | What | Blocks | Meanwhile |
| --- | --- | --- | --- |
| 1 | The drafted changes to `.agents/rules/security.md`, `architecture.md` and `testing.md` for phases 03–07, listed under "Still open" in each phase file | Merging the branch | Nothing in `.agents/rules/` was changed |
| 2 | `CLAUDE.md`'s eager context is at 9994 of 10 000 tokens (LLM-001), so any of those drafts needs a rules file compressed or split first, and that is the user's decision | Item 1 | — |
| 3 | Phase 07 makes the CLI and the MCP server run git (read-only, `--since` / `since`) — until now only the viewer did. `security.md` says "Local filesystem analysis only" and that the MCP tools stay read-only; both still hold, but the drafts must say that git now runs from all three hosts | Item 1 | The hardened git runner in core is the only way any host starts git |

## Decisions taken without the user

| # | Decision | Alternative |
| --- | --- | --- |
| 4 | `lint --since` and the MCP `since` report only the findings the branch adds — on unchanged documents too, such as an anchor a renamed heading broke — and `--fail-on` gates on them; removed findings are listed in the `since` object only | Report every finding of the changed documents |
| 5 | `impact --since` takes every corpus document the work tree changed as one subject; a deleted document is left out of `files`, since the graph no longer holds it, and the documents that linked to it show up through the broken links `lint --since` reports | Keep deleted documents as subjects with an empty blast radius |
| 6 | The `impact-analysis` output schema made `file` optional and added `files` and `since`, rather than adding a tool, so the six read-only tools stay six | A seventh tool |
| 7 | `--since` and `--fix` together are refused (exit 2): fixing rewrites the work tree the comparison reads | Fix first, then compare |
| 8 | The ref watcher reloads only the pages that show the comparison (Changes, a changed document, the graph or dashboard with the branch shown), and only when the review really changed — a ref of another branch moving reloads nothing | Reload every page on any ref change |
| 9 | A section is what an outline lists: each second- or third-level heading with its own text up to the next one, plus the text before the first. Its identity is the heading's slug, so **renaming a heading resets its section's mark** — the question the plan left open | Keep the mark across a rename by matching the section's text |
| 10 | A document counts as reviewed once every section is, the text before the first one included; marking a document marks its sections as they are | Sections as information only, the document still marked as a whole |
| 11 | Blame is asked for in the address (`?blame=1`) from a **Blame** link beside the path in the header, on every document page in a git work tree, and computed per request without a cache; the author's name shows only on a loopback binding | A display setting; a cache per commit |
| 12 | The history list is in the line above a changed document only, loaded when opened, eight commits at most | History on every document page |
| 13 | A move is a whole line of at least twelve characters removed in one place and added unchanged in another; unchanged lines between hunks open twenty at a time, with script only | Moves by similarity; context without script through a link |
| 14 | The review computation the viewer had in `changes.ts` and `review-context.ts` moved to core (`reviewBranch`, `branchContext`, `analyzeSince`), since the CLI and MCP now need the same answer | A second copy in each host |

## Open questions

| # | Question | Where it matters |
| --- | --- | --- |
| 15 | Should the shipped skills (`skills/mdlint-docs`, `skills/mdlint-impact`) mention `lint --since` and `impact --since`? Changing a shipped skill needs the user's confirmation | The skills' guidance for CI and agent use |
| 16 | The text before the first section has no outline entry, so when only it changed the document has to be marked as a whole. Should the outline get an entry for it? | Section marks on documents with a long introduction |
| 17 | Should unchanged documents show their history too, and should the Changes page show "2 of 5 sections reviewed" on a card? | The review UI |
