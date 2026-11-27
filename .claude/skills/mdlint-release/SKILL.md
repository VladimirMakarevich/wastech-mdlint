---
name: mdlint-release
description: Release wastech-mdlint end to end - audit what merged since the last tag, fill in the CHANGELOG, pick the version, bump all four packages and their pins, run the full gate, open and merge the release PR, push the vX.Y.Z tag that publishes to npm, confirm the registry, and create the GitHub release. Use when the user asks to release, cut, ship or publish a new version of this repository's packages.
argument-hint: "[X.Y.Z | patch | minor | major]"
---

# mdlint-release

The whole release of `@wastech-mdlint/core`, `cli`, `mcp-server` and `viewer`, which ship together at one version from one `vX.Y.Z` tag. Speak in the user's language. Keep the task list current, and run anything that takes more than a minute or two (the test suite, a CI wait, the publish wait) in the background.

**What publishes.** Pushing the tag runs `.github/workflows/publish.yml`, which checks the tag against every manifest, runs the full gate, and publishes the four packages through npm trusted publishing (OIDC, with provenance), `core` first. Nothing is ever published from this machine: `npm publish` here has no credential and would bypass the gate and the provenance. An npm version can never be republished or reused, so a tag pushed by mistake cannot be taken back.

**The one stop.** Everything up to an open, green release PR is preparation and runs without asking. Merging the PR and pushing the tag publish irreversibly, so before them ask the user for an explicit go-ahead in chat, naming the version and why. Skip the question only when the user's own message that started this release already said to go all the way (for example "release and publish, no need to ask"); a version given as the argument is the version, not that permission.

## 1. Preflight

1. `git status --porcelain` is empty and the branch is `main`; `git fetch --tags origin` and `git pull --ff-only`. Stop on uncommitted changes - they are the user's, never stash or discard them.
2. `gh auth status` works. `gh repo view --json nameWithOwner` gives `<owner>/<repo>` for links and merge subjects.
3. The last release tag: `git tag --sort=-v:refname | head -1`. Every version tag must be on `main`'s history (`git merge-base --is-ancestor <tag> HEAD`).
4. What merged since: `git log --oneline --first-parent <tag>..HEAD`. If nothing did, say so and stop.

## 2. Audit the changelog

`CHANGELOG.md` is one entry per version for all four packages. The PRs that landed rarely all wrote their entry, so check every one:

1. For each merge since the tag, read its commit messages (`git log --format='%h %s%n%b' <merge>^1..<merge>^2`), its diff stat, and the user-facing documentation it changed (`README.md`, `packages/*/README.md`, `docs/guide/`). Those READMEs describe behavior in the same voice the changelog uses, so they are the best source for an entry.
2. Find each user-visible change `[Unreleased]` does not cover yet and write the missing entry. A PR titled `chore`, `docs` or `refactor` can still change output: grep the non-comment lines of its `packages/*/src` diff for changed strings (messages, prompts, generated file text) before deciding it needs no entry.
3. Match the existing style: plain prose for the user, one bullet per change, under `### Added`, `### Changed`, `### Fixed` or `### Security`, with the observable behavior, the flag, field or URL parameter it is reached by, and what stays compatible. No PR numbers, no internal refactors, no test-only changes. A change that breaks code calling `@wastech-mdlint/core`, a CLI flag or output contract, an MCP schema, or the config gets a one-line `Breaking for …` sentence at the top of the version, as earlier versions have.

## 3. Pick the version

- An `X.Y.Z` argument is used as given (it must be greater than the last tag). `patch`, `minor` or `major` picks the part to bump.
- Otherwise derive it from the audited changelog, by semver. Before `1.0.0`: a breaking change or any `Added` entry is a minor bump (`0.4.1 → 0.5.0`); only `Fixed` and `Security` is a patch (`0.4.1 → 0.4.2`). From `1.0.0` on: breaking is major, added is minor, fixed is patch.
- Write down the one-line reason. It goes into the PR and into the question before merging, because a reader who sees `0.5.0` instead of `0.4.2` will ask why.

## 4. Prepare the release commit

On a branch `chore/release-X.Y.Z` off `main`. With `OLD` the last version and `NEW` the new one:

| File | Change |
| --- | --- |
| `packages/{core,cli,mcp-server,viewer}/package.json` | `"version": "NEW"` |
| `packages/{cli,mcp-server,viewer}/package.json` | the exact pin `"@wastech-mdlint/core": "NEW"` - the publish job publishes `core` first precisely because these pins are exact |
| `package-lock.json` | `npm install --package-lock-only --ignore-scripts`; the diff must touch only the four workspace entries and the three pins |
| `README.md` | the `--pin vNEW` in the `gh skill install` example |
| `skills/*/SKILL.md` | `compatibility: "Requires @wastech-mdlint/cli NEW. …"` - a shipped skill and the CLI it drives carry the same version |
| `CHANGELOG.md` | a new empty `## [Unreleased]`, the audited section renamed `## [NEW]`, and at the bottom `[unreleased]: …/compare/vNEW...HEAD` plus `[NEW]: …/compare/vOLD...vNEW` |

Then `git grep -n -F "OLD"` and look at every remaining hit: a release pin you missed is fixed, anything else (a test fixture, an example in the guide, an older changelog entry) is left alone.

## 5. Run the gate

The same steps in the same order as `publish.yml`: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`, `npm run build`, `npm run lint:docs`, `npm pack --dry-run --workspaces` (every package must report `version: NEW`). Run it in the background and read the log. Two failures on a Windows checkout are not the release's fault, and are handled without changing unrelated files:

- **`format` fails on files you did not touch.** With `core.autocrlf=true` some files sit in the work tree with CRLF while the index holds LF (`git ls-files --eol <file>` shows `i/lf w/crlf`), and an untracked cache file can be caught too. CI checks out LF and is unaffected. Confirm with `npx prettier --check $(git diff --name-only)` that your own files pass, run the remaining steps, and mention it in the report. Do not rewrite those files.
- **Test files fail at module load with "… is older than …".** `assertBuilt()` compares modification times and `tsc -b` skipped a rebuild because the content did not change. Run `npx tsc -b --force`, then the tests again.

Any other failure stops the release: report it with the output, and fix it only if the user asks - in its own PR, not the release commit.

## 6. Open the release PR

1. Commit with the message `chore: release NEW`, a blank line, then one `- ` line per notable change in a few words each. Push with `-u`.
2. `gh pr create --base main` with the title `Release NEW: <the two or three headline changes>`, and a body that lists what the commit changes, which merged PRs the changelog now covers and which entries you added, the version reason, the local gate result, and that the tag is pushed after merge.
3. If the app's PR tools are available, check that the session is bound to the PR (`get_status`, else `bind_pr`). Do not enable auto-merge.
4. Wait for the PR's checks with one background `gh run watch <run-id> --exit-status`, then `gh pr checks <n>`: every check, Windows and macOS included, must pass. A red check stops the release; report it.

## 7. Merge, tag, publish

Only after the go-ahead (see "The one stop"):

1. `gh pr merge <n> --merge --delete-branch --subject "Merge pull request #<n> from <owner>/chore/release-NEW"` - this repository merges with merge commits, and its remote does not delete merged branches by itself.
2. `git switch main && git pull --ff-only`. Check that `HEAD` is the PR's merge commit (`gh pr view <n> --json mergeCommit`) and that all four manifests read `NEW`, then `git tag vNEW` (a lightweight tag, like every earlier one) and `git push origin vNEW`. Delete the local release branch.
3. Find the run: `gh run list --workflow publish.yml --branch vNEW --limit 1`, and wait on it with `gh run watch <id> --exit-status` in the background. Confirm in its log a `+ @wastech-mdlint/<package>@NEW` line for each of the four.
4. Confirm the registry: `https://registry.npmjs.org/@wastech-mdlint%2f<package>/NEW` answers 200 and `dist-tags.latest` is `NEW`, for all four. The registry usually lags the publish by one to two minutes, so poll it in the background every 30 seconds for up to 15 minutes before calling it a problem.

**If the publish run fails,** do not bump the version or move the tag. Each publish step skips a version the registry already has, so after fixing the cause the same run is re-run with `gh run rerun <id> --failed` and picks up where it stopped. A failure before any package published (the tag check, the gate) is reported to the user first: the fix lands on `main` and the tag has to move to it, which only they decide, and only while nothing at that version is on npm.

## 8. Create the GitHub release

Like every earlier release: the title is the tag, the body is the `## [NEW]` section of `CHANGELOG.md` at the tag without its heading, and nothing is attached.

```bash
git show vNEW:CHANGELOG.md | awk '/^## \[NEW\]/{f=1;next} /^## \[/{f=0} f' > <scratchpad>/notes-NEW.md
gh release create vNEW --verify-tag --title vNEW --latest --notes-file <scratchpad>/notes-NEW.md
```

Trim the blank lines at the start and end of the notes file and read it before publishing. Check with `gh release list --limit 2` that it is marked Latest.

## 9. Report

The version and its reason, the PR link, the tag and merge commit, the publish run, the four packages at `latest`, the GitHub release link, and anything that did not go to plan (a local-only gate failure and why it was safe, a registry delay, a re-run).
