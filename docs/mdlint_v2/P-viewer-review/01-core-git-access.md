# 01 · Read-only git access in core

> Part of the [viewer review plan](index.md).

## Goal

One core module answers the few questions the review needs from git — is this a repository, where its root is, what the base is, what changed, what a file's text was at a commit — without a shell, without writing anything under `.git`, and without ever running a program that a repository's own configuration names. Today neither core nor any host runs `git`; this module is the only place that will.

## Steps

1. **Module and contract.** A new `packages/core/src/git/` with a small typed API, for example `openGitRepository(rootDir)` returning either a `GitRepository` with `resolveBase(ref?)`, `mergeBase(left, right)`, `changedPaths(from, { worktree })` and `readBlobs(commit, paths)`, or a `GitUnavailable` with a reason code — `no-git-binary`, `git-too-old`, `not-a-repository`, `dubious-ownership`, `base-not-found`, `shallow-history` — and a hint. That is the pattern `ImpactAnalysisError` already follows (a code plus a hint), so a host renders the reason instead of a stack trace.

2. **Process hygiene.** Every call is `execFile("git", argv, { cwd, env, windowsHide: true, timeout, maxBuffer })`, never a shell, so a path with a space, an ampersand or a quote is data. Every call carries fixed options, each closing a way a cloned repository could make git run its program:
   - `-c core.fsmonitor=false`: an fsmonitor hook set in repository config is a program git starts on status and diff;
   - `--no-ext-diff --no-textconv` on every diff: both run programs the repository's config names;
   - `-c core.quotePath=false` and `-z` output, so a path with Cyrillic letters or a space comes back verbatim;
   - `--ignore-submodules`, so a submodule is neither walked nor reported.

   The environment drops every inherited `GIT_*` variable — a viewer started from a git hook would otherwise read the repository named by `GIT_DIR` rather than the one it was pointed at — and then sets `GIT_OPTIONAL_LOCKS=0` (so a diff against the work tree never refreshes and rewrites `.git/index`), `GIT_TERMINAL_PROMPT=0` and `GIT_PAGER=cat`.

3. **Ref validation.** A ref from `--base` that starts with `-` is refused before git sees it, and every other ref is resolved with `rev-parse --verify --end-of-options <ref>^{commit}`, so a ref can never be read as an option. Pathspecs always follow `--`. `--end-of-options` arrived in git 2.24; an older git reports `git-too-old` with the version found.

4. **Repository geometry.** One `rev-parse --show-toplevel --show-prefix --git-common-dir --is-shallow-repository` call. The viewer root may be a subdirectory of the work tree — a package of a monorepo — while git reports paths from the top level, so paths cross that prefix in this module and nowhere else, and changes outside the prefix are dropped here. The realpath of the git common directory is the identity phase 06 keys review state on, shared by every worktree of one clone.

5. **Base resolution.** An explicit `--base` wins. Otherwise the target of `refs/remotes/origin/HEAD` (`symbolic-ref --quiet`), then a local `main`, then `master`; none of them is `base-not-found`, whose hint names `--base`. On the base branch itself the merge-base is `HEAD` and only uncommitted work shows — a valid state, not an error.

6. **Changed paths.** `diff --name-status -z -M <merge-base>` against the work tree, plus `ls-files --others --exclude-standard -z` for untracked files, which no diff lists; or `diff --name-status -z -M <merge-base> HEAD` when the view is limited to commits. The result is `{ status: "A" | "M" | "D" | "R", path, oldPath? }[]`, sorted with core's comparator rather than left in git's order.

7. **Blob reading.** One `cat-file --batch` process fed `<commit>:<path>` lines reads every requested file, decoded as UTF-8 the way `loadDocuments` decodes the work tree: one process for fifty files instead of fifty.

8. **Shallow history.** `merge-base` fails in a shallow clone when the fork point is not fetched. That reports `shallow-history`, with `git fetch --deepen` or `--unshallow` as the hint, instead of a generic failure.

## Tests

Each test builds its own repository in a temporary directory, with `git` spawned from an argument list:

- not a repository; the viewer root a subdirectory, so paths carry the prefix and changes outside it are dropped;
- added, modified, deleted, renamed and untracked files; a path with a space and Cyrillic letters;
- a ref starting with `-` refused before any git call; an unknown ref reported as `base-not-found`;
- a repository whose config sets `core.fsmonitor`, `diff.external` and a `textconv` driver to a script that writes a marker file — the marker never appears;
- `GIT_DIR` pointing at another repository in the parent environment — ignored;
- `.git/index` unchanged (bytes and mtime) after a diff against a work tree with touched files;
- a shallow clone reports `shallow-history`; HEAD on the base branch shows only uncommitted work;
- output order identical however git orders it.

## Docs

Nothing user-facing yet: the module has no caller until phase 03. Draft the change to `.agents/rules/security.md` — its Command Execution section gains read-only `git` with the fixed options above as the one command core runs — and to `.agents/rules/architecture.md` (core owns git access), and discuss both with the user before phase 03 merges.

## Done when

- [ ] Core exports the git module with typed results and typed unavailability reasons.
- [ ] No git call goes through a shell, writes under `.git`, or runs a program from repository config, and a test proves each.
- [ ] Paths are repository-relative POSIX from the viewer root, prefix applied in one place.
- [ ] Base resolution, merge-base, changed paths and blob reading are covered on fixture repositories.
