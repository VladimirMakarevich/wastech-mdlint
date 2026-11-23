# 05 · Context delta: findings, tokens, links, affected documents

> Part of the [viewer review plan](index.md).

## Goal

Show what the change does to the context, not only to the text: the findings it adds and removes, the tokens it adds to each document and to every agent session, the links it creates and breaks, and the unchanged documents it affects.

## Steps

1. **Findings delta in core.** The multiset comparison the config preview uses today is private to `packages/viewer/src/config-editor.ts` (`countByKey` and `difference`). Move it into core as an exported findings-delta function with the same matching — file, rule, line, severity, message — and switch the config preview to it with no change in behavior: two features computing one delta separately is how they start to disagree.

2. **Line mapping for a branch.** The config preview compares two runs over the same text, so a line number is stable there. Across a branch it is not: a paragraph inserted above a finding moves it down, and matching on the raw line would report it as removed and added. Before matching, map each base finding's line through that document's line diff from phase 02; a finding on a deleted line has no mapping and counts as removed.

3. **Base corpus without a second load.** Start from the head documents; swap in `parseDocument` of the base text for each changed document, add deleted documents back, drop added ones; build the base graph with `buildContextGraph`; lint it through `lintContext`, as `Corpus.lintCandidate` already lints an in-memory corpus. The rules come from the base config when the config changed and the base config loads, otherwise from the head config. Only changed documents are parsed again, and the result is cached per change set. Two known approximations, both named on the page and in Known limits:
   - REF-001 and REF-003 resolve non-Markdown targets against the work tree, because the lint needs a real root directory, so a link to a code file the branch deleted reads as fine at the base;
   - when the config's scope changed, the base corpus is still the head scope's set of paths.

4. **Tokens.** Per document, `measureDocument` on both sides gives the change in tokens, lines and KB on its card. For the agent context, per LLM-001 entrypoint, the total tokens of everything it eagerly imports at the base and at the head, against its budget. That total comes from a core helper the rule itself calls, extracted from LLM-001's traversal, rather than a second traversal in the viewer. The top of Changes says, for example, "CLAUDE.md eager context 8.9k → 10.7k tokens (+1.8k, budget 10k)", styled as a warning when over budget.

5. **Links.** The edge difference between the base and head graphs, keyed by source, target and edge type, gives each changed document's added and removed links. A broken link or anchor in an unchanged document needs nothing separate: it arrives as a new REF-001 or REF-002 finding in step 1's delta.

6. **Affected documents.** Below the changed ones, a group of unchanged documents the change reaches:
   - with new findings — a heading renamed elsewhere broke their anchor — listed first;
   - linking into changed code lines: a `#L<n>` or `#L<n>-L<m>` fragment pointing at a non-Markdown file whose lines in that range were edited, or moved by a change above them (phase 02, step 6). Lines changed only below the range do not count. The fragment parser now lives in the browser code (`lineRange` in `packages/viewer/src/client/source-lines.ts`), which does not import core; decide in this phase between a shared pure helper the client bundle can import and two implementations pinned by one shared table of cases;
   - linking directly to a changed document, collapsed behind a count, since a much-linked hub would flood the list.

7. **Ordering tier.** Documents with new errors move up, after the eager-context tier and before the impact count.

8. **Graph and dashboard.** `/graph`, `/api/graph` and the local graph accept `changes=1`: changed documents and added or removed links styled, affected documents outlined. The dashboard gains a "Changed" filter and a findings-delta column. Both go through query parameters, so a link carries them.

9. **The config's own card.** When the config changed, its card shows the JSONC diff and what the config change alone does to findings over the head documents — exactly the config preview's output, reused.

## Tests

- Core: the findings delta with line mapping — a paragraph inserted above a finding is no change, a finding on a deleted line is removed; base-corpus construction with swapped, deleted and added documents; the eager-context helper gives the totals LLM-001 reports; the edge difference.
- Viewer: an unchanged document whose anchor broke is listed as affected; a link into edited code lines and into lines shifted by an insertion above is flagged, and a change below the range is not; the deltas in `/api/changes` equal the rows parsed back from the page; the existing config preview tests pass unchanged.

## Docs

`packages/viewer/README.md`: What it shows (the deltas, the affected group, the graph and dashboard additions) and Known limits (the two approximations).

## Done when

- [ ] Findings, token and eager-context deltas show on the cards and in the summary, with base findings mapped through the line diff.
- [ ] The config preview and the branch delta share one core comparison.
- [ ] Unchanged documents the change affects are listed, including links into edited or shifted code lines.
- [ ] The graph and the dashboard can show the change.
