# 01 · Read-only git access in core

> Part of the [viewer review plan](index.md). Status **Implemented** in `packages/core/src/git/`, pending the rules discussion below.

## Goal

One core module answers the few questions the review needs from git — is this a repository, where its root is, what the base is, what changed, what a file's text was at a commit — without a shell, without writing anything under `.git`, and without ever running a program that a repository's own configuration names. Before it, neither core nor any host ran `git`; this module is the only place that does.

## What was built

1. **Contract.** `openGitRepository(rootDir, { env? })` returns a `GitRepository` — `headCommit()`, `resolveBase(ref?)`, `mergeBase(base)`, `changedPaths(from, { worktree })`, `readBlobs(commit, paths)` and `commonDir` — or a `GitUnavailable` with a reason (`no-git-binary`, `git-too-old`, `not-a-repository`, `dubious-ownership`, `invalid-ref`, `base-not-found`, `shallow-history`), a message and a hint. Hints are generic ("name the branch to compare with"), so each host adds its own flag name. Anything else is a thrown `GitCommandError`, whose message never carries git's stderr, because git quotes absolute paths there.

2. **Environment.** Every inherited `GIT_*` variable is dropped except the user's config-file selectors (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`) and `GIT_CEILING_DIRECTORIES`. Then the module sets `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `GIT_LITERAL_PATHSPECS=1` and `LC_ALL=C`; the last keeps git's error text untranslated, since "not a repository" and "dubious ownership" are told apart by it. `PATH` keeps only absolute entries, so an empty or `.` entry can never resolve `git` inside the repository.

3. **Settings through environment config, not `-c`.** `core.fsmonitor=false`, `core.quotePath=false`, and empty `clean`, `smudge` and `process` commands plus `required=false` for every filter driver any config defines, are passed as `GIT_CONFIG_COUNT`/`KEY`/`VALUE`. Checked on a real repository: a planted filter driver and an fsmonitor hook both run on a plain `git diff`; `-c` cannot override a driver whose name contains `=` (it splits at the first `=`), while environment config can. A legitimate driver such as git-lfs is emptied too, so a Markdown file kept in LFS compares as its pointer text.

4. **Minimum git 2.31**, for `GIT_CONFIG_COUNT`. `rev-parse --end-of-options` (2.30) resolves every ref, and a ref starting with `-` is refused before git sees it.

5. **Geometry.** One `rev-parse --show-toplevel --show-prefix --git-common-dir`; every later call runs at the top level, and paths cross the prefix inside `GitRepository` only, which keeps the prefix private. `commonDir` is the realpath of the common git directory: the identity phase 06 keys review state on.

6. **Base.** An explicit ref, else the target of `origin/HEAD`, then `main`, then `master`. Shallow history is checked when `merge-base` fails, not at open, so a clone deepened while a host runs is seen as deepened.

7. **Changed paths: `diff-tree` plus `status`, composed.** Porcelain `git diff <commit>` against the work tree rewrites `.git/index` whenever a file's stat changed but its content did not, and `GIT_OPTIONAL_LOCKS=0` does not stop it; a test demonstrates both. So commits come from `diff-tree -r -M <merge-base> HEAD`, which never looks at the work tree, and uncommitted work from `status --porcelain=v1 -z --untracked-files=all --find-renames`, the command that variable is defined for. `composeChanges` joins the two: a rename of a rename is one rename, an addition later deleted is nothing, a deletion re-created at the same path is a modification. A path changed and changed back reads as modified; phase 02's text diff shows it has no hunks.

8. **Blobs.** One `cat-file --batch` for all requested paths, decoded as UTF-8; absent paths, directories, and names containing a line break (which the protocol cannot express) are left out.

## Tests

`packages/core/test/git-repository.test.ts`, on repositories built in temporary directories with isolated config: environment and PATH filtering; the name-status and status parsers and the composition, as pure tables; not a repository; no git on PATH; added, modified, deleted, renamed (Cyrillic and spaces), staged, untracked and ignored files; committed-only; the base branch itself; a root below the top level; blob reading; an fsmonitor hook, a required filter, a filter named with `=`, a textconv driver and an external diff, each shown to run in a control and never to run through the module; a planted `git` with `.` on PATH; an inherited `GIT_DIR`; `.git/index` byte-identical, with a control showing porcelain `diff` rewrites it; invalid and unknown refs; base detection order; no commits; a shallow clone.

Not covered by a test: `dubious-ownership`, because simulating another owner needs a second account; the branch matches git's untranslated message.

## Still open

Draft the change to `.agents/rules/security.md` — its Command Execution section gains read-only `git` with the environment above as the one command core runs — and to `.agents/rules/architecture.md` (core owns git access), and discuss both with the user before phase 03 merges.

## Done when

- [x] Core exports the git module with typed results and typed unavailability reasons.
- [x] No git call goes through a shell, writes under `.git`, or runs a program from repository config, and a test proves each.
- [x] Paths are repository-relative POSIX from the viewer root, prefix applied in one place.
- [x] Base resolution, merge-base, changed paths and blob reading are covered on fixture repositories.
- [ ] The rules changes are agreed with the user.
