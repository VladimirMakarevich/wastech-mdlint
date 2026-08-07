# Field test — running the CLI against an external repository (2026-08-05)

> **Status:** Plan, not yet executed · **Created:** 2026-08-05 · **Roadmap:** [v2 Index](index.md)
>
> This is the executable form of the end-to-end smoke in [PR.05 step 2](P-release/05-release-verification.md): install the packed CLI into a real, unrelated repository and drive `init` → `lint` → `graph`/`slice`/`impact` → `compile` → MCP against documentation nobody wrote for our fixtures. Its purpose is to find defects the in-repo suite structurally cannot see, in the same spirit as the [process-boundary guards](../../.agents/rules/testing.md#process-boundary-guards) — a repository we do not control is a boundary too.

## Why this exists

Every test in this repo runs against a fixture we authored. A corpus we did not author differs in the ways that break tools: nested `.gitignore` files, vendored Markdown inside build directories, 90 KB single documents, checklists with hundreds of unchecked items, and cross-links written by hand over months. This plan fixes a target, records the corpus facts up front so a wrong file count is detectable rather than plausible, and escalates rule families one at a time so a finding can be judged as a true positive rather than counted.

The target for this first run is a private Angular/.NET monorepo (referred to below as the **target repo**) with 202 tracked Markdown files across `docs/`, `mobile/docs/`, `backend/docs/`, `.claude/skills/`, and `tasks/`. Nothing in the plan is specific to it except the numbers in [Reconnaissance](#reconnaissance-verified-2026-08-05); re-run that section against any other target and the rest holds.

## Setup

```bash
MDLINT_REPO=/path/to/wastech-mdlint
TARGET_REPO=/path/to/target-repo
SB=/tmp/mdlint-field-test          # install sandbox; must be outside both repos
mkdir -p "$SB"
```

## Safety rules

1. Anything that writes to the target repo (`init`, `--fix`, `compile` without `--dry-run`) happens on a throwaway branch, created from a clean tree.
2. Never install into the target repo. The CLI runs from the sandbox in `$SB`, so the target's `package.json` and `node_modules` are never touched. This is also more honest: it is the packed artifact under test, not the workspace.
3. `compile` runs `--dry-run` first, then with an explicit `--outdir` inside `$SB`. Its default outdir is `.claude/skills/wastech-mdlint/`, and a repo that already uses Claude Code has real content there.
4. After each phase: `git -C "$TARGET_REPO" status --short` — expected empty except for the writes the phase intended.

## Reconnaissance (verified 2026-08-05)

Facts checked by running the commands, not inferred. Re-derive these for a different target before trusting any expected count below.

| Fact | Value | Why it matters |
| --- | --- | --- |
| Local Node | `v24.8.0`, while `engines` requires `>=24.17.0` (`.nvmrc` pins 24.17.0); no version manager installed | See [Phase 0](#phase-0--decide-the-node-line) |
| Engine enforcement | `npm i` emits `EBADENGINE` warnings only and exits `0` — no `.npmrc` sets `engine-strict`, and nothing checks the version at runtime | The pin is advisory in practice; worth recording as a finding candidate |
| Local install of internal deps | `npm pack` of `cli` + `core` installed together in one `npm i` resolves `@wastech-mdlint/core@0.0.0` from the local tarball, links the `wastech-mdlint` bin, and runs — verified | Unblocks the whole plan; installing the `cli` tarball alone would try the registry and fail |
| Target corpus | 202 tracked `.md`; 323 `.md` excluding `node_modules` | The gap is the discovery test. 323 excludes `node_modules` **only** — the linter's default `exclude` prunes eleven more directory names (dependency and build trees, dot-prefixed or not), so re-derive this per target rather than reusing 323 as "what a zero-config run should report" |
| Ignored Markdown | ~87 files under a root-`.gitignore` directory; 33 under `mobile/ios/App/Pods`, ignored by a **nested** `mobile/ios/.gitignore` | Exercises nested-ignore handling, not just the root file |
| Largest documents | 96 KB, 86 KB, 66 KB, 63 KB, 54 KB | `SIZE-001` and `LLM-001` have real inputs |
| Pre-existing tooling | The target already has `.markdownlint.json` and `.prettierrc.json` (`proseWrap: never`) | Findings should not simply restate what markdownlint already reports |

---

## Phase 0 — decide the Node line

`node -v` is below the `engines` floor. Either proceed (the warnings are non-fatal and no runtime guard exists) or install the pinned 24.17.0.

Recommended: proceed, and record "engines pins a version above the developer's own, with no runtime check" as a finding candidate. If anything fails in a way that smells version-dependent, install 24.17.0 and re-run that step before writing it up.

## Phase 1 — build and self-verify

```bash
cd "$MDLINT_REPO"
npm ci
npm run typecheck    # tsc -b; emits, so it must precede the tests that spawn dist/
npm test
npm run build
npm run lint && npm run format
```

Anything red here is a finding before the field test starts, and blocks the phases below. Record the wall-clock time of `npm test` for comparison against the field runs.

## Phase 2 — install the packed artifacts

```bash
cd "$MDLINT_REPO"
npm pack -w @wastech-mdlint/core -w @wastech-mdlint/cli -w @wastech-mdlint/mcp-server --pack-destination "$SB"
cd "$SB" && printf '{"name":"mdlint-field-test","private":true,"version":"1.0.0"}\n' > package.json
npm i ./wastech-mdlint-*.tgz       # all tarballs in one call, so internal deps resolve locally
export MDLINT="$SB/node_modules/.bin/wastech-mdlint"
export MDLINT_MCP="$SB/node_modules/.bin/wastech-mdlint-mcp"
cd "$TARGET_REPO" && "$MDLINT" --version && "$MDLINT" --help
```

What this checks: the `files` allowlist (is `schema.json` there? is anything missing from `dist`?), bin linking, and that the entrypoint guard admits a spawn through the `node_modules/.bin` symlink rather than a real path.

Also inspect the payload — `tar -tzf wastech-mdlint-cli-0.0.0.tgz` — for anything missing or unintended.

## Phase 3 — zero-config smoke

```bash
cd "$TARGET_REPO"
time "$MDLINT" lint . --format json > "$SB/00-zeroconfig.json"; echo "exit=$?"
node -e 'const r=require(process.argv[1]);console.log(r.summary,"files:",r.files.length)' "$SB/00-zeroconfig.json"
```

Expected: exit `0`, zero findings (the zero-config ruleset is empty), and **323 files minus any Markdown under a default-excluded tree** — `.gitignore` is still not honored by default. The 323 in the reconnaissance table excludes `node_modules` alone, while the [default `exclude`](../guide/configuration.md#what-is-excluded-before-you-write-anything) is 12 depth-agnostic globs (the noise directory names, dependency and build trees only), so treat 323 as the upper bound and subtract the target's own `build`/`dist`/`out`/`coverage`/`vendor`/`target`/`.next`/`.cache`/`.venv`/`.yarn` Markdown. That subtraction is target-specific, which is why the load-bearing assertion below is count-independent. Since [P14.03](P14-host-boundary/03-init-disclosure.md) resolved W-15, dot-directory Markdown is **not** subtracted: `.claude/`, `.agents/` and the two `.rules/` sets are in a zero-config corpus.

Then look at _which_ files. **No** default-excluded segment may appear at any depth — not `node_modules`, and not build or vendor output either:

```bash
node -e 'const r=require(process.argv[1]);const noise=["node_modules",".git","dist","build","out","coverage","vendor",".next",".cache",".venv",".yarn","target"];const bad=r.files.filter(f=>f.split("/").slice(0,-1).some(s=>noise.includes(s)));console.log("unpruned:",bad.length,bad.slice(0,5))' "$SB/00-zeroconfig.json"
```

Expected `unpruned: 0 []`. Only _directory_ segments are checked, mirroring the globs, which match a directory's contents and not a root dotfile such as `.README.md`. Record the wall-clock time over the Markdown that survives the prune — a number that is no longer comparable to the pre-P13.02 ~2.4 MB.

Determinism: run it twice and `diff` the two JSON files. A byte difference is a finding.

## Phase 4 — `init` against a repository it did not design

```bash
cd "$TARGET_REPO" && git checkout -b mdlint-field-test
"$MDLINT" init . --yes             # without --yes it requires a TTY; --yes defaults --on-existing to skip
git diff --stat && git status --short
```

Check against the documented contract:

- `$schema` resolves to a local path. With nothing installed in the target, `init` should generate a project-local `schema.json` beside the config and point at it — no dangling ref, no remote URL.
- `exclude` covers the build and vendor directories the scan skipped, matched at any depth, and `respectGitignore: true` is written alongside it.
- The inferred clusters correspond to the real documentation areas, and each enabled rule carries a rationale comment.

Then the load-bearing corpus check:

```bash
"$MDLINT" lint . --format json > "$SB/01-init.json"
```

Expected **202 files** — 323 minus everything the root and nested `.gitignore` files exclude. Any third number points straight at nested-ignore or exclude-glob handling; capture the actual file list and diff it against `git ls-files '*.md'` to name the discrepancy precisely. The run measured **139**, and that 63-file gap is not an ignore bug: it is `"**/.*/**"` dropping `.claude/`, `.agents/`, and two `.rules/` sets, silently. [P14.03](P14-host-boundary/03-init-disclosure.md) closed both halves — the glob is gone from the lint-time default (W-15), and `init` now discloses what its scan skipped, per reason (W-14) — so a re-run of this phase should measure the tracked 202 and the dot-directories should appear in Phase 3's corpus too.

Idempotency and dispositions:

- Re-run `init . --yes`: it should report `skip` and leave `schema.json` untouched.
- Run `--on-existing merge`: it must warn that JSONC comments are not preserved, keep every existing rule/severity/option, and append only new ones.

## Phase 5 — rule families, one at a time

Enable one family, run `lint --format json`, then read three to five findings by hand. The question is never "how many" — it is "is this a real defect, and does the message let a reader fix it without opening our source". Log false positives and unclear messages as findings of their own.

| Order | Family | What the target exercises |
| --- | --- | --- |
| 1 | `REF-001`/`REF-002`/`REF-003` | Densely hand-linked docs across four areas — the likeliest source of true positives |
| 2 | `SIZE-001` | The 96 KB and 86 KB documents; also sanity-check the token estimate against the byte count |
| 3 | `CTX-001`/`CTX-002` | Progress files with hundreds of unchecked boxes — the likeliest source of noise |
| 4 | `GRP-001`/`GRP-002` | Cycles and orphans at project scope; watch the recursion depth note in the README's limitations and record the timing |
| 5 | `SEC-001`/`SEC-002` | Skill and task files, which have a strict expected heading structure |
| 6 | `LLM-001` | `CLAUDE.md`/`AGENTS.md` use eager `@` imports — confirm the imports are recognized at all before judging the budget |
| 7 | `custom` | One or two declarative rules over real tables: `columnNotEmpty`/`requiredColumns` on a progress table, `columnInSet` on task statuses |

## Phase 6 — graph, slice, impact, fix, exit codes

```bash
"$MDLINT" graph . --format human | head -60
"$MDLINT" graph . --format json > "$SB/graph.json"
"$MDLINT" graph . --format mermaid > "$SB/graph.mmd"    # confirm it renders somewhere
"$MDLINT" slice docs/glossary.md --depth 2
"$MDLINT" slice '#some-heading-slug' --depth 1          # exact match only, never fuzzy
"$MDLINT" slice does-not-exist.md                       # honest empty result, exit 0
"$MDLINT" impact docs/architecture/the-biggest-doc.md
"$MDLINT" impact src/some.ts                            # outside the corpus: exit 2 with a hint
```

Judge the clusters, hubs, and reading order against what a maintainer of that repo would say. Confirm repo-relative POSIX paths throughout, and re-run each command to confirm byte-identical output.

Exit codes — `1` must be reserved for findings:

```bash
"$MDLINT" lint . --fail-on error   ; echo "exit=$?"   # 0 or 1
"$MDLINT" lint . --fail-on warning ; echo "exit=$?"   # 1 once warnings exist
"$MDLINT" lint . --fail-on off     ; echo "exit=$?"   # 0
"$MDLINT" lint ./nope              ; echo "exit=$?"   # 2
"$MDLINT" lnit .                   ; echo "exit=$?"   # 2 — a typo'd subcommand is not a path
```

`--fix` (only `SEC-001` and `TBL-002` are fixable), on the branch:

```bash
"$MDLINT" lint . --fix && git diff --stat
"$MDLINT" lint . --fix && git diff --stat    # second run must be a no-op
```

Check the diffs for preserved line endings and no incidental reformatting. Then test inline suppression: add a `wastech-mdlint-disable` directive for one rule in one file and confirm it silences exactly that finding.

## Phase 7 — `compile`

```bash
"$MDLINT" compile --cwd . --dry-run | head -80
"$MDLINT" compile --cwd . --outdir "$SB/skill-out"
```

With no `compile` section in the config, expect exit `2` and actionable guidance rather than a stack trace. Add the section, then verify two runs produce a byte-identical `SKILL.md`, and read the output as an agent would: is it usable context for that repo, or a table of contents?

## Phase 8 — MCP server

Add the sandboxed bin to the target's `.mcp.json` on the branch, then exercise all six tools: `lint`, `lint-files`, `context-graph`, `context-slice`, `impact-analysis`, `compile-context`. Confirm `structuredContent` where documented and the `{ code, message, hint }` error contract. Note the known gap: input the tool's own `inputSchema` rejects returns raw `InvalidParams` text with no `structuredContent`, bypassing that contract — confirm whether it still reads acceptably to a host.

A host is not required for a first pass:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | (cd "$TARGET_REPO" && "$MDLINT_MCP")
```

## Findings log

One entry per finding, in `$SB/NOTES.md`:

```
### F-NN <short title>
severity: blocker | major | minor | polish
command: <exact argv>  (cwd=<where>)
expected: … | actual: … | exit: …
repro: minimal fixture (a few lines of Markdown), not "the whole target repo"
where to fix: packages/<pkg>/src/…
```

The deliverable is that log plus a severity-ordered summary. A finding without a minimal repro is not yet a finding — it is an observation, and it stays flagged as one until reduced.

## Cleanup

```bash
cd "$TARGET_REPO" && git checkout - && git branch -D mdlint-field-test
git status --short      # expected empty
```

`$SB` lives outside both repositories, so nothing needs removing from either checkout.
