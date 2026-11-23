# Viewer review — local review of context changes

> Status **Planned**. This folder is the working plan for adding a local review of Markdown context changes to `@wastech-mdlint/viewer`. It is task documentation: it is deleted once the last phase it schedules has landed, and nothing outside it — no code comment, no test, no permanent document — may depend on it. A fact that has to outlive the work moves into the code, a test or `packages/viewer/README.md` in the phase that establishes it.

## Why this folder exists

In a pull request with 100–200 changed files, the dozen Markdown files that shape agent context get lost among the code and are the first to be scrolled past. A change to `CLAUDE.md` or `.agents/rules/` made by an agent inside a large pull request alters every later session, and it is the change least likely to be read.

The viewer already knows the corpus the linter checks, how each document renders, what the linter reports about it, which documents link to it and what it costs in tokens. This work turns that into a focused review of exactly that corpus: what changed against the base branch, what the change does to the context, what the reader has already reviewed and what is still left.

## Agreed decisions

1. **A Markdown-only diff is the primary tool.** The Changes page lists only corpus documents — the config's `include`, `exclude` and `respectGitignore` decide, as they do for `lint` — so 200 changed files become the dozen documents that matter. The source diff is the default view; the rendered page with change markers is the second one.
2. **The base is `merge-base(HEAD, base branch)`**, as GitHub's three-dot comparison is, so commits that landed on the base branch after the fork never show as deletions in this one. The default base is the target of `origin/HEAD`, then `main`, then `master`; `--base <ref>` overrides it. Uncommitted and untracked changes are included by default, and a toggle limits the view to committed ones.
3. **Word-level highlighting inside changed lines is the default.** A Markdown paragraph is usually one line — this repository formats with `proseWrap: "never"`, and agents write unwrapped prose — so a plain line diff marks a whole paragraph for one changed word. A table row highlights the changed cell.
4. **Changes are ordered by influence, not alphabetically:** the config file and the eagerly loaded agent context (LLM-001 entrypoints and everything they import) first, then documents with new errors, then by how many documents depend on them, with the path as the final tie-break.
5. **Nothing drops out silently.** Changed Markdown outside the corpus is counted on the page and listed on demand, because a narrowed scope must never look like "no changes".
6. **The link between documents and code stays visible.** A document that links to lines of a source file (`file.ts#L12-L20`) whose lines were edited or shifted is listed as affected even when the document itself did not change.
7. **"Reviewed" is keyed by content, not by time or branch.** A document stays reviewed while its text equals the text that was marked, turns "changed since review" when it differs, keeps its mark across branch switches, rebases and force-pushes, and offers a second baseline: the diff since the reader's last review.
8. **Review state lives on the server, outside the working tree**, in the user's state directory, keyed by the repository's git common directory so every worktree of one clone shares one history. Browser storage is per port and per browser, which for a review history is data loss.
9. **Marks are per file first.** Per-section marks are deferred.
10. **Git access lives in core**, read-only, through `execFile` with an argument list, and so does every pure comparison — change set, text diff, findings, tokens, links — so a later `lint --since` or `impact --since` in the CLI and MCP reuses it instead of re-deriving it. The viewer owns the pages, the marks and their store.

## Phases

| # | Phase | Depends on |
| --- | --- | --- |
| [01](01-core-git-access.md) | Read-only git access in core | nothing |
| [02](02-core-change-set-and-diff.md) | Change set and text diff in core | 01 |
| [03](03-viewer-changes-page.md) | Changes page in the viewer | 02 |
| [04](04-viewer-rendered-diff.md) | Rendered diff and outline markers on the document page | 03 |
| [05](05-context-delta.md) | Context delta: findings, tokens, links, affected documents | 03 |
| [06](06-review-state.md) | Review state: reviewed marks, queue, "since my last review" | 03 |
| [07](07-deferred.md) | Deferred: sections, history, blame, `--since` in CLI and MCP | 05, 06 |

Phases 01–03 together are the first usable result: a focused, ordered list of changed documents with word-level diffs. After 03, phases 04, 05 and 06 do not need each other's results, but all three edit `page.ts`, `server.ts` and the Changes page, so they land one at a time rather than in parallel. Phase 06 may go before 05 when review marks are wanted sooner; 05 then adds its ordering tier to a page that already carries marks.

## Constraints every phase keeps

- **Core computes, the viewer renders.** The change set, the diff, the base corpus, the findings and token deltas and the review order are core functions over plain data. The viewer reuses `query`, `impact`, `topologicalSort`, `lintContext`, `parseDocumentWithTree`, `measureDocument` and `estimateTokens` rather than writing a second traversal or a second lint path.
- **Deterministic output.** Every list is sorted with core's code-point comparator, every path is repository-relative POSIX. Times from the review store appear only in the page, never in an `/api/*` payload.
- **Cross-platform.** CRLF and a leading BOM are normalized before any diff or hash; the viewer root may be a subdirectory of the git work tree, so git paths cross that prefix in exactly one place; git output is read with `-z`; no shell anywhere.
- **Hidden, not broken, without git.** No `git` binary, not a repository, a repository git refuses as owned by someone else, no base found, or a shallow clone: the Changes section explains which and how to fix it, and every other page works as before.
- **GET never mutates.** The only new write is phase 06's review mark, guarded like the config save.
- **Documentation in the same change.** Each phase updates `packages/viewer/README.md` — Run it, What it shows, Security, Known limits — for what it adds. Phases 01, 03 and 06 change what the viewer may do (run `git`, write outside the repository), which `.agents/rules/security.md`, `.agents/rules/architecture.md` and `.agents/rules/testing.md` describe; the wording of those files is the user's decision, so each phase drafts its change to them and discusses it before merging.
- **Gates.** `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm run format`, and `npm run lint:docs` for every phase that touches a README or a rules file.

## What "done" means

- [ ] In a git repository the viewer shows a Changes section listing only corpus documents changed against the merge-base, ordered by influence, with a count of changed Markdown outside the corpus.
- [ ] Every changed document has a source diff with word-level highlighting, and its page marks changed blocks and changed outline sections.
- [ ] The Changes page shows the findings, token and eager-context deltas, and lists the unchanged documents the change affects, including those linking into changed code lines.
- [ ] A document can be marked reviewed; the mark follows content rather than branch; documents changed since their review are flagged; the tree and the header show what is left; the diff since the last review is one click away.
- [ ] Without git, without a base, or in a shallow clone the viewer works as before and says why Changes is unavailable.
- [ ] The viewer README describes every new surface and the changed security model, and the rules files say what the user agreed.

## Deliberately not tracked here

Comments on a change, shared or team-wide review state, and any network surface beyond the existing local listener were not part of the discussion and are out of scope. Ideas that were discussed but are not scheduled are in [07](07-deferred.md).
