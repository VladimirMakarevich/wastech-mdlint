# Review follow-ups (feat/viewer, pre-0.4.0)

Findings from the final pre-release review of `feat/viewer` against `main` that were not fixed in that pass. The ten most severe were fixed; everything below is still open. Line numbers are as of the review and may have drifted, so each item also names the function. This is a working list, not permanent documentation: delete it once every item is fixed, moved to an issue, or dismissed. Items are ordered by when they should land: before the first publication of 0.4.0 (the first release of the viewer, and the npm page that shows each package README), or after it.

Severity: **bug** — wrong behavior a user can hit; **gap** — missing guard or test; **docs** — documentation out of step with the product; **nit** — minor.

## Before the 0.4.0 release

What a user can hit as lost data, a frozen process or a broken promise of the documentation, plus what is cheap and visible in everyday use.

- [ ] **docs** — `commands.ts` ~94-105. Under `lint --since --format json`, `files` and `summary.files` count only changed documents, while `messages` can carry findings on unchanged ones (a heading rename breaking an anchor elsewhere). Fix: say in `docs/guide/output.md` and `docs/guide/cli.md` that under `--since`, `files` means the changed documents.
- [ ] **bug** — `packages/viewer/src/client/dashboard.ts` ~107-112 (`refresh`). A `change` or `diagnostics` event refreshes `location.pathname + location.search`, but `history.replaceState` runs only after a response lands, so it cancels the reader's newer filter or sort and shows the old rows under the new input value. Fix: refresh the last address passed to `show()`, without cancelling a newer request.
- [ ] **docs** — Synopses lack `--since`: `packages/cli/README.md` ~17, ~20; `README.md` ~65, ~68, ~78-80; `packages/mcp-server/README.md` ~37 describes `impact-analysis` as "one file" and mentions `since` on neither tool; `docs/guide/use-cases/adopt-and-ci.md`, `change-impact.md` and `context-graph.md` never mention it. The npm page of the 0.4.0 CLI shows its README, which never names the release's headline flag.
- [ ] **docs** — Exit-code tables (`docs/guide/cli.md` ~26, `docs/guide/output.md` ~73, the `packages/cli/README.md` table) omit the new exit-2 causes: git missing or older than 2.31, a ref naming nothing, a shallow clone, `--since` with `--fix`, `impact` with both or neither of `<file>` and `--since`.

## Waiting on a decision

- [ ] **docs** — `AGENTS.md` ~38, `.agents/rules/coding-style.md` ~54, `.agents/rules/testing.md` ~60 still say "all three packages" for the cross-platform requirement now that the viewer is published too. Rule files change only after discussing the wording with the user.

## After the release

Rare scenarios with a workaround, architecture nits that break nothing today, and missing tests.

### Core: git and the branch comparison

- [ ] **bug** — `git-repository.ts` ~685-712, ~745-817 (`composeChanges`). A staged rename whose source path is then recreated as an untracked file (`git mv a.md b.md && echo x > a.md`) composes to `R b.md←a.md` plus `A a.md`; `a.md` then reads its base side as empty, so the review shows it fully added and loses its base findings. Fix: a path a rename lists as gone that comes back as `A` becomes `M`, as delete-then-recreate already is.
- [ ] **nit** — `packages/core/src/git/git-command.ts` ~62-67 (`KEPT_GIT_VARIABLES`). `GIT_DISCOVERY_ACROSS_FILESYSTEM` is dropped although it is the user's own setup like the kept `GIT_CEILING_DIRECTORIES`; a host root on a different mount than the top level (container bind mounts) reports "not inside a git work tree". Fix: keep it.

### Core: engine, config, graph, compile

- [ ] **bug** — `packages/core/src/engine/fix-prompt.ts` ~275-346 (`reportingSizeEntry` and the budget steps). With SIZE-001 listed more than once and one file carrying findings from different entries, the prompt picks the entry of the first finding only and tells the agent to raise every metric there; the other entry keeps reporting. Fix: look up the reporting entry per finding and group the raise steps by entry; add a multi-entry, multi-finding test.
- [ ] **nit** — `packages/core/src/graph/search-index.ts` ~199 (`getContextSlice`). A plain-JS caller still using the old positional form `getContextSlice(g, docs, "REQ-1", 4, idRef)` gets no error: destructuring a number gives `depth = 2` and drops `idRef`. Fix: throw a `TypeError` when `options` is not a plain object.
- [ ] **nit** — `packages/core/src/config/edit-config.ts` ~168 (`setAt`), ~254 (`removeAt`). With a duplicate key, the edit lands on the first copy while the loader reads the last, so the save succeeds and changes nothing (`{"rules":[1],"rules":[2]}`). Fix: refuse to edit text with a duplicate key, or edit the last copy.
- [ ] **nit** — `edit-config.ts` ~474-480 (`unitOf`). The indent unit comes from the first indented line, which can be the `*` of a block-comment header, so new multi-line values get one-space indentation. Fix: measure indentation from JSON members via the parse tree.
- [ ] **nit** — `packages/core/src/compile/describe-rules.ts` ~161. The switch became an object lookup, so an unvalidated assertion kind naming an `Object.prototype` member (`__proto__`, `hasOwnProperty`) throws instead of returning the assertion. Fix: guard with `Object.hasOwn(ASSERTION_SUMMARIZERS, kind)`.

### CLI and MCP

- [ ] **nit** — `packages/cli/src/commands.ts` ~155-190 (`impactSince`). `impact --since` parses the corpus twice: `analyzeSince` loads it, then `lintFiles` re-discovers and re-parses from disk, against the one-parse-pass invariant; a file saved between the reads is linted against a graph built from its older text. `impact <file>` already did the same before this branch. Fix: have core expose the head-side findings, or let `lintFiles` take loaded documents.
- [ ] **nit** — `packages/mcp-server/src/shared/since.ts` ~779-784 vs the CLI. An empty or whitespace `since` gets "since must name a branch, tag or commit" from MCP but "`" "` does not name a commit" from the CLI. Fix: move the trim check into core's `resolveBase`.
- [ ] **nit** — `commands.ts` ~387-395. `impact` became `[file]`, so a missing file is caught after `loadConfiguration`; `impact --config missing.json` reports the config error instead of the usage error (exit code 2 either way). Fix: check file/`--since` before loading config, or use commander's `.conflicts()`.
- [ ] **nit** — `packages/cli/src/program.ts` ~430-434. Dropping `=== true` from `process.stdin.isTTY` / `process.stdout.isTTY` lets `isTty` be `undefined` at runtime though typed `boolean`; harmless today, a trap for a future `=== false` check. Fix: restore `=== true` or wrap in `Boolean()`.
- [ ] **gap** — Tests: MCP `lint-files` with both `patterns` and `since`; the `lint` section of `impact --since` JSON. Optionally tag the new CLI/MCP `since` parity describe in `packages/mcp-server/test/host-parity.test.ts` with `@boundary-guard host-parity`.

### Viewer: server

- [ ] **bug** — `packages/viewer/src/review-store.ts` ~333, ~362-371. The lock's `finally` unlinks `review.lock` without checking it still owns it; after a stale-lock takeover (a write over `LOCK_STALE_MS`, 10 s), the first writer deletes the second's lock and a third can enter, and the later index rename drops a mark. Fix: write a nonce into the lock and unlink only if it still holds it, or refresh the lock's mtime while writing.

### Viewer: rendering

- [ ] **bug** — `packages/viewer/src/render-document.ts` ~145-148 with `render-cache.ts` ~7-13. On a renamed-and-moved document, the base side resolves Markdown targets against `basePath` but raw-HTML targets (`resolveEmbedded`, bound to the head `ParsedDocument`) against the head path, so in a folded removed block `![](x.png)` and `<img src="x.png">` resolve to different files, and base-only targets are recorded as servable under the head document. Fix: give `resolveEmbedded` a `fromPath`; add a test with `basePath !== path`.
- [ ] **bug** — `packages/viewer/src/page.ts` ~109-119, ~205, ~252-256 with `render-document.ts` ~70-92. The sanitizer keeps author `id`s (`clobberPrefix: ""`), so raw HTML `<div id="viewer.end">` precedes the real element and satisfies `<link rel="expect" href="#viewer.end" blocking="render">` early — the half-painted flash that code exists to prevent. The comment claiming viewer ids cannot collide is wrong. Fix: strip or rename author ids starting with `viewer.` while sanitizing, and correct the comment.
- [ ] **nit** — `packages/viewer/src/dashboard.ts` ~392-424 (`graphFacts`) and `corpus.ts` ~330-338 (`backlinks`). Both walk `graph.edges` themselves instead of using core's `query`, as `documentNeighbors` does — a parallel traversal that agrees today only because core excludes self-edges. Fix: derive the counts from `query(graph, { start, direction, depth: 1 })` or a shared core helper.
- [ ] **nit** — `packages/viewer/src/diagnostics.ts` ~66-75. Between an edit landing and the next lint finishing, the last run's line numbers are anchored to the new text's headings, so a finding's "line N" link can jump to the wrong section. Fix: keep the document (or its hash) the lint ran over and skip anchoring when it is not current.
- [ ] **nit** — `dashboard.ts` ~498-505. The orphan flag is `linkedFrom === 0`, while GRP-002 exempts `entryPoints` and honours scope, so the "orphan" filter lists README.md and CLAUDE.md, which lint never reports. Fix: apply GRP-002's resolved entry points and scope, or relabel.
- [ ] **gap** — Tests for change marks on CRLF, lone-CR and BOM content; links from rendered Markdown and raw HTML to paths with a space, `#`, `%` or non-ASCII; escaping of `set.base.ref` and finding messages on the Changes page.

### Viewer: browser code

- [ ] **bug** — `packages/viewer/src/client/graph.ts` ~106-112. On a changed graph the page calls `location.reload()` directly, bypassing `reloadKeepingScroll`'s guard against replacing an in-flight navigation and its scroll saving. Fix: export `reloadKeepingScroll` from `live-reload.ts` and use it.
- [ ] **bug** — `packages/viewer/src/client/live-reload.ts` ~101-112 (`reloadKeepingScroll`) with `navigation-feedback.ts` (`GIVE_UP_AFTER_MS`). A reload requested while `data-navigating` is set is dropped, not deferred; if that navigation never leaves the page (Esc, a download), the page stays stale indefinitely. Fix: remember the dropped reload and run it when the marker resets or on `pageshow` persisted.

### From the second review (of the ten fixes)

- [ ] **nit** — `config-draft.ts` (`planDrafts`, `aside = stored`). A set-aside draft is replaced, without the reader choosing to discard it, when the current draft also goes stale. Fix: keep a short list of set-aside drafts, or confirm before replacing.
- [ ] **nit** — `packages/viewer/src/corpus.ts` (`listedAsSpelled`). Every `servableFile` call reads every folder on the path with no cache, at load, on file events and per linked-file request; 2,000 images in one folder cost about 4M comparisons per load. Fix: cache listings per load or change batch.
- [ ] **nit** — `corpus.ts` (`resolveServableFile`). Any link whose real path differs from the written one only in letter case is refused, including a legitimate case-sensitive symlink (`docs/Logo.png -> logo.png`) and a wrongly-cased link that `lint` accepts on Windows/macOS, so the viewer shows "missing" where lint reports nothing; Content-Type is still chosen from the written name. Fix: refuse only when the file was reached by case folding, or document it.
- [ ] **nit** — `packages/core/src/engine/fix-prompt.ts` (`exactPattern`). Glob metacharacters are not escaped, so `docs/a[1].md` or `x{a,b}.md` is not an exact pattern despite the comment; `docs/guide/config-reference.md` ~415 also shows depth-agnostic `"entrypoints": ["CLAUDE.md", "AGENTS.md"]`. Fix: escape with `[…]` classes (backslash is unusable since `normalizeConfigGlob` turns it into `/`), or tell the agent to escape.
