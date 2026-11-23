# 05 · Context delta: findings, tokens, links, affected documents

> Part of the [viewer review plan](index.md). Status **Implemented**, pending the rules discussion below.

## Goal

Show what the change does to the context, not only to the text: the findings it adds and removes, the tokens it adds to each document and to every agent session, the links it creates and breaks, and the unchanged documents it affects.

## Decisions taken before building

Agreed with the user:

- **Commits only is computed honestly.** The merge-base's corpus is the files on disk with every document the work-tree review lists swapped to its merge-base text; the head of Commits only is that corpus with the commits' changes applied. Uncommitted edits stay out of that mode's delta as they stay out of its diffs. It costs the work-tree review in that mode as well.
- **Edited lines carry findings too.** Base lines map to head lines through unchanged lines and through lines paired as edits, so a finding that survives an edit to its paragraph is the same finding. A line removed without a counterpart still loses its findings.
- **Two fragment parsers, one table.** Core's `parseLineFragment` reads the grammar REF-002 already accepts (columns included); the page script's `lineRange` keeps its own reader, now with columns and without `L0`; `packages/viewer/test/source-lines.test.ts` runs both through one table of fragments.

Taken while building: the delta is computed apart from the review and only on request — by the Changes page, `/api/changes`, the dashboard and the graph with changes — so a document's page, which waits for the review, never waits for two lints as well.

## What was built

1. **Findings delta in core.** `compareFindings(before, after, locate?)` (`packages/core/src/changes/findings-delta.ts`) is the multiset comparison on file, rule, line, severity and message, with an optional locator that moves an earlier finding to its later file and line. The config preview (`previewCandidate`) uses it with no locator; its tests pass unchanged.

2. **Line mapping.** `baseLineMap(diff)` in `head-changes.ts`: unchanged lines shifted by the hunks above them, paired edited lines to their counterparts, removed lines to nothing, line 0 to 0.

3. **Base corpus.** `replaceDocuments(documents, swaps)` (`snapshot.ts`) with `swapsTowardBase` / `swapsTowardHead` (`context-delta.ts`): only changed documents are swapped, every other document is the same object. The review now keeps each changed document parsed on both sides (`baseDocument`, `headDocument`, which the diff already parsed for table rows), the config's text on both sides, and a snapshot of the corpus it read.

4. **Tokens.** `eagerContextTokens` is extracted from LLM-001 — the traversal and the sum the rule checks — and `eagerContextBudgets(documents, config, siteRouter)` lists every entrypoint with its total and budget. Each card shows tokens, lines and KB before and after from `measureDocument`; the summary shows each entrypoint whose total moved, in the warning color when over budget.

5. **Links.** `compareEdges(before, after, renamed)` (`link-delta.ts`) is the multiset edge difference on source, target and type, following renames. Each card lists its document's added and removed links; the delta keeps the whole difference for the graph.

6. **The delta.** `computeContextDelta` (`context-delta.ts`) is pure: it lints both sides with `lintContext`, compares findings through the line maps, measures, compares edges and budgets, and finds the affected documents — unchanged ones with new findings, `linksIntoChangedLines` (links whose `#L` span now shows edited or moved code, a change below the span ignored, the span cut at the base file's end) and, folded, unchanged documents linking to a changed one, in the head's graph or the base's (an anchor into a renamed heading is no edge in the head). `lineLinkTargets` tells a host which changed files to read. `configOnly` is the head's documents linted with each side's config. The viewer's `review-context.ts` assembles both corpora, reads the linked code files' two versions (one `cat-file` per side; the work tree from disk), and caches the result per review in `ChangeTracker.context`.

7. **Ordering tier.** `rankByInfluence` takes `newErrors`: eager context, then documents given new errors, then reach, then path.

8. **Graph and dashboard.** `/graph`, `/api/graph` and `/api/neighbors` take `changes=1`: `withChanges` marks changed nodes with their letter, affected ones, pairs whose every link is new, and pairs with no link left (drawn dashed, `ignoreForceLayout`, so the layout is the same as without changes). The graph form has a "Show the branch's changes" box; the local graph shows them on a changed document's page unless its view is Off. The dashboard gains a Branch column (letter, findings gained and lost — unchanged documents included), a `changed=1` filter refused with a message where there is no review, and three CSV columns in a review. Both read the work-tree review, as they show the files on disk.

9. **The config's card** shows what the config change alone does over the head's documents, through `compareFindings`.

## Where it differs from the plan

- **The delta is not part of the review.** It is computed on request and cached per review object, so the document page's wait stays one `rev-parse`.
- **Affected documents include unchanged entrypoints** whose eager context grew: the LLM-001 budget message names a new total, so it is a new finding on a file the branch did not touch. That is the change a reviewer of agent context most needs to see, so it was kept rather than filtered.
- **Links to changed documents come from both graphs**, since a link whose anchor the change broke disappears from the head's graph.
- **Approximations named:** both are on the Changes page when they apply (the scope note only when the scope changed) and in Known limits; a base or head config that fails to load is linted with the current one, and the page says so.

## Tests

- Core: `findings-delta.test.ts` (multiset; moved and unmovable findings); `head-changes.test.ts` (`baseLineMap`: shift, edited line, removed line, line 0); `context-delta.test.ts` (swaps both ways; a finding moved by an inserted paragraph is no change; a deleted document's finding removed; an unchanged document whose anchor broke is affected and linking; new errors; sizes; config-only delta; `compareEdges` with a rename; `linksIntoChangedLines` for edited, shifted and below-range spans; `eagerContextBudgets` equal to LLM-001's reported total).
- Viewer `source-lines.test.ts`: one table for both fragment parsers.
- Viewer `changes.test.ts`, on a git branch: a moved finding is no change and only the new one is listed; affected documents (an entrypoint whose budget finding moved, a broken anchor, a link into shifted code but not into unchanged lines above it); the new-errors tier; the eager budget; the page's findings, budget lines and code links read back from its words against `/api/changes` (`@boundary-guard host-parity`, in the file the inventory already lists); the config card's own delta; Commits only without the uncommitted edits and with the committed budget; graph marks only with `changes=1`; the dashboard filter, column and CSV, and the filter refused without a base.

## Still open

Before this merges, agree with the user on the drafted changes to `.agents/rules/`, together with phases 03 and 04: `architecture.md` (the viewer's Changes context, dashboard Branch column and graph marks come from core's `computeContextDelta`, `compareFindings` — shared with the config preview — and `rankByInfluence`), `security.md` (the dashboard and the graph with changes run the read-only `rev-parse` too; the two versions of a changed code file a document links into with a line fragment are read to compare them and never served).

## Done when

- [x] Findings, token and eager-context deltas show on the cards and in the summary, with base findings mapped through the line diff.
- [x] The config preview and the branch delta share one core comparison.
- [x] Unchanged documents the change affects are listed, including links into edited or shifted code lines.
- [x] The graph and the dashboard can show the change.
- [ ] The rules changes are agreed with the user.
