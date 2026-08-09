# Field-test playbook — running the tool against any real repository

> **Status:** Reusable playbook · **Scope:** target-agnostic — nothing below names a specific repository · **Companion:** the first dated run of this shape is [field-test-2026-08-05-debates.md](field-test-2026-08-05-debates.md) with its [results](field-test-2026-08-05-debates-results.md).

## What this is

A phase-by-phase procedure for installing the packed CLI and MCP server into a repository we did not author and driving **every** shipped surface across it: discovery, config, all 22 built-in rules plus the declarative `custom` rule, suppression, `--fix`, the four output formats, `graph`/`slice`/`impact`, `compile`, `init`, `schema`, and all six MCP tools.

It exists because every test in this repository runs against a fixture we wrote. A corpus we did not author differs in exactly the ways that break tools: nested `.gitignore` files, vendored Markdown under build directories, 90 KB single documents, checklists with hundreds of unchecked boxes, hand-written cross-links accumulated over months, CRLF files, and non-Latin prose. That is the same reasoning behind the [process-boundary guards](../../.agents/rules/testing.md) — a repository we do not control is a boundary too.

Two properties make it re-runnable on a different project:

- **No expected number is hard-coded.** Phase 3 derives the corpus facts for whatever target you point it at, and every later expectation is written as a formula over those facts or as a count-independent invariant.
- **Every phase is a checklist with an exit criterion.** A phase is either green, or it produced a finding; there is no third state.

## How to use it

Copy this file into the run directory, fill in the record tables and tick the boxes as you go. The ticked copy plus the findings log **is** the deliverable — this tracked file stays blank so the next target starts clean.

### Variables

```bash
MDLINT_REPO=/path/to/wastech-mdlint          # this repository
TARGET_REPO=/path/to/target-repo             # the repository under test
RUN=$TARGET_REPO/mdlint-field-test           # run directory, inside the target
mkdir -p "$RUN"
```

**The tool is installed into the target, and the run lives there too.** That is the scenario under test: a maintainer adds this CLI to their repository, runs it over their own documentation, and keeps a config. Installing it anywhere else would test a shape no user has — the target's own `node_modules`, its package manager, its lockfile, and its `.bin` linking are all part of what can break. Two consequences to keep straight rather than avoid: the target's manifest and lockfile change (Cleanup restores them, and everything happens on a throwaway branch), and the target's `node_modules` becomes part of what the linter must prune — which is the strongest possible input for Phase 4's default-exclude check, since the noise is now real and at the repository root.

What is **not** installed is the workspace. Phase 2 packs the three tarballs and installs those, so what runs is the published artifact with its `files` allowlist, not a symlink into a build tree — a `dist/` file missing from the package is invisible to any test that runs from the source checkout.

After Phase 2 you will also have:

```bash
export MDLINT="$TARGET_REPO/node_modules/.bin/wastech-mdlint"
export MDLINT_MCP="$TARGET_REPO/node_modules/.bin/wastech-mdlint-mcp"
```

### Conventions

- Every artifact (JSON reports, generated configs, tarballs, diffs) is written under `$RUN`, numbered by phase, so a later phase can diff against an earlier one.
- `NN-name.json` naming: the phase number first, so `ls "$RUN"` reads as the run's history.
- **Commit at the end of every phase**, on the throwaway branch, with the phase number in the message. Nothing is hidden from git: the dependency, the lockfile, the generated config, the reports and the fixes all land in the repository exactly as they would for a maintainer adopting the tool. The per-phase commit is what keeps `git status --short` a usable "did this phase write something I did not ask for" signal, and it leaves the branch as a readable log of everything the tool did to a real repository.
- The corpus baseline therefore comes from the **pre-run commit**, not from the working tree: `git ls-tree -r <recorded HEAD> --name-only` is the target's own Markdown, uninflated by the run's own reports. Phase 3 records both that number and the run directory's own file count, so Phase 4 can subtract one from the other.
- The run directory's own Markdown is real Markdown on disk, so it enters a zero-config corpus and would otherwise be linted as if it were the target's documentation. Every config from Phase 5 onward excludes it.
- A phase that writes into `$TARGET_REPO` says so in its Goal. Everything else is read-only.
- **Judge, do not count.** For every rule family the question is never "how many findings" but "is this finding real, and can a reader fix it without opening our source". A confusing message is a finding of its own.

## Safety rules

1. Everything happens on a throwaway branch created from a clean tree — the install, the writes from `init`, `--fix` and `compile`, and the run directory.
2. **Install the packed tarballs, never a workspace link.** `npm link` or a `file:` reference to the checkout would hide exactly the defects Phase 2 exists to find: a missing `files` entry, an unshipped `schema.json`, a bin that is not linked.
3. `compile` runs `--dry-run` first, then with an explicit `--outdir` inside `$RUN`. Its default outdir is `.claude/skills/wastech-mdlint/`, and a repo that already uses an agent host has real content there.
4. After every phase: read `git -C "$TARGET_REPO" status --short`, confirm every entry is something the phase meant to write, then commit it. A phase starts from a clean tree, so anything unexplained belongs to the command you just ran.
5. If the target is not a git repository, take a copy and run against the copy. Several phases rely on `git diff` to prove that a read-only command wrote nothing, and Cleanup relies on the branch to undo the install.

## Coverage matrix

Every shipped surface, and the phase that exercises it. A row with no tick at the end of a run is a gap in the run, not in the product.

| Surface | Exercised in | Done |
| --- | --- | --- |
| Packed payload, `files` allowlist, bin linking, entrypoint guard | Phase 2 | [ ] |
| Zero-config default corpus, the 12 default excludes, `.gitignore` default-off | Phase 4 | [ ] |
| `schema` command and local `$schema` resolution | Phase 5 | [ ] |
| JSONC parsing, config discovery, `--config` resolution, validation diagnostics | Phase 5 | [ ] |
| Glob anchoring, ordering, negation, `respectGitignore`, per-rule `files`/`exclude` | Phase 5 | [ ] |
| `init` inference, disclosure, dispositions, atomic writes, CI workflow | Phase 6 | [ ] |
| `TBL-001`…`TBL-006` | Phase 7 | [ ] |
| `SEC-001`, `SEC-002`, `SEC-003`, `STR-001` | Phase 7 | [ ] |
| `REF-001`…`REF-006`, `settings.siteRouter` | Phase 7 | [ ] |
| `CTX-001`, `CTX-002`, `CTX-003` | Phase 7 | [ ] |
| `GRP-001`, `GRP-002`, `GRP-003`, `settings.idRef` | Phase 7 | [ ] |
| `SIZE-001`, `LLM-001` (the two budget rules) | Phase 7 | [ ] |
| `custom` rule — all 13 assertion kinds | Phase 8 | [ ] |
| Inline suppression (3 directive forms + the all-rules form) | Phase 9 | [ ] |
| `--fix` (SEC-001, TBL-002), idempotency, line endings, scope bounds | Phase 9 | [ ] |
| Text vs JSON output, message keys, host parity | Phase 10 | [ ] |
| `--fail-on` thresholds and the 0/1/2 exit-code taxonomy | Phase 10 | [ ] |
| `graph` in `human`/`json`/`mermaid`/`dot` | Phase 11 | [ ] |
| `slice` by id, `#slug`, path; `--depth`; empty result | Phase 11 | [ ] |
| `impact` in-corpus and out-of-corpus | Phase 11 | [ ] |
| `compile` — dry-run, outdir, `--cwd`, determinism, section gating | Phase 12 | [ ] |
| MCP: 6 tools, `structuredContent`, error contract, path-escape guard | Phase 13 | [ ] |
| Scale, determinism, CRLF, non-Latin token estimate, cross-platform paths | Phase 14 | [ ] |

---

## Phase 0 — environment

**Goal:** remove version noise from every later result.

```bash
node -v && npm -v
node -e 'console.log(process.platform, process.arch)'
grep -n '"node"' "$MDLINT_REPO/package.json"
```

- [ ] `node -v` meets the `engines` floor in the root `package.json`. If it does not, either install the pinned line or record "ran below the floor" at the top of the findings log so a version-dependent failure is recognizable later.
- [ ] `git -C "$TARGET_REPO" status --short` is empty before starting, and the run is on a throwaway branch: `git -C "$TARGET_REPO" checkout -b mdlint-field-test`.
- [ ] **Record the pre-run branch and HEAD sha.** Everything else depends on it: Cleanup returns there, and Phase 3's corpus baseline is read from that commit rather than from a working tree the run is about to add files to.
- [ ] Record whether the target already has a root manifest, a lockfile, and which package manager it uses. A repository with no root `package.json` gets one created by the install, and that also decides which of `init`'s two `$schema` paths Phase 6 will exercise — the installed-package one, or the fallback that generates a project-local `schema.json`.

**Record:** Node `____` · npm `____` · platform `____` · target HEAD `____`

**Exit criterion:** the run is pinned to a known toolchain and a clean target tree.

## Phase 1 — build and self-verify the tool

**Goal:** anything red here is a finding _before_ the field test starts, and blocks every phase below.

```bash
cd "$MDLINT_REPO"
npm ci
npx tsc -b --force     # not `npm run typecheck`; see the note below
npm test
npm run build
npm run lint
npm run format
npm run lint:docs      # the tool over its own docs
```

**Force the build rather than reacting to it.** `npm run typecheck` is `tsc -b`, which decides up-to-dateness from file **content**, while the suites that spawn `dist/` compare **mtimes**. Any git operation that rewrites a source file's timestamp without changing its bytes — a branch switch, a stash pop, a `git checkout --` — leaves the two disagreeing, and the symptom is a test failing at module scope long after a `typecheck` that exited `0` in about a second. Starting from `--force` costs a few seconds and removes the whole class; if you skip it and see the stale-`dist` message, that is what it means.

- [ ] `npm ci` clean; record the advisory count, then split it: `npm audit --omit=dev` is the number that matters, because that subset ships to anyone installing the packages. Record both, and name the dependency each production-tree advisory arrives through (`npm audit --omit=dev --json` carries the chain).
- [ ] `npm test` green; record the wall-clock time and the passed/skipped counts.
- [ ] Skipped tests **enumerated**, not just counted: `npx vitest run --reporter=verbose` and read the `↓` lines. A platform-gated guard skipping on your OS is expected; anything else skipping is a finding, and only the names make the difference visible.
- [ ] `npm run lint`, `npm run format`, `npm run lint:docs` all green.

**Record:** test wall-clock `____` · passed `____` · skipped `____` (which: `____`) · advisories total `____` / production `____`

**Exit criterion:** the workspace is green on the machine that will run the field test.

## Phase 2 — pack and install as a consumer would

**Goal:** install the published artifact into the target, the way a maintainer would. This phase **writes** to the target: a `node_modules` tree, a lockfile, and (in a repository that has none) a root `package.json`. It is the only phase that can see a broken `files` allowlist, a missing `schema.json`, a dangling sourcemap, or a bin that does not link.

```bash
cd "$MDLINT_REPO"
npm pack -w @wastech-mdlint/core -w @wastech-mdlint/cli -w @wastech-mdlint/mcp-server --pack-destination "$RUN"
cd "$TARGET_REPO"
[ -f package.json ] || npm init -y                      # only when the target has no root manifest
npm i -D "$RUN"/wastech-mdlint-*.tgz                    # all tarballs in ONE call, so internal deps resolve locally
export MDLINT="$TARGET_REPO/node_modules/.bin/wastech-mdlint"
export MDLINT_MCP="$TARGET_REPO/node_modules/.bin/wastech-mdlint-mcp"
"$MDLINT" --version && "$MDLINT" --help
npx wastech-mdlint --version                            # the way a maintainer will actually invoke it
for t in "$RUN"/*.tgz; do echo "== $t"; tar -tzf "$t"; done
```

- [ ] All three tarballs install in one `npm i`; installing the CLI tarball alone would go to the registry for `@wastech-mdlint/core` and fail.
- [ ] The install does not disturb the target's own dependencies — in a repo that already had a manifest, `git diff package.json` shows only the three added devDependencies.
- [ ] Both bins are linked into `$TARGET_REPO/node_modules/.bin` and are executable, and `npx <bin>` resolves them from the target's cwd.
- [ ] `--version` prints a version and exits `0`; `--help` lists every command in the CLI reference ([CLI reference](../guide/cli.md)).
- [ ] The entrypoint guard admits a spawn through the `.bin` symlink — a real path is not what a consumer runs.
- [ ] Payload inspection: `schema.json` present in the CLI tarball; `dist/` complete; no `src/`-referencing sourcemaps that are not shipped; a README and LICENSE where the package claims one; `repository` declared.
- [ ] Nothing unintended is shipped (test fixtures, `.tsbuildinfo`, local config).
- [ ] The target's `.gitignore` covers `node_modules/` — add it if the repository had no root install before, which is what an adopter does at this exact moment. That edit is part of the record, not a workaround.
- [ ] Commit the phase: the manifest, the lockfile, the `.gitignore` line, and the tarballs under the run directory. `git status --short` clean afterwards.

**Record:** payload sizes `____` · missing/unexpected entries `____`

**Exit criterion:** a consumer installing these three tarballs gets working bins and a resolvable local schema.

## Phase 3 — reconnaissance: record the corpus facts

**Goal:** make a wrong file count _detectable_ rather than plausible. Everything later is a formula over this table.

Read the baseline from the **pre-run commit**, so the run's own install and reports cannot inflate it. `BASE` is the HEAD recorded in Phase 0.

Write the baseline list to a file once and drive every probe off it, so nothing is measured against a different corpus than the counts were.

```bash
cd "$TARGET_REPO"; BASE=<the sha recorded in Phase 0>
git ls-tree -r "$BASE" --name-only | grep '\.md$' > /tmp/base-md.txt

wc -l < /tmp/base-md.txt                                       # tracked Markdown, pre-run
ls mdlint-field-test/*.md 2>/dev/null | wc -l                  # the run's own Markdown, to subtract later
git ls-files '*.md' | wc -l                                    # tracked Markdown, working tree
find . -name '*.md' -not -path '*/node_modules/*' | wc -l      # on-disk minus node_modules
find . -name '*.md' | wc -l                                    # on-disk including it, for the ratio
git ls-files --others --ignored --exclude-standard -- '*.md' | grep -v 'node_modules/' | wc -l
find . -name .gitignore -not -path '*/node_modules/*'          # nested ignore files
awk -F/ '{print $1}' /tmp/base-md.txt | sort | uniq -c | sort -rn   # documentation areas, by size
xargs < /tmp/base-md.txt wc -c | tail -1                       # total bytes
xargs < /tmp/base-md.txt ls -S | head -5                       # largest documents
```

The probes that decide **which rule families this target can exercise at all**. A zero here is not a gap in the run — it is a family to record as not applicable, with the count as the evidence:

```bash
xargs < /tmp/base-md.txt grep -l '^ *|'                        | wc -l   # tables        → TBL-*
xargs < /tmp/base-md.txt grep -lE '^ *[-*] \[[ xX]\]'          | wc -l   # checklists    → CTX-002
xargs < /tmp/base-md.txt grep -lE '\]\((\.\.?/|[A-Za-z0-9_-]+/)[^)]*\.md' | wc -l  # relative links → REF-001/002
xargs < /tmp/base-md.txt grep -lE '!\[[^]]*\]\('               | wc -l   # images        → REF-003
xargs < /tmp/base-md.txt grep -lE '@[A-Za-z0-9_./-]+\.md'      | wc -l   # eager imports → LLM-001
xargs < /tmp/base-md.txt grep -l '[А-Яа-яЁё]'                  | wc -l   # non-Latin     → token estimate
xargs < /tmp/base-md.txt file | grep -c CRLF                             # line endings  → --fix

# the ID vocabulary the target actually uses  → REF-005/REF-006/GRP-003/TBL-004
xargs < /tmp/base-md.txt grep -hoE '\b[A-Z]{2,4}-[A-Z]*-?[0-9]+\b' | sed -E 's/[0-9]+$/N/' | sort | uniq -c | sort -rn | head
# the column vocabulary its tables actually use  → TBL-001/002/003/005, and the custom rules
xargs < /tmp/base-md.txt grep -hE '^\s*\|' | grep -vE '^\s*\|[-: |]+\|\s*$' | tr '|' '\n' | sed 's/^ *//;s/ *$//' | grep -vE '^$|^-' | sort | uniq -c | sort -rn | head
grep -iE 'glossary|template' /tmp/base-md.txt                            # CTX-003, SEC-003 inputs
ls .markdownlint.json .prettierrc* .editorconfig 2>/dev/null             # pre-existing Markdown tooling
```

**Keep the probes portable.** `xargs -a <file>` and `grep -P` are GNU extensions that BSD userland (macOS) does not have, and both fail in the quiet way that matters here: with `2>/dev/null` on the pipeline, an unsupported flag prints nothing and the count reads `0` — indistinguishable from "this target has no tables". Use `xargs < file` and a bracket expression, and treat any probe that returns exactly `0` as a claim to verify by eye before recording it.

Fill this in from the commands, not from memory:

| Fact | Value | Why it matters |
| --- | --- | --- |
| Tracked `.md` at the pre-run commit |  | The target's real corpus, and the `respectGitignore: true` expectation |
| The run's own Markdown (run directory) |  | Present on disk from Phase 0 onward; subtracted from every zero-config expectation |
| On-disk `.md` minus `node_modules` |  | Upper bound for a zero-config run |
| Ignored `.md`, and how many via a **nested** `.gitignore` |  | Exercises nested-ignore handling, not just the root file |
| Markdown under dot-directories |  | Must be **inside** a zero-config corpus — nothing is excluded for starting with a dot |
| Markdown under `dist`/`build`/`out`/`coverage`/`vendor`/`target`/`.next`/`.cache`/`.venv`/`.yarn` |  | Subtracted by the lint-time default |
| Five largest documents (bytes) |  | Real inputs for `SIZE-001` |
| Documentation areas, by file count |  | What `graph`'s clusters should come out as, and what `init` should propose |
| Entry points (`README.md`, `AGENTS.md`, `CLAUDE.md`, …) |  | `GRP-002` exemptions and `LLM-001` entrypoints |
| Documents with tables / checklists / relative links / images / `@` imports |  | Which of TBL, CTX-002, REF-001/002, REF-003 and LLM-001 have inputs at all |
| ID vocabulary in use (`ABC-123` shapes, with counts) |  | Whether REF-005, REF-006, GRP-003 and `settings.idRef` are applicable, and what `idPattern` to write |
| Column vocabulary in use (most frequent table headers) |  | The real options for TBL-001/002/003/005 and the Phase 8 custom rules |
| Glossary / template documents present? |  | CTX-003 and SEC-003 inputs |
| Pre-existing Markdown tooling |  | A finding that only restates markdownlint is not a finding |
| Non-Latin (Cyrillic/CJK) prose, as a share of the corpus |  | The token estimate errs low there — Phase 14 |
| CRLF files present? |  | `--fix` must not rewrite line endings |

- [ ] Table filled from executed commands.
- [ ] The counts reconcile: tracked + gitignored (outside `node_modules`) + untracked = on-disk. If the three do not add up, one of the probes is measuring a different corpus than the others, and every expectation built on them inherits that.
- [ ] The default-excluded subtraction is computed for **this** target, not carried over from another run.
- [ ] Each rule family is marked applicable or not from a **measured** count, before Phase 7 runs it. A family with no inputs costs a real run otherwise, and its zero findings would read as a pass.

**Exit criterion:** every expectation below can be stated as a formula over this table.

## Phase 4 — zero-config run and the discovery contract

**Goal:** with no config file, the tool must lint the right _set_ of files and report nothing.

```bash
cd "$TARGET_REPO"
time "$MDLINT" lint . --format json > "$RUN/04-zeroconfig.json"; echo "exit=$?"
node -e 'const r=require(process.argv[1]);console.log(r.summary,"files:",r.files.length)' "$RUN/04-zeroconfig.json"
```

Count-independent invariant — no default-excluded directory segment may appear at any depth:

```bash
node -e 'const r=require(process.argv[1]);const noise=["node_modules",".git","dist","build","out","coverage","vendor",".next",".cache",".venv",".yarn","target"];const bad=r.files.filter(f=>f.split("/").slice(0,-1).some(s=>noise.includes(s)));console.log("unpruned:",bad.length,bad.slice(0,5))' "$RUN/04-zeroconfig.json"
```

Corpus diff in **both** directions against the tracked list (a matching total can still hide one file dropped and another gained):

```bash
node -e 'const r=require(process.argv[1]);console.log(r.files.map(f=>f.file??f.filePath??f).sort().join("\n"))' "$RUN/04-zeroconfig.json" > "$RUN/04-corpus.txt"
git ls-tree -r "$BASE" --name-only | grep '\.md$' | sort > "$RUN/04-tracked.txt"
diff "$RUN/04-tracked.txt" "$RUN/04-corpus.txt" | head -40
```

- [ ] Exit `0`, zero findings — the zero-config ruleset is empty, so a clean pass is the contract.
- [ ] File count equals (on-disk minus `node_modules`) minus Markdown under the other default-excluded trees, **plus** the run directory's own files, per the Phase 3 table. Every term is measured, so a mismatch names itself.
- [ ] `unpruned: 0` — the load-bearing assertion, and the one that stays true on any target. Since Phase 2 installed into the target, the `node_modules` this proves is pruned is a real one at the repository root, with the tool's own dependency tree inside it.
- [ ] Gitignored Markdown **is** present: `.gitignore` says what not to commit, not what not to lint, and it is off by default.
- [ ] Dot-directory Markdown (`.claude/`, `.agents/`, `.github/`) **is** present.
- [ ] Every path in the report is repository-relative and POSIX-separated, on every platform.
- [ ] Determinism: run it twice and `diff` the two JSON files — a byte difference is a finding.
- [ ] The two-directional diff is explainable line by line: the report's extras are the run's own files and anything untracked or gitignored, and the baseline's extras are files under a default-excluded tree. An entry that fits neither description is the finding this phase exists to produce.

**Record:** files `____` · wall-clock `____` · corpus bytes `____`

**Exit criterion:** the tool agrees with the Phase 3 table about what documents exist.

## Phase 5 — config surface

**Goal:** the config file is the product's largest input. Exercise its parsing, discovery, resolution, glob semantics, and its error messages — the errors especially, since a bad diagnostic is what makes a first adoption fail.

Keep these configs in `$RUN/cfg/` and pass `--config` explicitly, so the repository-level config that Phase 6 generates stays the one a maintainer would actually keep. Every config here excludes the run directory, since its Markdown is bookkeeping rather than the target's documentation.

```bash
"$MDLINT" schema --out "$RUN/05-schema.json" && head -20 "$RUN/05-schema.json"
```

- [ ] `schema --out` writes valid JSON, creates missing parent directories, echoes the path exactly as typed, and never emits a remote URL.
- [ ] The schema enumerates every rule id from the [rule table](../../README.md) and the `custom` entry shape.

Parsing and discovery:

- [ ] A config with `//` comments and trailing commas loads (JSONC).
- [ ] With no `--config`, discovery walks **up** from the analyzed directory and stops at the home directory.
- [ ] A relative `--config` resolves against the **analyzed** directory — `[path]` for `lint`/`graph`, the cwd for `slice`/`impact`, `--cwd` for `compile` — not against your shell. Verify from a third directory so the two bases are distinguishable.
- [ ] A missing relative `--config` is reported exactly as typed, not rewritten into a `../` chain nobody wrote.
- [ ] An absolute `--config` is used as given.

Glob semantics ([reference](../guide/configuration.md#glob-semantics)) — one config per case, each run over the same target:

- [ ] A pattern **with** a slash is anchored to the repository root; a pattern **without** one matches at any depth. Prove both with a directory name that exists at two depths.
- [ ] `exclude` wins over `include`.
- [ ] Entries apply in order and a leading `!` subtracts: an include of a tree minus one subtree lints the difference.
- [ ] A negation cannot reach **inside** an excluded directory — confirm the documented limit rather than assuming it works.
- [ ] Your own `exclude` is **appended** to the 12 lint-time defaults, so an empty array is not an opt-out and deleting a default entry changes nothing; negating one does. See [what is excluded before you write anything](../guide/configuration.md#what-is-excluded-before-you-write-anything).
- [ ] A pattern selecting non-Markdown (a bare `docs/**` over a tree with JSON in it) hands those files to the Markdown parser — confirm the behavior and how loudly it fails.
- [ ] `respectGitignore: true` reduces the corpus to the tracked count from Phase 3, honoring **nested** ignore files and their negations.
- [ ] Per-rule `files`/`exclude` narrows one rule without narrowing the run.

Validation diagnostics — every one of these must name the offending key **and** the file:

- [ ] Unknown top-level key.
- [ ] Unknown rule id, and a known id in the wrong case or without the dash (`ref-001`, `REF001`) — the latter two must be **accepted**, since ids are case-insensitive and dash-optional.
- [ ] `severity: "warn"` (the near-miss of `"warning"`) — the message must list the allowed values.
- [ ] `severity: "off"` disables a rule while leaving it documented in the file.
- [ ] Rule options that violate the rule's own schema (a `SIZE-001` entry with no metric at all; a `TBL-003` with an empty `values`).
- [ ] Malformed JSONC (an unterminated string) — the error names the file and a position.
- [ ] An unreadable config file — exit `2`, not a stack trace.

**Exit criterion:** every diagnostic above identifies what to change without reading our source.

## Phase 6 — `init`

**Goal:** first-run experience against a repository the tool did not design. This phase **writes** — branch first.

```bash
cd "$TARGET_REPO" && git checkout -b mdlint-field-test
"$MDLINT" init . --yes            # without --yes it requires a TTY on both stdin and stdout
git status --short && git diff --stat
"$MDLINT" lint . --format json > "$RUN/06-init.json"
```

Draft and disclosure:

- [ ] The draft prints an **Excluded from the scan** block with one line per reason (hidden directories with a file count, build/dependency directories, gitignored directories) _before_ the write.
- [ ] The inferred clusters correspond to the real documentation areas a maintainer would name.
- [ ] Each enabled rule carries a rationale comment.
- [ ] The draft names the schema file, not just the config, including which of the two reasons applies when one has to be generated.
- [ ] `SIZE-001` and `LLM-001` are **not** proposed, and the draft says why (a budget it cannot measure would be an invented threshold).

The written file:

- [ ] `$schema` is a **local** path that exists — the installed package schema when one is installed, a generated project-local `schema.json` in the `npx` case, and always project-local when custom rules are present. Never a URL.
- [ ] `exclude` lists the noise directories as depth-agnostic globs, and a comment says the list is visible-not-established (negate, do not delete).
- [ ] `respectGitignore: true` is written on a fresh write.
- [ ] Writes are atomic: no temp file survives, and a partial failure leaves the config byte-unchanged.

Corpus check — the load-bearing one:

- [ ] The post-`init` corpus equals the tracked count from Phase 3, or the difference is explainable entry by entry against `git ls-files '*.md'`. A third number points straight at nested-ignore or exclude-glob handling.

Dispositions and idempotency:

- [ ] Re-run `init . --yes`: reports `skip`, writes nothing, exits `0`, and leaves `schema.json` untouched.
- [ ] `--on-existing merge` warns that JSONC comments are lost, keeps every existing rule/severity/option, and only appends.
- [ ] `--on-existing merge` over a config that cannot load **aborts** and exits `2` — a CI step that wrote nothing must not report success.
- [ ] `--on-existing overwrite` replaces the config but still does not replace an existing `schema.json`.
- [ ] `init` on a subdirectory path only counts a config at exactly that directory; the bare invocation lets an ancestor config govern and reports its path relative to your cwd.
- [ ] Deselecting every cluster (interactive) writes a literal empty `include`, not a repo-wide one.
- [ ] Interactive run without a TTY fails fast instead of hanging; Ctrl+C at a prompt exits `0`; pressing Enter lands on the safe default.
- [ ] `--with-ci-workflow` (under `--yes`) writes a workflow that installs the CLI via npm regardless of the detected package manager, and never overwrites an existing one.

**Record:** proposed rules `____` · corpus after init `____` · schema disposition `____`

**Exit criterion:** a maintainer of the target would keep the generated config with at most cosmetic edits.

## Phase 7 — rule families, escalated one at a time

**Goal:** true-positive rate and message quality, per family. Enable **one** family, run `lint --format json`, then read three to five findings **by hand** against the documents they name.

Configs for each row are in Appendix A. Run each as `"$MDLINT" lint . --config "$RUN/cfg/<family>.json" --format json > "$RUN/07-<family>.json"`.

| Order | Family | What to look for | Findings judged | Done |
| --- | --- | --- | --- | --- |
| 1 | `REF-001` `REF-002` `REF-003` | Hand-written cross-links and images; the likeliest source of true positives. Check same-file vs cross-file anchors, and confirm a link into a directory or a non-Markdown file behaves as documented |  | [ ] |
| 2 | `REF-004` `REF-005` `REF-006` | Zone dependencies and ID traceability; needs `zonesDir`, or `definitions`/`references`/`idColumn`/`idPattern`. If the target has no ID scheme, record the family as **not applicable to this target** rather than skipping it silently |  | [ ] |
| 3 | `SIZE-001` | The five largest documents from Phase 3; set `bytes`/`lines`/`tokens` from measured values, then add an `overrides` entry for one glob and confirm it wins |  | [ ] |
| 4 | `CTX-001` `CTX-002` | Placeholder-only sections and unchecked boxes — the likeliest source of noise. A progress document with hundreds of open boxes is the test of whether the output is usable |  | [ ] |
| 5 | `CTX-003` | Needs a glossary table in the target; if none exists, mark not applicable |  | [ ] |
| 6 | `SEC-001` `SEC-002` `SEC-003` `STR-001` | Task/skill/template documents with an expected heading structure; `SEC-003` needs a reference template document, `STR-001` a required-file set |  | [ ] |
| 7 | `TBL-001`…`TBL-006` | The table-carrying documents from Phase 3: required columns, empty cells, allowed values, patterns, a `when`/`then` cross-column rule, and cross-file id uniqueness |  | [ ] |
| 8 | `GRP-001` `GRP-002` `GRP-003` | Cycles, orphans, and id carry-forward at project scope. Check `entryPoints` covers the target's real entry documents, and try `minCycleLength` against an index/back-link pair |  | [ ] |
| 9 | `LLM-001` | Confirm the `@` imports are **recognized at all** before judging the budget; set `maxTokensPerEntrypoint` from a measured closure, not a guess |  | [ ] |

For each family:

- [ ] Findings read by hand, with a verdict per finding: true positive / false positive / unclear message.
- [ ] Every message names a file, a position, and an action.
- [ ] Rule scope behaves as documented: a `document`-scope rule reports per file, a `project`-scope rule reports once about the corpus.
- [ ] Severity override (`error` → `warning`) changes the exit code and nothing else.
- [ ] `settings.siteRouter` (shared) is honored by the REF rules, and a per-rule override wins over the shared one.
- [ ] `settings.idRef` feeds `id-ref` edges into the graph — confirm the ids also show up in `graph --format json`, not only in REF-005.
- [ ] Nothing simply restates what the target's existing markdownlint/prettier setup already reports.

**Exit criterion:** every one of the 22 built-ins has been run against real content, or explicitly recorded as not applicable to this target with the reason.

## Phase 8 — declarative custom rules

**Goal:** the `custom` rule is the extension story. All 13 assertion kinds are a closed vocabulary; exercise each against real content.

| Assert kind | Target shape | Done |
| --- | --- | --- |
| `requiredColumns` | any table | [ ] |
| `columnNotEmpty` | a status/owner column | [ ] |
| `columnInSet` | a status column with a known vocabulary (test `caseSensitive` both ways) | [ ] |
| `columnMatches` | an id column with a pattern | [ ] |
| `columnUnique` | an id column across files | [ ] |
| `crossColumn` | a `when` → `then` pair (e.g. status Done implies a non-empty date) | [ ] |
| `sectionPresent` | a document family with a required heading | [ ] |
| `sectionOrder` | the same family's heading order | [ ] |
| `contentNotMatch` | a banned phrase or stale term | [ ] |
| `noPlaceholders` | `TODO`/`TBD` bodies | [ ] |
| `allChecked` | a checklist document | [ ] |
| `linkResolves` | a section that lists links | [ ] |
| `imageResolves` | a document with images | [ ] |

- [ ] Each custom rule's `id` is namespaced; an id shadowing a built-in prefix is **rejected** with a clear message.
- [ ] `target` (`table`/`section`/`document`) selects what the assertion runs over.
- [ ] `files`/`exclude` inside `options` scopes a custom rule to a subtree.
- [ ] No rebuild and no code execution is involved — the rule ships in the config alone.
- [ ] A custom rule id appears in output, JSON, and the generated schema the same way a built-in does.

**Exit criterion:** a maintainer could encode one of the target's real, project-specific documentation conventions without touching our source.

## Phase 9 — suppression and `--fix`

**Goal:** the two surfaces that change files or silence findings.

Suppression — on the branch, in one file:

```md
<!-- wastech-mdlint-disable REF-001 -->

[intentionally broken](does-not-exist.md)

<!-- wastech-mdlint-enable REF-001 -->

<!-- wastech-mdlint-disable-next-line TBL-002 -->
```

- [ ] `disable` + `enable` silences exactly the named rule, in exactly that range.
- [ ] `disable` with no `enable` runs to end of file.
- [ ] `disable-next-line` covers only the next line.
- [ ] A directive with **no** rule ids applies to all rules.
- [ ] A suppressed finding disappears from both text and JSON output, and from the exit code.

`--fix` (only `SEC-001` and `TBL-002` are fixable):

```bash
"$MDLINT" lint . --config "$RUN/cfg/fixable.json" --fix && git diff --stat
"$MDLINT" lint . --config "$RUN/cfg/fixable.json" --fix && git diff --stat   # must be a no-op
```

- [ ] The diff is confined to what the rules claim to fix — no incidental reformatting.
- [ ] Line endings are preserved, including in a CRLF file if the target has one.
- [ ] The second run is a no-op (fixes are idempotent).
- [ ] With `files`/`exclude` on the fixable rule entry, files outside that scope are **byte-unchanged** — the "reported" and "rewritten" sets must not drift.
- [ ] The post-fix report is the _remaining_ findings, not the pre-fix list.
- [ ] `git checkout -- .` afterwards, and confirm a clean tree before the next phase.

**Exit criterion:** `--fix` earned trust on someone else's files.

## Phase 10 — output contracts and exit codes

**Goal:** the machine-readable contract, and the guarantee that `1` means findings and nothing else.

```bash
"$MDLINT" lint . --config "$C" --format text  > "$RUN/10-report.txt"
"$MDLINT" lint . --config "$C" --format json  > "$RUN/10-report.json"
```

- [ ] Text output groups by file and is readable at the target's real finding volume (this is where a 4000-finding report either works or does not).
- [ ] JSON is the documented `{ summary, messages, files }` shape; every message carries the documented keys ([Output & exit codes](../guide/output.md#where-each-host-puts-the-findings)).
- [ ] **Host parity:** parse the text report back into rows and diff against the JSON messages — same count, same files, same rule ids, same severities. Parse it; do not recompute it with the renderer's own helper, or the assertion agrees with itself.
- [ ] Findings order is deterministic across runs and independent of filesystem order.
- [ ] A rule `hint`/help URL present in one format is present in the other.

Exit codes:

```bash
"$MDLINT" lint . --config "$C" --fail-on error   ; echo "exit=$?"   # 0 or 1
"$MDLINT" lint . --config "$C" --fail-on warning ; echo "exit=$?"   # 1 once warnings exist
"$MDLINT" lint . --config "$C" --fail-on off     ; echo "exit=$?"   # 0
"$MDLINT" lint ./does-not-exist                  ; echo "exit=$?"   # 2
"$MDLINT" lint ./README.md                       ; echo "exit=$?"   # 2 — a file, not a directory
"$MDLINT" lnit .                                 ; echo "exit=$?"   # 2 — a typo is not a path
"$MDLINT" docs                                   ; echo "exit=$?"   # 2 — a path still needs its subcommand
"$MDLINT" graph . --format text                  ; echo "exit=$?"   # 2 — graph spells it `human`
"$MDLINT" lint . --format yaml                   ; echo "exit=$?"   # 2 — lists valid choices
"$MDLINT" --help                                 ; echo "exit=$?"   # 0
```

- [ ] Every row above matches. `1` never appears for a non-finding failure.
- [ ] Operational errors go to **stderr** with an `Operational error:` line; the report goes to stdout, so a redirected stdout still contains only the report.
- [ ] Error messages name paths relative to the analyzed directory, with `/` separators, even when the argument was absolute.
- [ ] Running with no subcommand at all lints the cwd (the default command).

**Exit criterion:** a CI job can distinguish a failing document from a broken step.

## Phase 11 — graph, slice, impact

**Goal:** the shared graph and the three read-only reports over it.

```bash
"$MDLINT" graph . --config "$C" --format human   | head -60
"$MDLINT" graph . --config "$C" --format json    > "$RUN/11-graph.json"
"$MDLINT" graph . --config "$C" --format mermaid > "$RUN/11-graph.mmd"
"$MDLINT" graph . --config "$C" --format dot     > "$RUN/11-graph.dot"
"$MDLINT" slice <a-real-file-path> --depth 2
"$MDLINT" slice '#a-real-heading-slug' --depth 1
"$MDLINT" slice <a-defined-id> --depth 0
"$MDLINT" slice does-not-exist.md ; echo "exit=$?"
"$MDLINT" impact <a-hub-document>
"$MDLINT" impact <a-file-outside-the-corpus> ; echo "exit=$?"
```

- [ ] `human` output's clusters, hubs, and reading order match what a maintainer of the target would say. This is a judgment call and the most valuable check in the phase.
- [ ] `json` carries `{ nodes, edges, components, readingOrder, excluded, coverage }`; the `excluded` list explains itself (nodes a cycle kept out of the reading order).
- [ ] `coverage` names Markdown that is linked-to but outside the corpus — cross-check against Phase 3.
- [ ] `mermaid` and `dot` render in an actual renderer, at the target's real node count. If the diagram is unusable at that size, that is a finding about bounds, not about the renderer.
- [ ] Edge types are all represented where the target has them: relative link, anchor, image, `@` import, and `id-ref` when `settings.idRef` is configured.
- [ ] `slice` resolves by **exact** match only — a defined id, `#slug`, or file path. A near-miss must return an honest empty result (`matchKind: null`), exit `0`, and never a fuzzy match.
- [ ] `--depth 0` returns the query itself; increasing depth is monotonic (a deeper slice is a superset).
- [ ] `slice`/`impact` take no `[path]` and always scan the cwd — confirm from a different cwd.
- [ ] `impact` narrows the reported messages to the file plus its transitive dependents, while project-scope rules still saw the whole corpus.
- [ ] `impact` on a file outside the corpus exits `2` **with a hint**.
- [ ] All three commands write nothing (`git status --short` empty) and exit `0` on success.
- [ ] Determinism: every format is byte-identical across two runs.

**Record:** nodes `____` · edges `____` · components `____` · excluded `____` · graph wall-clock `____`

**Exit criterion:** the graph is a description of the target that its maintainer recognizes.

## Phase 12 — compile

**Goal:** the generated `SKILL.md` is loaded into an agent's context whole, so it is judged as context, not as a report.

```bash
"$MDLINT" compile --cwd . ; echo "exit=$?"            # no compile section yet: expect 2 + guidance
# add a compile section to the config, then:
"$MDLINT" compile --cwd . --config "$C" --dry-run | head -80
"$MDLINT" compile --cwd . --config "$C" --outdir "$RUN/12-skill-a"
"$MDLINT" compile --cwd . --config "$C" --outdir "$RUN/12-skill-b"
diff "$RUN/12-skill-a/SKILL.md" "$RUN/12-skill-b/SKILL.md"
```

- [ ] A missing `compile` section exits `2` with actionable guidance, not a stack trace.
- [ ] Missing or empty `skill.name`/`skill.description` is rejected at config load.
- [ ] An unknown `compile.*` key is rejected like any other unknown key.
- [ ] `--dry-run` prints exactly what the write would produce and writes nothing.
- [ ] Two runs produce a **byte-identical** `SKILL.md`.
- [ ] A relative `--outdir` resolves against `--cwd`, not against your shell; a nonexistent `--cwd` exits `2`.
- [ ] `sections.{architecture,rules,dependencies,workflow}` each gate their section when set to `false`.
- [ ] `commandPreset` (`claude`/`generic`/`none`) changes the wording of the dependency-workflow block.
- [ ] `hubMinInDegree` changes which documents are classified as hubs.
- [ ] The dependency section is **bounded** and states its own caps — confirm the artifact says so rather than silently truncating ([compile config](../guide/compile.md#config)).
- [ ] Read the artifact as an agent would: is it usable context for this repository, or a table of contents? A `SKILL.md` that only lists filenames is a finding.
- [ ] The Context Budget numbers are plausible against the Phase 3 byte totals.

**Exit criterion:** the artifact would help an agent working in the target repository.

## Phase 13 — MCP server

**Goal:** the second host over the same pipeline. Six read-only tools, stdio only.

A host is not required for a first pass:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | (cd "$TARGET_REPO" && "$MDLINT_MCP")
```

Then drive each tool with a `tools/call` frame:

| Tool | Check | Done |
| --- | --- | --- |
| `lint` | Ad-hoc content against an explicit ruleset; no project config is loaded | [ ] |
| `lint-files` | Same corpus and findings as the CLI over the same config | [ ] |
| `context-graph` | `format: "raw"` and `format: "summary"`; the summary equals the CLI's `graph --format json` | [ ] |
| `context-slice` | Exact-match resolution, `depth`, and an honest empty result | [ ] |
| `impact-analysis` | Blast radius; a file outside the corpus returns an actionable error, not a crash | [ ] |
| `compile-context` | Same deterministic content as the CLI `compile`, plus the metadata line | [ ] |

- [ ] `tools/list` returns exactly 6 tools, each with `readOnlyHint`.
- [ ] Five tools return `structuredContent` + `outputSchema`; `compile-context` returns two plain-text blocks.
- [ ] Errors follow the `{ code, message, hint }` contract ([error contract](../guide/mcp-server.md#error-contract)).
- [ ] **Known gap to confirm, not to re-file:** input that the tool's own `inputSchema` rejects returns raw `InvalidParams` text with no `structuredContent`, bypassing that contract. Judge whether it still reads acceptably to a host.
- [ ] The `lint` tool rejects an absolute path and a `..`-escaping relative path rather than following it.
- [ ] The `lint` tool's synthetic document path means a `files`/`exclude` glob that does not match it selects nothing — confirm this is what happens.
- [ ] `configPath` resolves against the tool's own cwd, matching the CLI's one rule.
- [ ] **Host parity:** for one shared config, the CLI and MCP report the same findings for the same files. A difference is a boundary defect by definition.
- [ ] Nothing mutates: `git status --short` empty after the whole phase.
- [ ] Register the server in a real MCP host as a second pass, and confirm the tool descriptions are usable by an agent that has never seen this tool.

**Exit criterion:** both hosts describe the same run.

## Phase 14 — scale, determinism, cross-platform

**Goal:** the properties that only a real corpus can test.

- [ ] Wall-clock for `lint`, `graph`, and `compile` recorded against the Phase 3 corpus size; note anything superlinear-feeling for a follow-up measurement.
- [ ] Cycle detection is recursive — a single large, densely cross-linked component is the risk. If the target has one, confirm it completes; if it does not, say so rather than implying the limit was tested.
- [ ] Every command re-run produces byte-identical output (this is the determinism guard restated at real scale).
- [ ] Output does not depend on the order files are discovered in — re-run from a different cwd and compare.
- [ ] A CRLF document survives every read-only command unchanged, and `--fix` preserves its endings.
- [ ] Non-Latin content: the token estimate is `ceil(chars / 4)` over UTF-16 code units and therefore errs **low** for Cyrillic and CJK — the unsafe direction for a budget. Compare `SIZE-001`'s token number against a real tokenizer for one document and record the ratio.
- [ ] Paths in every output are repository-relative POSIX, including on Windows. If a second platform is available, run Phases 4, 10, and 11 there and diff the reports.
- [ ] A document with unusual-but-valid Markdown (HTML blocks, footnotes, nested tables, front matter) parses without an exception.

**Record:** lint `____` · graph `____` · compile `____` · token estimate ratio `____`

**Exit criterion:** the numbers are recorded, so the next run on this target is a comparison.

## Phase 15 — triage and report

One entry per finding, in `$RUN/NOTES.md`:

```text
### F-NN <short title>
severity: blocker | major | minor | polish
command: <exact argv>  (cwd=<where>)
expected: … | actual: … | exit: …
repro: minimal fixture (a few lines of Markdown), not "the whole target repo"
where to fix: packages/<pkg>/src/…
```

- [ ] Every finding has a **minimal repro**. A finding without one is an observation and stays flagged as one until reduced.
- [ ] Severity assigned by user impact, not by how surprising it was: `blocker` = a first-time user cannot proceed or gets a wrong answer with no signal; `major` = wrong or misleading behavior with a workaround; `minor` = friction; `polish` = wording.
- [ ] Anything already in the [accepted-behaviors register](accepted-behaviors.md) or the [Limitations section](../../README.md) is **not** filed as a new finding — link the row instead. Appendix C lists the ones this playbook expects you to meet.
- [ ] The coverage matrix at the top is fully ticked, or each unticked row says why.
- [ ] Deliverable: the findings log plus a severity-ordered summary, and the filled record tables from Phases 0, 3, 4, 11, and 14.

## Cleanup

The run installed a dependency and wrote files into the target, so cleanup is an undo, not a formality. Copy the deliverable out **before** deleting the branch — it lives on that branch and nowhere else.

```bash
cd "$TARGET_REPO"
cp -R mdlint-field-test "$HOME/mdlint-field-tests/<date>-<target>"   # the deliverable leaves first
git checkout -- . && git clean -fd                                  # drop uncommitted leftovers
git checkout <the branch recorded in Phase 0>
git branch -D mdlint-field-test
rm -rf node_modules                                                 # the install is not on any branch
git status --short                                                  # expected empty
```

- [ ] The deliverable (filled playbook copy, findings log, reports) is out of the target before the branch goes.
- [ ] Target back on its original branch at the HEAD recorded in Phase 0, tree clean.
- [ ] The install is gone: no `node_modules`, and `package.json`/`package-lock.json` either removed (a repo that had none) or byte-identical to the pre-run commit (a repo that did). `git diff <recorded HEAD> --stat` is the check, and it must be empty.
- [ ] Nothing survives in the target that the run created — including the run directory itself, which was committed on the deleted branch and must not be left behind untracked.

---

## Appendix A — escalation configs

One file per family under `$RUN/cfg/`. Each is a complete config: replace the bracketed values with real ones from the Phase 3 table. Keep `include` identical across all of them so findings are comparable between families, and give every one of them the run directory's exclude so the run never lints its own bookkeeping:

```jsonc
"exclude": ["mdlint-field-test/**"],
```

That entry is appended to the lint-time defaults rather than replacing them, so it costs nothing else.

```jsonc
// ref.json — links, anchors, images
{
  "include": ["<the target's doc globs>"],
  "settings": {
    "siteRouter": {
      "preset": "<preset>",
      "contentDir": "<dir>",
      "defaultLocale": "<locale>",
    },
  },
  "rules": [
    { "rule": "REF-001" },
    { "rule": "REF-002" },
    { "rule": "REF-003" },
  ],
}
```

```jsonc
// ref-advanced.json — zones and ID traceability; drop what the target has no analogue for
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "REF-004",
      "options": { "zonesDir": "<dir>", "dependencySection": "Dependencies" },
    },
    {
      "rule": "REF-005",
      "options": {
        "definitions": ["<def globs>"],
        "references": ["<ref globs>"],
        "idColumn": "<column>",
        "idPattern": "<regex>",
      },
    },
    {
      "rule": "REF-006",
      "options": {
        "stabilityColumn": "<column>",
        "stabilityOrder": ["stable", "beta", "experimental"],
        "definitions": ["<def globs>"],
        "references": ["<ref globs>"],
        "idColumn": "<column>",
      },
    },
  ],
}
```

```jsonc
// size.json — budgets measured from the five largest documents, not guessed
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "SIZE-001",
      "options": {
        "bytes": { "warn": 40000, "error": 80000 },
        "lines": { "warn": 800 },
        "tokens": { "warn": 10000 },
        "overrides": [
          {
            "pattern": "<a glob that should be allowed to be larger>",
            "bytes": { "warn": 120000 },
          },
        ],
      },
    },
  ],
}
```

```jsonc
// ctx.json — content quality
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "CTX-001",
      "options": { "placeholders": ["TODO", "TBD", "FIXME"] },
    },
    {
      "rule": "CTX-002",
      "options": { "section": "<a checklist section heading>" },
    },
    {
      "rule": "CTX-003",
      "options": {
        "glossary": "<glossary file>",
        "termColumn": "<column>",
        "aliasColumn": "<column>",
      },
    },
  ],
}
```

```jsonc
// sec.json — structure; SEC-001 and TBL-002 are also the two fixable rules
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "SEC-001",
      "options": {
        "sections": ["<required headings>"],
        "files": ["<the family this applies to>"],
      },
    },
    {
      "rule": "SEC-002",
      "options": { "order": ["<heading a>", "<heading b>"], "level": 2 },
    },
    {
      "rule": "SEC-003",
      "options": { "template": "<reference template file>", "level": 2 },
    },
    {
      "rule": "STR-001",
      "options": { "files": ["README.md", "<other required files>"] },
    },
  ],
}
```

```jsonc
// tbl.json — all six table rules over the target's real tables
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "TBL-001",
      "options": { "requiredColumns": ["<column>"], "files": ["<table docs>"] },
    },
    { "rule": "TBL-002", "options": { "columns": ["<column>"] } },
    {
      "rule": "TBL-003",
      "options": {
        "column": "<status column>",
        "values": ["<allowed>", "<values>"],
        "caseSensitive": false,
      },
    },
    {
      "rule": "TBL-004",
      "options": { "column": "<id column>", "pattern": "<regex>" },
    },
    {
      "rule": "TBL-005",
      "options": {
        "when": { "column": "<status>", "equals": "Done" },
        "then": { "column": "<date>", "notEmpty": true },
      },
    },
    { "rule": "TBL-006", "options": { "column": "<id column>" } },
  ],
}
```

```jsonc
// grp.json — project-scope graph rules
{
  "include": ["<doc globs>"],
  "settings": {
    "idRef": {
      "idPattern": "<regex>",
      "definitions": ["<def globs>"],
      "idColumn": "<column>",
    },
  },
  "rules": [
    { "rule": "GRP-001", "options": { "minCycleLength": 2 } },
    {
      "rule": "GRP-002",
      "options": {
        "entryPoints": ["README.md", "<the target's real entry documents>"],
      },
    },
    {
      "rule": "GRP-003",
      "options": {
        "chain": [
          {
            "stage": "<stage a>",
            "files": ["<globs>"],
            "refColumn": "<column>",
          },
          {
            "stage": "<stage b>",
            "files": ["<globs>"],
            "refColumn": "<column>",
          },
        ],
      },
    },
  ],
}
```

```jsonc
// llm.json — eager-import budget; verify the imports are seen before judging the number
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "LLM-001",
      "options": {
        "entrypoints": ["CLAUDE.md", "AGENTS.md"],
        "maxTokensPerEntrypoint": 20000,
      },
    },
  ],
}
```

```jsonc
// custom.json — one entry per assertion kind; ids must be namespaced
{
  "include": ["<doc globs>"],
  "rules": [
    {
      "rule": "custom",
      "id": "PROJ-OWNER",
      "description": "Every row names an owner",
      "severity": "error",
      "target": "table",
      "options": {
        "files": ["<table docs>"],
        "assert": { "kind": "columnNotEmpty", "column": "Owner" },
      },
    },
    {
      "rule": "custom",
      "id": "PROJ-STATUS",
      "description": "Status uses the agreed vocabulary",
      "severity": "warning",
      "target": "table",
      "options": {
        "assert": {
          "kind": "columnInSet",
          "column": "Status",
          "values": ["Todo", "Doing", "Done"],
        },
      },
    },
  ],
}
```

```jsonc
// compile.json — add to whichever config Phase 12 runs with
{
  "include": ["<doc globs>"],
  "rules": [],
  "compile": {
    "outdir": ".claude/skills/wastech-mdlint",
    "skill": {
      "name": "<target-skill-name>",
      "description": "<what an agent gets from it>",
    },
    "sections": {
      "architecture": true,
      "rules": true,
      "dependencies": true,
      "workflow": true,
    },
    "commandPreset": "generic",
    "hubMinInDegree": 3,
  },
}
```

## Appendix B — assertion one-liners

```bash
# summary + file count
node -e 'const r=require(process.argv[1]);console.log(r.summary,"files:",r.files.length)' "$RUN/<file>.json"

# findings grouped by rule id
node -e 'const r=require(process.argv[1]);const m={};for(const x of r.messages)m[x.ruleId]=(m[x.ruleId]||0)+1;console.log(m)' "$RUN/<file>.json"

# the ten files with the most findings
node -e 'const r=require(process.argv[1]);const m={};for(const x of r.messages)m[x.filePath]=(m[x.filePath]||0)+1;console.log(Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10))' "$RUN/<file>.json"

# any absolute or backslash path in the report is a finding
node -e 'const r=require(process.argv[1]);const bad=JSON.stringify(r).match(/"[A-Za-z]:\\\\[^"]*"|"\/(Users|home)\/[^"]*"/g);console.log(bad?bad.slice(0,5):"clean")' "$RUN/<file>.json"

# determinism: same command twice, byte-compare
"$MDLINT" <cmd> > "$RUN/d1.out" && "$MDLINT" <cmd> > "$RUN/d2.out" && cmp "$RUN/d1.out" "$RUN/d2.out" && echo deterministic
```

## Appendix C — behaviors that are not new findings

Meeting one of these means the run reached a documented boundary. Confirm it reads acceptably, note it, and move on — do not open a finding.

| Behavior | Where it is documented |
| --- | --- |
| Token counts are estimated as `ceil(chars / 4)` and under-report for non-Latin scripts | [Limitations](../../README.md) |
| No external HTTP link checking and no link cache | [Limitations](../../README.md) |
| No `.ts`/`.cjs`/`.mjs` config and no code plugins — custom rules are data-only | [Limitations](../../README.md) |
| The context graph is rebuilt each run; there is no incremental cache | [Limitations](../../README.md) |
| Cycle detection is recursive, so one very large connected component can exhaust the stack | [context graph limitations](../guide/context-graph.md) |
| Dangling reference-style links are parsed as literal text, so `REF-001` never sees them | [REF-001 notes](../guide/rules/REF-001.md) |
| `graph` spells its text format `human` while the other commands spell theirs `text` | [CLI reference](../guide/cli.md) |
| A path argument still needs its subcommand — an unknown one is an error, not a path | [CLI reference](../guide/cli.md) |
| `init --on-existing merge` does not preserve JSONC comments | [CLI reference](../guide/cli.md) |
| `init` never proposes `SIZE-001` or `LLM-001` | [CLI reference](../guide/cli.md) |
| An MCP input rejected by the tool's own `inputSchema` bypasses the structured error contract | [MCP error contract](../guide/mcp-server.md#error-contract) |
| Anything else already listed in the register | [accepted behaviors](accepted-behaviors.md) |
