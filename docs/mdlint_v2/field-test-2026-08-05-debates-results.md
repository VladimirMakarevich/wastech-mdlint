# Field test results — CLI against an external repository (2026-08-05)

> **Plan:** [field-test-2026-08-05-debates.md](field-test-2026-08-05-debates.md) · **Target:** a private Angular/.NET monorepo at `/Users/a1234/Documents/GitHub/debates` · **Node line:** `v24.8.0` (Phase 0 decision: proceed, and record the pin as F-01) · **Status:** all phases executed (0–8); target repository restored
>
> 26 findings, every one reduced to a minimal repro or a named source location. The four that would change a user's first ten minutes with the tool are F-06, F-11, F-13 and F-14 — and all four are invisible to the in-repo suite for the same reason: no fixture has a nested `node_modules`, a dot-directory full of real documentation, a 96 KB document, or a hand-written glob.

## Severity-ordered summary

| # | Severity | Finding | Where |
| --- | --- | --- | --- |
| F-06 | **blocker** | Zero-config `lint .` has no default `exclude`, so it lints every `node_modules` tree — 3063 files instead of 323, silently | `core/src/markdown/load-documents.ts:147` |
| F-04 | major | No package ships a README or LICENSE, and none declares `repository` | `packages/*/package.json` |
| F-07 | major | The README's own example `exclude` is root-anchored and under-excludes a monorepo | `README.md:127` |
| F-08 | major | `init --on-existing merge` refuses to write and still exits `0` | `cli/src/init-command.ts` |
| F-11 | major | `init` silently drops every dot-directory — 63 files, 31% of this corpus | `core/src/discovery/config-writer.ts` |
| F-13 | major | `SIZE-001` accepts an entry with no metric and then does nothing | `core/src/engine/rules/size.ts:32` |
| F-14 | major | The glob anchoring rule is undocumented and surprising in both directions | `core/src/discovery/globs.ts` |
| F-15 | major | Token estimate is `chars/4` — language-blind, under-reports in the unsafe direction | `core/src/engine/tokens.ts` |
| F-21 | major | Generated `SKILL.md` is 90% edge list, 0.4% workflow | `core/src/compile/synthesize.ts` |
| F-01 | minor | `engines` pins a Node above the developer's own, with no runtime check | root `package.json` |
| F-02 | minor | Format gate red on an in-flight docs edit — **resolved during the run** | (fixed) |
| F-05 | minor | Shipped sourcemaps are dangling; ~half the packed size | `packages/*/tsconfig.json` |
| F-09 | minor | Config validator's second stage drops the file path and changes notation | `core/src/config/load-config.ts:156` |
| F-10 | minor | `severity: "warn"` reports only `Invalid input` | `core/src/config/load-config.ts` |
| F-16 | minor | `GRP-002` has no default `entryPoints`, flags the repo's own entry points | `core/src/engine/rules/grp.ts:66` |
| F-19 | minor | `graph --format human` emits four lines of 3.5–3.9 KB | `core/src/graph/graph-render.ts` |
| F-20 | minor | `excluded from reading order` exists only in the human format | `core/src/graph/graph-render.ts` |
| F-22 | minor | Node-role vocabulary collapses: 2 of 5 roles absorb 83% of nodes | `core/src/compile/synthesize.ts` |
| F-24 | minor | MCP text drops the `hint`, hiding the did-you-mean the CLI shows | `mcp-server/src/tools/lint.ts` |
| F-25 | minor | `format` has a third vocabulary on MCP, and `json` means two payloads | `mcp-server/src/tools/context-graph.ts` |
| F-26 | minor | Schema-level rejections bypass the `{code, message, hint}` contract | `mcp-server/src/` registration |
| F-03 | polish | 9 npm advisories in the workspace — but the shipped tree is clean | (note only) |
| F-12 | polish | `--format` vocabulary differs on `graph` vs every other command (see F-25) | `cli/src/program.ts` |
| F-17 | polish | `GRP-001` calls an index ↔ member back-link a cycle, at `error` | `core/src/engine/rules/grp.ts` |
| F-18 | polish | `init` can only ever infer 8 of the 24 built-in rules | `core/src/discovery/rule-inference.ts` |
| F-23 | polish | An out-of-repo `--outdir` is reported as `../../../../..` | `cli/src/commands.ts` |

Counts: 1 blocker, 8 major, 12 minor (1 resolved), 5 polish.

**What went right,** since a findings list reads worse than the run deserved: 850 tests green in 15s; `REF-001`/`REF-002` scored **19 true positives out of 19** on hand review, with the anchor slugger matching GitHub exactly on em-dashes, `+`, emoji, parens and Cyrillic; the exit-code contract held in all ten cases including warnings-only-with-default; `--fix` was surgical and idempotent with byte hygiene intact; inline suppression silenced exactly 97 findings and nothing else; every output was byte-identical across repeated runs in all four graph formats and both compile modes; `impact` and declarative `custom` rules were correct and genuinely useful on real data; `respectGitignore` honored nested `.gitignore` files perfectly — nothing linted that `git ls-files` does not track; and over MCP all six tools registered correctly, five of five documented `structuredContent` shapes were delivered, the handler-level error contract carried real codes, and the documented path-escape boundary rejected both an absolute and a `..`-escaping path rather than following them.

## Reconnaissance — all plan facts verified, no drift

202 tracked `.md`; 323 excluding `node_modules`; 121 ignored (88 under `.worc/` via root `.gitignore`, 33 under `mobile/ios/App/Pods` via nested `mobile/ios/.gitignore`). Largest: 96778 / 85891 / 65683 / 63776 / 54384 B. `.markdownlint.json` + `.prettierrc.json` (`proseWrap: never`) present; no `wastech-mdlint.config.json`, no `.mcp.json`. Branch `master`, tree clean. 7 `.gitignore` files, 6 of them nested.

---

# Findings

### F-01 `engines` pins a Node above the developer's own, with no runtime check

- **severity:** minor
- **command:** `npm ci` (cwd=wastech-mdlint), `node -v`
- **expected:** either the install refuses, or something checks at runtime | actual: `npm ci` prints `EBADENGINE` for the root and all three workspace packages and exits `0`; no `.npmrc` sets `engine-strict`; no runtime guard reads `process.version`. The whole field test then runs on `v24.8.0` against a `>=24.17.0` floor. | exit: 0
- **repro:** on any Node below 24.17.0, `npm ci` in the workspace — warnings only.
- **where to fix:** root `package.json`/`.npmrc` (add `engine-strict=true`) or a startup guard in `packages/cli/src/index.ts`. Decide deliberately: the pin is advisory today, which means the floor is untested in practice.

### F-02 format gate red on an in-flight docs edit (pre-existing, not caused by the field test) — RESOLVED

- **severity:** minor
- **command:** `npm run format` (cwd=wastech-mdlint)
- **expected:** exit 0 | actual: exit 1 — `[warn] docs/mdlint_v2/P-release/05-release-verification.md` | exit: 1
- **repro:** a paragraph inside ordered-list item 2 with no blank line before item 3; Prettier inserts the blank line.
- **where to fix:** `npx prettier --write docs/mdlint_v2/P-release/05-release-verification.md` — done during the run, gate green, diff was `+1` line. Product defect: none. Recorded because the plan's Phase 1 treats any red gate as a finding, and because this is the exact failure mode AGENTS.md Repository Hygiene warns about (a docs-only change turning the gate red).

### F-03 9 npm advisories in the workspace dependency tree, 5 high — but the runtime tree is clean

- **severity:** polish
- **command:** `npm ci` (cwd=wastech-mdlint) vs `npm i ./*.tgz` (cwd=$SB)
- **expected:** no high advisories reachable by a user | actual: the workspace reports `9 vulnerabilities (1 low, 3 moderate, 5 high)`; installing the three published tarballs into a bare sandbox reports **`found 0 vulnerabilities`** across 196 packages. | exit: 0 both
- **repro:** compare the two installs.
- **where to fix:** nothing shipping is affected — the advisories are entirely in the dev chain. Correct output is a recorded note at PR.05, not a dependency bump. Downgraded from minor to polish on that evidence.

### F-04 none of the three packages ships a README or LICENSE, and none declares `repository`

- **severity:** major
- **command:** `tar -tzf $SB/wastech-mdlint-{cli,core,mcp-server}-0.0.0.tgz` (cwd=$SB)
- **expected:** each published package carries its own `README.md` (the npm landing page), the MIT text it declares, and a `repository` link | actual: every tarball contains only `package.json` + `dist/` (`cli` additionally `schema.json`). No `README*` or `LICENSE*` exists anywhere under `packages/` — both live at the repo root only, and npm's automatic README/LICENSE inclusion has nothing local to pick up. All three declare `"license": "MIT"` with no license text in the payload. All three omit `repository`, which the root `package.json` does set. | exit: 0
- **repro:** `find packages -maxdepth 2 \( -iname 'README*' -o -iname 'LICENSE*' \)` → empty.
- **where to fix:** `packages/*/package.json` (add `repository` with `directory`), plus a per-package `README.md` and a copied or symlinked `LICENSE`. This is invisible to the in-repo suite by construction: nothing asserts on tarball contents, and PR.02's `npm pack --dry-run --workspaces` prints the payload without judging it. It becomes visible only after publishing — three blank npm pages with no source link.

### F-05 shipped sourcemaps are dangling — they reference `../src/*.ts`, which is not in the tarball

- **severity:** minor
- **command:** `tar -tzf $SB/wastech-mdlint-core-0.0.0.tgz` (cwd=$SB)
- **expected:** either no maps in the payload, or maps that resolve | actual: `core` ships 168 `.map` files out of 336 `dist/` entries. `dist/index.js.map` has `"sourceRoot":""`, `"sources":["../src/index.ts"]`, and **no `sourcesContent`**; `node_modules/@wastech-mdlint/core/src` does not exist after install. Every map is unresolvable at the consumer, and they are roughly half the 205.8 KB packed size. | exit: 0
- **repro:** install the tarball, then read `dist/index.js.map` and `ls ../src`.
- **where to fix:** `packages/*/tsconfig.json` — either drop `sourceMap`/`declarationMap` from the emit contract, add `src` to the `files` allowlist, or set `inlineSources`. Pick one deliberately; today's payload has the cost of maps with none of the benefit.

### F-06 zero-config `lint .` has no default `exclude` at all, so it lints every `node_modules` tree

- **severity:** blocker
- **command:** `wastech-mdlint lint . --format json` (cwd=/Users/a1234/Documents/GitHub/debates, no config file present)
- **expected:** 323 files — the plan's Phase 3 states "`node_modules` is excluded by default and must not appear at any depth" | actual: **3063 files**, of which **2740 are under `node_modules`** (all of them nested, under `mobile/node_modules/`). 19.30 MB parsed instead of ~1.9 MB; 31s wall instead of the few seconds the real corpus costs. Exit 0, zero findings, because the zero-config ruleset is empty — so the blow-up is silent. | exit: 0
- **repro:** `$SB/repro-nested-exclude` — three files: `docs/a.md`, `mobile/node_modules/leftpad/README.md`, `node_modules/rightpad/README.md`, no config. Result: all 3 linted.
- **where to fix:** `packages/core/src/markdown/load-documents.ts:147` — `exclude: options.exclude ?? []`. There is no lint-time default; the only `node_modules` literals in `core/src` are in `discovery/repo-scan-constants.ts` (the `init` scan's noise list) and `discovery/config-writer.ts` (what `init` writes). Both are `init`-only, so a user who never runs `init` — the `npx wastech-mdlint lint .` first-run path — gets no pruning whatsoever. The schema declares no `default` for `exclude` or `respectGitignore` either. Note this also makes the plan's own Phase 3 expectation wrong; fix the plan after fixing the default.

### F-07 the README's own example `exclude` is root-anchored, so it silently fails to prune a monorepo's nested `node_modules`

- **severity:** major
- **command:** `wastech-mdlint lint . --format json` with `README.md`'s line-127 config copied verbatim (cwd=`$SB/repro-nested-exclude`)
- **expected:** `docs/a.md` only | actual: `docs/a.md` and `mobile/node_modules/leftpad/README.md`. `"exclude": ["node_modules/**", "dist/**", ".git/**"]` prunes root-level `node_modules/` and nothing deeper. Adding the `**/` prefix — `"**/node_modules/**"` — prunes both. | exit: 0
- **repro:** same fixture as F-06; three runs (no config / README example / `**/`-prefixed) give 3 / 2 / 1 files.
- **where to fix:** `README.md:127`. The same README claims at line 80 that `init` writes excludes "matched at any depth, so a monorepo's `packages/*/dist` and `packages/*/node_modules` stay out of the lint corpus too", and `discovery/config-writer.ts:134` confirms the generated config uses the prefix — so the prose and the generator are right and only the hand-copy example is wrong. That is the worst place for it to be wrong: it is what a user writing config by hand copies, and the failure is silent (more files linted, no warning). See F-14 for the root cause.

### F-08 `init --on-existing merge` refuses to write and still exits `0`

- **severity:** major
- **command:** `wastech-mdlint init . --yes --on-existing merge` with an invalid existing config (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** non-zero — nothing was written and the user's requested action did not happen | actual: prints `Not written: the existing config at wastech-mdlint.config.json could not be read, parsed, or validated, so a merge cannot guarantee a valid config with its existing entries preserved. Fix or remove it, then re-run init.` and exits **`0`**. `lint` given the same file exits `2`. | exit: 0
- **repro:** config with `{"rules":[{"rule":"REF-001","severity":"warn"}]}` (`warn` is not in the `error|warning|off` enum), then the command above.
- **where to fix:** `packages/cli/src/init-command.ts` — the refusal path must map to the operational-error exit `2`, matching `lint`'s handling of the identical file. The refusal itself is correct and well-worded; only the code is wrong. This matters most where the plan says `--yes` belongs: in CI, a merge step that silently no-ops reports success. It is a process-boundary defect by construction — only a spawned process has an exit code, so an in-process test cannot see it.

### F-09 the config validator's second stage drops the file path and changes path notation

- **severity:** minor
- **command:** `wastech-mdlint lint .` with various invalid configs (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** one diagnostic shape, always naming the file to edit | actual: three shapes from one validator —

| Invalid config | Message |
| --- | --- |
| `"includ": [...]` (unknown top-level key) | `Invalid config at wastech-mdlint.config.json:` / `- config: Unrecognized key: "includ"` |
| `severity: "warn"` | `Invalid config at wastech-mdlint.config.json:` / `- config.rules.0: Invalid input` |
| `options: {maxBytes: …}` | `Invalid config:` / `- rules[1].options: Unrecognized key: "maxBytes"` |

- **exit:** 2 in all three (correct)
- **repro:** the three configs above, one at a time.
- **where to fix:** `packages/core/src/config/load-config.ts` — stage 1 (`lintConfigSchema.safeParse`, line 207) throws `Invalid config at ${displayPath}` with `formatRootIssue` paths; stage 2 (`resolveConfiguredRules`, line 156) throws `Invalid config:` with `formatRuleResolutionError` paths and no `displayPath`. Give stage 2 the path and settle on one notation. The missing filename is worst in the case that needs it most: the README documents that an ancestor directory's config can govern the run, so "which file?" is a real question.

### F-10 `severity: "warn"` reports only `Invalid input` — neither the offending key nor the allowed values

- **severity:** minor
- **command:** `wastech-mdlint lint .` with `{"rules":[{"rule":"REF-001","severity":"warn"}]}` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** something like `config.rules.0.severity: expected "error" | "warning" | "off", got "warn"` | actual: `- config.rules.0: Invalid input`. The word `severity` does not appear; the enum is not shown. | exit: 2
- **repro:** as above. Contrast the sibling cases, which are precise: `rules[1].options: Unrecognized key: "maxBytes"` and `config: Unrecognized key: "includ"`.
- **where to fix:** `formatRootIssue` in `packages/core/src/config/load-config.ts` — a Zod union/discriminated-union failure collapses to a single `invalid_union` issue on the entry, so the per-branch enum detail is in `issue.errors` and is being discarded. `warn` for `warning` is the single most likely severity typo — the schema's own enum is `error | warning | off` — so this is the message a first-time user is most likely to meet. It also bit the declarative-custom-rule path during Phase 5: passing `options.assert` as an array (it is a single object) produced only `config.rules.0: Invalid input`, with nothing to indicate that shape was the problem. Note the two stages fail fast independently, so a config with both a shape error and an options error reports only the shape one, and a user fixing config by trial hits one error per run.

### F-11 `init` silently drops every dot-directory, which in an agent-documented repo is the corpus that matters most

- **severity:** major
- **command:** `wastech-mdlint init . --yes` then `wastech-mdlint lint . --format json` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** the plan predicted 202 — every tracked Markdown file minus what `.gitignore` excludes | actual: **139**. The 63-file gap is entirely the `"**/.*/**"` exclude that `init` writes: `.claude/` (28), `.agents/` (23), `backend/.rules/` (6), `mobile/.rules/` (6). `comm` against `git ls-files '*.md' '*.mdx'` shows nothing else missing and nothing extra. | exit: 1 (23 errors, 434 warnings — findings, so correct)
- **repro:** any repo with Markdown in a dot-directory; `init --yes` then compare the linted list to `git ls-files`.
- **where to fix:** `HIDDEN_DIR_EXCLUDE_GLOB` in `packages/core/src/discovery/config-writer.ts`, and the reporting in `packages/cli/src/init-command.ts`. Two separable problems:

1. _The default is wrong for this class of repo._ The rationale in `discovery/repo-scan-constants.ts` is sound for the _scan_ — `.github`, `.venv`, `.husky` hold tooling Markdown that would pollute cluster inference, and hidden dirs are pruned by shape because a name list "can never enumerate them" (audit L-7). But the scan's pruning decision is then written out as a permanent _lint-time_ exclude, and those are different questions. In this target the dot-directories hold `.claude/skills/`, `.agents/rules/`, and two `.rules/` sets — 31% of the tracked corpus, and precisely the LLM-facing documentation this tool exists to lint. Our own repo has the same shape.
2. _The omission is silent, which is the worse half._ `init` prints the 5 include patterns and the 11 exclude globs but never says "63 Markdown files were excluded because they live in hidden directories." A user reads the include list, sees `docs/`, `backend/`, `mobile/`, `tasks/`, and has no reason to suspect `.claude/` was considered and dropped. Reporting the count would make the default self-correcting even if the default stays. The information is demonstrably available: `graph`'s own `coverage.filesOutsideCorpus` already lists 12 of these files as "linked but outside the corpus".

If the default is kept deliberately, it belongs in `docs/mdlint_v2/accepted-behaviors.md` with the disclosure requirement, per AGENTS.md.

### F-12 `--format` uses a different vocabulary on `graph` than on every other command

- **severity:** polish
- **command:** `wastech-mdlint graph . --format text` / `wastech-mdlint lint . --format human` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** one word for "plain text for a human" across the CLI | actual: `graph` accepts `human | json | mermaid | dot` (default `human`) and rejects `text`; `lint`/`slice`/`impact` accept `text | json` (default `text`) and reject `human`. Both rejections exit `2` and name the valid choices. | exit: 2 both
- **repro:** the two commands above.
- **where to fix:** `packages/cli/src/program.ts` — accept both words on both, or rename one. Kept at polish because `README.md:62-65` documents the split faithfully, `--help` shows the choices, and the failure is loud rather than silent. It is still a paper cut: the same flag name means different things on sibling commands of the same tool.

### F-13 `SIZE-001` accepts an entry with no metric and then does nothing, silently — unlike every sibling rule

- **severity:** major
- **command:** `wastech-mdlint lint . --format json` with `{"rule":"SIZE-001"}` (cwd=/Users/a1234/Documents/GitHub/debates, 202-file corpus containing a 96778 B and an 85891 B document)
- **expected:** either a default budget, or a config error saying the entry needs a metric | actual: **0 errors, 0 warnings.** The user enabled "File stays within byte / line / token budgets", got a green run over a 96 KB document, and was told nothing. | exit: 0
- **repro:** any corpus, `{"rule":"SIZE-001"}` with no options.
- **where to fix:** `packages/core/src/engine/rules/size.ts:32-39` — `bytes`, `lines`, and `tokens` are each `.optional()` with no default, and the check `continue`s when a metric is undefined (line 84). The comment at line 8 states the design: "Each metric is independently optional; omitting it disables that check." So an entry with no metric is a no-op _by construction_.

What makes this a defect rather than a documented choice is that **SIZE-001 is the only rule that permits it.** Read from the shipped `schema.json`:

| Rule | Options marked `required` |
| --- | --- |
| `LLM-001` — the sibling budget rule | `entrypoints`, `maxTokensPerEntrypoint` |
| `SEC-001` | `sections` |
| `SEC-002` | `order` |
| **`SIZE-001`** | **none** |

Its nearest sibling makes its threshold mandatory; `SIZE-001` does not, so it alone can be enabled into inertness. Verified against a genuine zero for contrast: `CTX-001` also reported 0 on the target, but a three-section fixture proves it fires (`Section "Empty section" is empty.` / `contains only a placeholder.`) — that zero is a true negative. `SIZE-001`'s zero is not. With explicit thresholds the rule is correct: byte counts matched `stat` exactly on all 10 flagged files. Fix: mark at least one metric required (matching `LLM-001`), or ship defaults. Note also that `init` never infers `SIZE-001` — see F-18 — so neither path lands a user on a working size budget.

### F-14 the glob anchoring rule is undocumented, counter-intuitive, and inconsistent in both directions

- **severity:** major
- **command:** `wastech-mdlint lint . --format json` with varying `files`/`include`/`exclude` patterns (cwd=`$SB/repro-glob-anchor`, three files: `NOTE.md`, `sub/NOTE.md`, `sub/OTHER.md`)
- **expected:** one stated anchoring rule a reader can predict | actual:

| Pattern | Matches | Surprise |
| --- | --- | --- |
| `NOTE.md` | `NOTE.md`, `sub/NOTE.md` | a bare filename matches at any depth |
| `*.md` | all three | `*` recurses — the opposite of shell/gitignore/tsconfig |
| `./NOTE.md` | `NOTE.md` only | the `./` prefix is the only way to anchor to the root |
| `node_modules/**` (F-07) | root `node_modules/` only | a pattern _with_ a slash is root-anchored |

- **exit:** 0
- **repro:** the fixture above, four runs.
- **where to fix:** `packages/core/src/discovery/globs.ts` — `normalizeConfigGlob` is explicit about it: a pattern containing `/` is returned untouched (root-anchored); a pattern without `/` gets a `**/` prefix prepended (any depth). Internally consistent, and `matchesConfigGlob` passes `dot: true` so dot-paths match too. But neither direction is documented: `grep -niE 'basename|anchor|at any depth|glob' README.md` returns only the `init` sentence, which says init's own excludes are "matched at any depth" — true, because init writes the prefix itself.

This is the root cause that F-07 is a symptom of, and it bites both ways: a user writing `exclude: ["node_modules/**"]` under-excludes, and a user writing `include: ["*.md"]` expecting root-level docs gets the entire tree. It also explains why `init` emits `"./*.{md,mdx}"` — the `./` is load-bearing and nothing says so. Document the rule in `README.md`, and consider warning when a slash-free directory-ish pattern is likely meant to be anchored.

### F-15 the token estimate is `chars/4` — language-blind, and it under-reports in the unsafe direction

- **severity:** major
- **command:** `wastech-mdlint lint . --format json` with `SIZE-001` `tokens` thresholds, and `LLM-001` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** an estimate whose calibration is stated where the number is reported | actual: `packages/core/src/engine/tokens.ts` is `Math.ceil(text.length / 4)` — characters, no language term. Measured bytes-per-token across the flagged files ranged **4.03 to 6.83**, which is itself the tell: a 6.83 ratio means ~1.7 bytes/char, i.e. predominantly 2-byte UTF-8. The largest document, `docs/v2/requirements/_idea_v2.md`, is **70.3% Cyrillic letters** (39852 of 56714 chars; 9.4% Latin) and is reported as 14179 tokens. A BPE tokenizer spends materially more tokens per character on Cyrillic than on English, so the true count is higher — the estimate errs **low**, which is the wrong direction for a budget whose job is preventing context overflow. | exit: 1
- **repro:** any predominantly non-Latin document with a `tokens` budget.
- **where to fix:** not the arithmetic — `AGENTS.md` mandates keeping the heuristic isolated precisely so it can be swapped, and `tokens.ts` says so. What is missing is **disclosure**: `grep -niE 'token' README.md` returns three lines, none of which says how tokens are estimated. A reader of `File exceeds tokens warn budget: 14179 tokens` has no way to learn the number assumes ~4 chars/token. Either state the calibration in `README.md` and in the finding's message, or weight by byte length, which the rule already computes for the `bytes` metric one line above. Fixing the honesty does not require fixing the math.

### F-16 `GRP-002` has no default `entryPoints`, so it flags the repository's own entry points as orphans

- **severity:** minor
- **command:** `wastech-mdlint lint . --format json` with `{"rule":"GRP-002"}` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** the obvious entry-point filenames exempt by default | actual: **111 orphan warnings out of 202 files (55%)**, and the list includes `CLAUDE.md`, `backend/AGENTS.md`, `mobile/CLAUDE.md`, `backend/README.md`, `mobile/README.md` — the repository's canonical entry points — plus 50 harness-loaded files that are never linked from Markdown by design (`.agents/skills` 23, `.claude/skills` 21, `.claude/agents` 4, `.claude/commands` 2). | exit: 0
- **repro:** `{"rule":"GRP-002"}` on any repo with a root `README.md`.
- **where to fix:** `packages/core/src/engine/rules/grp.ts:66` — `entryPoints: z.array(z.string()).optional()` with no default, and the check skips the exemption entirely when it is undefined (lines 82-87). A default of `["README.md", "CLAUDE.md", "AGENTS.md", "index.md"]` would remove the most obvious noise; note that under F-14's anchoring those are already any-depth patterns, which is what you want here. The message is otherwise good — "link it from another document or mark it an entry point" states the fix, though it does not name the `entryPoints` option that performs it. Loud rather than silent, hence minor.

### F-17 `GRP-001` reports an index ↔ member back-link as a dependency cycle, at `error`

- **severity:** polish
- **command:** `wastech-mdlint lint . --format json` with `{"rule":"GRP-001"}` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** judgment on whether a two-node mutual link is a defect | actual: 8 cycles, all genuine mutual references. Four are one recognizable, deliberate pattern — a README indexing its siblings while a sibling links back: `backend/.rules/README.md -> backend/.rules/architecture.md -> backend/.rules/README.md`, the same in `mobile/.rules/`, and `docs/v2/implementation/ui-e2e/README.md -> phase-1-playwright-foundation.md -> README.md`. | exit: 1
- **repro:** two documents that link to each other.
- **where to fix:** judgment, not code — recorded because the plan asks whether a finding is a real defect. All 8 are accurate and the message prints the full cycle path, which is exactly what a fix needs. But at `error` severity a normal documentation shape fails the build, and the likely user response is to disable `GRP-001` rather than restructure — which costs the genuine 3- and 4-node cycles it also found (`app-shell -> global-sync-status -> ui-controls -> app-shell`, and a 4-hop chain in `mobile/docs/`). Consider a minimum-cycle-length option, or default severity `warning`. If the current behavior is intended, `docs/mdlint_v2/accepted-behaviors.md` is where that belongs.

### F-18 `init` can only ever infer 8 of the 24 built-in rules

- **severity:** polish
- **command:** `grep -o '"[A-Z]\{3,4\}-[0-9]\{3\}"' packages/core/src/discovery/rule-inference.ts | sort -u`
- **expected:** — | actual: the inference vocabulary is `CTX-001 CTX-002 GRP-001 REF-001 REF-002 REF-003 SEC-001 TBL-002`. The other 16 — including `SIZE-001` and `LLM-001`, the two LLM-context rules the README leads with — are never proposed, so a user reaches them only by reading the rule table and hand-writing config. | exit: 0
- **repro:** as above.
- **where to fix:** `packages/core/src/discovery/rule-inference.ts`. Concretely reachable for this target: the scan already samples file sizes, and the corpus has a 96 KB document, so `SIZE-001` with a derived budget is inferrable; `CLAUDE.md`/`AGENTS.md` with `@` imports are detectable, so `LLM-001` is too. Recorded as polish because it is a scope choice, not a defect — but combined with F-13 it means nothing guides a user to a working size budget from either direction.

### F-19 `graph --format human` emits four single lines of 3.5–3.9 KB in a 77-line report

- **severity:** minor
- **command:** `wastech-mdlint graph . --format human` (cwd=/Users/a1234/Documents/GitHub/debates, 139-node graph)
- **expected:** a report readable in a terminal — which is what the format name promises | actual: 77 lines / 19790 bytes, of which four lines are comma-joined blobs:

| Line                                  | Length     |
| ------------------------------------- | ---------- |
| one `clusters` entry (88 files)       | 3904 chars |
| `reading order (66): …`               | 3668 chars |
| `excluded from reading order (73): …` | 3561 chars |
| `entry points (61): …`                | 3497 chars |

The remaining sections — `top hubs`, `cycles`, `coverage` — are correctly formatted one item per indented line. So the format is internally inconsistent: three sections are line-oriented, three are single-line blobs. exit: 0

- **repro:** `graph` on any corpus with more than a handful of entry points.
- **where to fix:** `packages/core/src/graph/graph-render.ts` — render these three like `top hubs` already is. Note the plan's own command is `graph . --format human | head -60`, which assumes line-oriented output; with these blobs `head` truncates the report but not the unreadable lines. `--format json` (216 KB), `mermaid` (21 KB) and `dot` (29 KB) are all fine.

### F-20 the `excluded from reading order` set exists only in the human format

- **severity:** minor
- **command:** `wastech-mdlint graph . --format human` vs `--format json` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** format parity for a section the human report treats as first-class | actual: human prints `excluded from reading order (73): …`. The JSON has top-level keys `nodes, edges, components, readingOrder, coverage`, and `coverage` has only `nodeCount, edgeCount, filesOutsideCorpus`. There is no `excluded` field — a machine consumer must derive it as `nodes` minus `readingOrder`. | exit: 0
- **repro:** compare the two outputs.
- **where to fix:** `packages/core/src/graph/graph-render.ts` / the JSON serializer — expose the same set, and ideally say _why_ a node is excluded. 73 of 139 nodes excluded from reading order — including all of `docs/v2/requirements/mobile-pages/*` and `docs/v2/architecture/*`, i.e. the substantive documentation — is a large enough share that a reader will ask, and neither format answers.

### F-21 the generated `SKILL.md` spends 90% of itself on an edge list, and 0.4% on how to work in the repo

- **severity:** major
- **command:** `wastech-mdlint compile --cwd . --dry-run` (cwd=/Users/a1234/Documents/GitHub/debates, 139 docs)
- **expected:** context an agent can act on | actual: 110789 bytes / 831 lines / **~27697 tokens by the tool's own estimate**, apportioned:

| Section                                   | Lines | Bytes     | Share     |
| ----------------------------------------- | ----- | --------- | --------- |
| `Document Dependencies`                   | 648   | **99376** | **89.7%** |
| `Document Architecture` (a 139-row table) | 144   | 10340     | 9.3%      |
| `Workflow`                                | 7     | 395       | 0.4%      |
| `Document Rules`                          | 18    | 321       | 0.3%      |
| `Context Budget`                          | 5     | 107       | 0.1%      |
| front matter                              | 9     | 250       | 0.2%      |

Inside `Document Dependencies` sits a **single line of 17530 characters** — the `- to:` fan-out for `ui-controls.md`, whose 290 references are emitted comma-joined on one line — plus a 3819-char line and a 3702-char `Excluded from reading order:` line. exit: 0

- **repro:** `compile --dry-run` on any corpus with a high-in-degree hub.
- **where to fix:** `packages/core/src/compile/synthesize.ts`. The plan asks whether the output is "usable context for that repo, or a table of contents". It is neither: it is a **graph dump**. The two sections that would tell an agent how to operate — `Document Rules` (which is well-built: grouped by family with human descriptions) and `Workflow` (sensible but generic, and presumably identical for every repo) — together are 0.7% of the artifact, while the edge list an agent cannot act on is nine tenths. For scale: the skill is ~8.7% of the 318912-token corpus it describes, and a Claude Code skill file is loaded into context whole. Cap or summarize the fan-out (`hubMinInDegree` exists but governs role assignment, not this), and give the budget back to rules and workflow.

### F-22 the node-role vocabulary collapses — two of five roles absorb 83% of the corpus

- **severity:** minor
- **command:** `wastech-mdlint compile --cwd . --dry-run` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** five role names that each carry information | actual: of 139 nodes — `hub` 66, `isolated` 50, `entry` 11, `bridge` 8, `leaf` 4. `hub` + `isolated` = 116 (83%), and in practice they read as "has edges" / "has no edges". | exit: 0
- **repro:** as above.
- **where to fix:** `packages/core/src/compile/synthesize.ts` role assignment. A reader of the `Document Architecture` table learns almost nothing from the `Role` column, because the modal value covers half the rows. `hubMinInDegree` is exposed in `config.compile` and is presumably the knob, but its default puts 66 documents in one bucket; either raise it or subdivide.

### F-23 an `--outdir` outside the repository is reported as a five-level `../../../../..` path

- **severity:** polish
- **command:** `wastech-mdlint compile --cwd . --outdir "$SB/skill-out"` (cwd=/Users/a1234/Documents/GitHub/debates, `$SB` outside the repo)
- **expected:** the absolute path, or something a user can read | actual: `SKILL.md written to ../../../../../private/tmp/claude-501/-Users-a1234-Documents-GitHub-wastech-mdlint/33e47d72-17a4-40ab-98fd-de21861b25ab/scratchpad/mdlint-field-test/skill-out/SKILL.md` | exit: 0
- **repro:** any `--outdir` that is not under the repository root.
- **where to fix:** `packages/cli/src/commands.ts` — the repo-relative-POSIX normalization that `AGENTS.md` mandates for public output is right inside the repo and actively worse outside it. Fall back to the absolute path once the relative form needs a leading `..`.

### F-24 the MCP text block drops the `hint` on the unknown-rule path, so the did-you-mean the CLI shows is invisible to a host

- **severity:** minor
- **command:** `tools/call` `lint` with `{"rules":[{"rule":"REF-01"}]}` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** the same diagnostic the CLI gives — `Unknown rule "REF-01". Did you mean "REF-001"?` | actual: `structuredContent` carries the full contract (`code: "INVALID_INPUT"`, `message: 'Unknown rule "REF-01".'`, `hint: 'Did you mean "REF-001"?'`), but `content[].text` is only `Unknown rule "REF-01".` — the suggestion is dropped. The CLI on the same typo prints `- rules[0]: Unknown rule "REF-01". Did you mean "REF-001"?` | exit: n/a (`isError: true`)
- **repro:** as above; compare against `wastech-mdlint lint .` with the same rule id in the config.
- **where to fix:** `packages/mcp-server/src/tools/lint.ts` (or the shared error wrapper). This is an asymmetry, not a global rule — the other error paths do concatenate the hint into the text, verified by asserting `text.includes(structuredContent.hint)`: `compile-context` / `COMPILE_CONFIG_MISSING` → **YES**, `impact-analysis` / `TARGET_NOT_FOUND` → **YES**, `lint` / `INVALID_INPUT` → **NO**. It matters because the text block is what a host renders and what a model reads, and the dropped sentence is the actionable half. Note the `hint` itself is conditional, not missing: an unknown rule with no near-miss (`NOPE-999`) legitimately returns `{code, message}` with no `hint`.

### F-25 `format` has a third vocabulary on MCP, and the word `json` denotes two different payloads across the two surfaces

- **severity:** minor
- **command:** `tools/call` `context-graph` with `format: "mermaid"` / `"human"` / `"json"` / `"summary"` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** one `format` vocabulary per concept across CLI and MCP | actual: three vocabularies for one flag name in one product, and a collision on `json`:

| Surface | Accepted values | `json` returns |
| --- | --- | --- |
| CLI `graph` | `human`, `json`, `mermaid`, `dot` | `nodes, edges, components, readingOrder, coverage` |
| CLI `lint` / `slice` / `impact` | `text`, `json` | the lint/slice/impact document |
| MCP `context-graph` | `json`, `summary` | `nodes, edges, cycles` |

`format: "mermaid"` and `"human"` — both valid on the CLI's own `graph` — are rejected by the MCP tool with `Invalid option: expected one of "json"|"summary" at format`. And MCP `format: "summary"` returns `nodes, edges, components, readingOrder` — the CLI's `--format json` shape minus `coverage`. So `coverage.filesOutsideCorpus`, the single best diagnostic in the graph report (Phase 6), is **unreachable from MCP in either format**. | exit: n/a

- **repro:** the four calls above, plus `wastech-mdlint graph . --format json` for comparison.
- **where to fix:** `packages/mcp-server/src/tools/context-graph.ts` — the source comment at lines 50-54 documents the two shapes and explains the constraint honestly (`registerTool` takes a single `outputSchema`), so the split is deliberate. What is not defensible is reusing the word `json` for a different document than the CLI's `json`, and dropping `coverage` from both. Rename the raw shape (`raw`?), or make MCP `json` mean what CLI `json` means. This supersedes F-12 in scope: the problem is three vocabularies, not two.

### F-26 schema-level rejections bypass the `{ code, message, hint }` contract entirely — confirmed, and readable but machine-opaque

- **severity:** minor
- **command:** `tools/call` `context-slice` with `depth: -5`; `context-graph` with `format: "mermaid"` (cwd=/Users/a1234/Documents/GitHub/debates)
- **expected:** the documented error contract on every failure path | actual: `isError: true`, **no `structuredContent` at all**, and `content[].text` is the raw transport string — `MCP error -32602: Input validation error: Invalid arguments for tool context-slice: Too small: expected number to be >=0 at depth`. No `code`, no `hint`. | exit: n/a
- **repro:** any argument the tool's own `inputSchema` rejects.
- **where to fix:** `packages/mcp-server/src/` registration layer — the wire schema validates before the handler runs, so the handler's error wrapper never executes. This was a known gap going in; the plan asked whether it still reads acceptably to a host. **Verdict: acceptable to a human, useless to a program.** The message names the offending field (`at depth`, `at format`) and the constraint or the valid set (`>=0`, `expected one of "json"|"summary"`), which is better than most validation errors — a human or a model reading the text can fix the call. But a host that branches on `code`, or surfaces `hint`, sees nothing, and the `-32602` prefix leaks transport detail into user-facing text. Either pre-validate inside the handler so the contract owns every path, or document that schema rejections are contract-exempt.

---

# Phase results

## Phase 1 — build and self-verify

| Gate | Exit | Notes |
| --- | --- | --- |
| `npm ci` | 0 | 395 packages in 7s; EBADENGINE warnings (F-01), 9 advisories (F-03) |
| `npm run typecheck` | 0 | `tsc -b`, up to date; emits, so `dist/` is current for the spawn suites |
| `npm test` | 0 | **67 files, 850 passed, 6 skipped; wall clock 15s** (vitest duration 13.49s) |
| `npm run build` | 0 |  |
| `npm run lint` | 0 |  |
| `npm run format` | **1** | F-02, fixed during the run |

Baseline for comparison against the field runs: `npm test` = 15s wall.

## Phase 2 — install the packed artifacts

`npm pack` of all three workspaces, then one `npm i` of all three tarballs into a bare sandbox: `@wastech-mdlint/core@0.0.0` resolved from the local tarball rather than the registry, both bins linked, and `--version` / `--help` ran from the target's cwd through the `node_modules/.bin/wastech-mdlint` symlink — so the entrypoint guard admits a real npm-shaped spawn, not only the in-repo e2e fixture. Eight commands in `--help`, exit 0. Packed sizes: `core` 205.8 KB, `cli` 47.5 KB, `mcp-server` 20.9 KB. `schema.json` is present in `cli`, matching its `files` allowlist exactly. Payload inspection produced **F-04** and **F-05**, and the sandbox install's `found 0 vulnerabilities` is what downgraded **F-03** to polish.

## Phase 3 — zero-config smoke

| Check | Expected | Actual |  |
| --- | --- | --- | --- |
| exit code | 0 | 0 | ✓ |
| findings | 0 (empty zero-config ruleset) | 0 errors, 0 warnings | ✓ |
| corpus size | 323 | **3063** | ✗ F-06 |
| `node_modules` at any depth | absent | 2740 files, all nested | ✗ F-06 |
| non-`node_modules` count | 323 | 323 | ✓ — the walk is otherwise exactly right |
| `.gitignore` not honored by default | 323 incl. ignored `.worc/` + Pods | confirmed (the 323 includes all 121 ignored) | ✓ |
| determinism (two runs, `cmp`) | byte-identical | **byte-identical** | ✓ |
| wall clock | — | 31s / 29s over 19.30 MB, 3063 files | see F-06 |

Output shape: `{ summary: { files, errors, warnings }, messages, files }`.

## Phase 4 — `init` against a repository it did not design

Ran on throwaway branch `mdlint-field-test`, created from a clean tree. `init . --yes` in **1s**; wrote exactly two untracked files, `wastech-mdlint.config.json` and `schema.json`, and nothing else.

| Check | Result |
| --- | --- |
| `$schema` resolves to a local path, no dangling ref, no remote URL | ✓ `"./schema.json"`, generated beside the config (54211 B, title `wastech-mdlint configuration`) because nothing is installed in the target. The `$schema` _inside_ that file is the draft-2020-12 meta-schema, which is correct and not a config ref. |
| `exclude` covers build/vendor dirs at any depth | ✓ all 11 globs carry the any-depth prefix: `**/.*/**`, `**/.cache/**`, `**/.git/**`, `**/.next/**`, `**/build/**`, `**/coverage/**`, `**/dist/**`, `**/node_modules/**`, `**/out/**`, `**/target/**`, `**/vendor/**`. Confirms F-07's diagnosis: the generator is right, only the README's hand-copy example is wrong. |
| `respectGitignore: true` written alongside | ✓ |
| clusters correspond to real documentation areas | ✓ for visible dirs — `./*.{md,mdx}`, `backend/`, `docs/`, `mobile/`, `tasks/`. Dot-directories dropped: F-11. |
| every enabled rule carries a rationale comment | ✓ all four, and the rationale cites real counts from the target (29 checklist items, 174 relative links, 17 tables) and a real cycle (`backend-architecture.md -> _architecture.md -> backend-architecture.md`) |
| corpus after `init` | **139**, not the predicted 202 — fully accounted for: F-11 |
| `node_modules` at any depth | ✓ 0 files (contrast Phase 3's 2740) |
| nested `.gitignore` honored | ✓ `comm` against `git ls-files` shows nothing linted that git does not track — all 121 ignored files gone, including the 33 under the nested `mobile/ios/.gitignore` |
| wall clock | **2s** for 139 files, against 31s for 3063 — the cost of F-06 measured |

Inferred rules: `CTX-002`, `GRP-001`, `REF-001`, `TBL-002`. First lint under them: 23 errors, 434 warnings, exit 1.

| Idempotency / disposition | Result |
| --- | --- |
| re-run `init . --yes` reports `skip` | ✓ `skipped — existing config left untouched.`; both files byte-identical (shasum), exit 0 |
| `--on-existing merge` warns JSONC comments are not preserved | ✓ twice — in the draft summary and again in the write summary |
| merge keeps every existing rule/severity/option | ✓ `REF-001` kept at `severity: "warning"`, `SIZE-001` kept with `options.bytes.{warn,error}` intact |
| merge appends only new ones | ✓ 3 appended (`CTX-002`, `GRP-001`, `TBL-002`), the 2 existing not duplicated, 5 total; `include`/`exclude`/`settings` untouched; `schema.json` reported "already up to date" |
| merge aborts on an unloadable existing config | ✓ behavior correct and well-worded — but exits 0: F-08 |

Note on method: my first merge fixture was itself invalid (`severity: "warn"`, `options.maxBytes`), so the abort was the tool behaving correctly. Re-ran with a valid fixture to test the merge contract, and kept the invalid one to probe diagnostics — which is where F-08, F-09 and F-10 came from.

## Phase 5 — rule families, one at a time

Run over the full 202-file corpus (dot-directories included, which is how the plan's expected 202 is reachable at all — see F-11). Findings were read by hand and judged, not counted.

| # | Family | Result | Verdict |
| --- | --- | --- | --- |
| 1 | `REF-001/002/003` | 19 errors (16 + 3 + 0) | **19/19 true positives, 0 false positives** |
| 2 | `SIZE-001` | 0 with default options; 17 with explicit budgets | **F-13** (inert by default), **F-15** (token calibration) |
| 3 | `CTX-001/002` | `CTX-001` 0; `CTX-002` 461 warnings | `CTX-001` zero is a verified true negative; `CTX-002` noisy but defensible |
| 4 | `GRP-001/002` | 8 errors + 111 warnings, 3s | **F-17**, **F-16** |
| 5 | `SEC-001/002` | 0 on `tasks/**` | verified true negative — a forced probe fires correctly |
| 6 | `LLM-001` | 0 at 8000 tokens; 4 at 100 | imports _are_ resolved |
| 7 | `custom` | 0 positive / 18 negative control | works correctly, no defects |

**Family 1 — every REF finding is real.** The 16 `REF-001` reduce to three authoring mistakes, each an off-by-one `../`: `docs/v2/implementation/ui/structure-map.md` line 115 (four links, all needing one more level), `mobile/docs/tasks/done/TASK-0*.md` (five links), and `mobile/docs/testing.md:97` (missing the `ui/` segment). Two more are genuinely stale: `docs/v2/implementation/ui-e2e/README.md` → `../PROGRESS.md` (absent), and `mobile/docs/pages-and-components.md` → `../src/app/pages/home/*.ts` where `mobile/src/app/pages/home/` no longer exists at all.

The 3 `REF-002` needed the most care, because a slugger that disagrees with GitHub would manufacture exactly this shape of false positive. It does not. Fixture `$SB/repro-slug` links to GitHub-correct anchors for `## M6 — Invitations + counter-proposal ✅ (2026-07-03)`, `## M7 — Pauses, Topic и Completion ritual ✅ (2026-07-03)` (Cyrillic + comma) and `## Hello World`, and reports **0 errors** — em-dash, `+`, emoji, parens, comma and Cyrillic all slug exactly as GitHub does. So the three target findings are true: the links carry `#m6--invitations--counter-proposal-`, the slug of the heading _before_ ` (2026-07-03)` was appended. A heading gained a date and three anchors went stale — precisely the defect class the rule exists for. One polish note: the message names the anchor and the target file but does not offer the nearest heading slug, so the reader recomputes the slug by hand. The codebase already has did-you-mean machinery on the config path.

**Family 3 — `CTX-002`'s noise is real but the user has the tool for it.** 461 warnings, concentrated: 97 in `docs/v2/testing/local-e2e/03-checklist.md`, a manual test checklist whose boxes are _meant_ to be unticked in the repository. Scoping it away is what `files`/`exclude` are for. The residue is genuinely interesting though — 22, 17, 15 and 12 unchecked items in `mobile/docs/tasks/done/TASK-0*.md`, i.e. tasks filed as done with incomplete checklists. That is a true positive of real value, and it is what the rule is for.

**Family 6 — the eager imports are resolved, confirmed arithmetically.** With `maxTokensPerEntrypoint: 100` forcing a report: `CLAUDE.md` → 783 tokens, `importedFiles: 1`. Hand check: `CLAUDE.md` is 110 tokens and its `@AGENTS.md` is 673 → 783 exactly. Likewise `mobile/CLAUDE.md` 94 + `mobile/AGENTS.md` 1048 = 1142 ✓, and `backend/AGENTS.md` 170 + its `@CLAUDE.md` 2702 = 2872 ✓. So the closure is walked and counted correctly; only the per-token calibration is in question (F-15). Incidental confirmation of F-14: `entrypoints: ["CLAUDE.md"]` also matched `backend/CLAUDE.md`, which is how the anchoring question surfaced.

**Family 7 — declarative custom rules hold up on real data.** Five rules over the real 8-column, Cyrillic-headed table in `docs/v2/requirements/mobile-pages/_mobile-pages.md` (`requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnUnique`, `linkResolves`): 0 findings, correct. Negative control — demanding absent columns `Owner`/`Deadline` and an impossible value set — produced 18 precise errors: `Table is missing required column "Deadline".` at the header line, and `Cell value "Required" in column "Статус v2" is not one of the allowed values: Optional.` at each data row, each attributed to the custom rule's own `id`. Cyrillic column names work.

## Phase 6 — graph, slice, impact, fix, exit codes

Run on branch `mdlint-field-test` with the `init`-generated config (139 nodes), i.e. what a real user gets.

**`graph`** — 139 nodes, 683 edges, 7 cycles, 2s. All four formats **byte-identical across two runs**. `mermaid` is structurally clean: 823 lines = 1 header + 139 node declarations + 683 edges, edges typed (`n1 -->|import| n0`, `-->|link|`), and zero labels containing mermaid-hostile characters. `dot` likewise well-formed. Judged against the repository's real shape:

- **`top hubs` is genuinely right.** `docs/v2/requirements/mobile-pages/ui-controls.md (290)` is the shared UI-vocabulary document every page spec cites; `docs/v2/architecture/backend-architecture.md (75)` and `backend/docs/implemenation/pre-implementation-audit.md (68)` follow. A maintainer would name these three.
- **`clusters` is less useful than it sounds** — it is connected components, so this corpus yields one blob of 88 nodes plus ~50 singletons. The 28 sibling `mobile/docs/tasks/done/TASK-*.md` files are obviously one family to a human but appear as 28 separate clusters because they do not link to each other. Not wrong; just not the grouping the word suggests.
- **`coverage.filesOutsideCorpus` (12) is the best diagnostic in the report** and it is exactly F-11's evidence: the 12 files are `backend/.rules/*` and `mobile/.rules/*` — documents the corpus links to but does not lint. `init` had this information at write time and did not print it.
- Formatting and parity problems: **F-19**, **F-20**.

**`slice`** — correct on all three cases, and resolution is exact as documented:

| Query | Result |
| --- | --- |
| `docs/v2/glossary.md --depth 2` | `matched: path`, 1 file (a leaf, no outgoing edges) |
| `#глоссарий --depth 1` | `matched: anchor (docs/v2/architecture/backend-architecture.md)`, 23 files — a Cyrillic anchor slug resolved exactly |
| `does-not-exist.md` | `No match for query "does-not-exist.md".`, exit **0**; JSON gives `matchKind: null`, empty `starts`/`files`/`visited` |

**`impact`** — the strongest command in the set. `docs/v2/requirements/_idea_v2.md` → 4 directly affected with per-file reference counts, 13 transitively affected each annotated `(depth 2, via <file>)`. The `via` attribution is correct: `backend-architecture.md` is the real fan-out point into the milestone phase files. `ui-controls.md` → 17 direct, consistent with its hub score of 290. Out-of-corpus input exits **2** with an actionable hint: `File not found in the context graph: "mobile/src/main.ts". The path must be repository-relative POSIX (for example "docs/guide.md") and included by the configured file globs.`

**Exit codes — the contract holds in all ten cases**, including the subtle one:

| Command | Exit |  |
| --- | --- | --- |
| `lint .` (23 errors) | 1 | ✓ |
| `lint . --fail-on error` | 1 | ✓ |
| `lint . --fail-on warning` | 1 | ✓ |
| `lint . --fail-on off` | 0 | ✓ |
| `lint .` on a warnings-only corpus, default `--fail-on` | **0** | ✓ — `error` is the default threshold |
| same corpus `--fail-on warning` / `--fail-on off` | 1 / 0 | ✓ |
| `lint ./nope` | 2 | ✓ `Target path does not exist: nope` |
| `lnit .` | 2 | ✓ `error: unknown command 'lnit'` + `(Did you mean one of init, lint?)` |
| `lint . --fail-on bogus` | 2 | ✓ names the valid choices |
| `lint <a-file>.md` | 2 | ✓ `Target path is not a directory` — `[path]` is documented as a directory |

`1` is reserved for findings throughout. Method note: a first pass appeared to show all three `--fail-on` values returning 2; that was my own shell error — zsh does not word-split an unquoted `$args`, so the flag and its value arrived as one argument. Re-run with explicit arguments, everything above is what the tool actually does.

**`--fix`** on `mobile/docs/architecture.md`, the corpus's one fixable finding (`TBL-002`, empty cell in column `Example` at line 139):

- The edit is surgical — 1 insertion, 1 deletion. The empty cell became `TODO`; column alignment, the surrounding table, and the rest of the file are untouched. Problem count 457 → 456.
- **Run 2 is a true no-op**: identical problem count, file byte-identical by `shasum`, `git diff --stat` unchanged.
- Byte hygiene is clean: LF count unchanged at 158, still no CRLF, file still ends with a newline, and no trailing whitespace was introduced.

**Inline suppression** — exact. Inserting `<!-- wastech-mdlint-disable CTX-002 -->` after the first heading of `docs/v2/testing/local-e2e/03-checklist.md` silenced all 97 of that file's `CTX-002` findings and nothing else: corpus `CTX-002` went 433 → 336 (exactly −97) while `GRP-001` (7) and `REF-001` (16) were untouched. The test file was restored afterwards.

## Phase 7 — `compile`

**Missing `compile` section — handled exactly as the plan requires.** Both `--dry-run` and `--outdir` exit **2** with `Cannot compile a SKILL.md: config.compile is missing. Add a "compile" section to the config with at least "compile.skill.name" and "compile.skill.description".` No stack trace, and — worth noting — the `--outdir` directory was not created, so a failed run leaves nothing behind.

With a `compile` section (`skill.name` + `skill.description`, the two required keys the error named):

| Check | Result |
| --- | --- |
| `--dry-run` exit / size | 0 / 110789 B, 831 lines |
| two `--dry-run` runs byte-identical | ✓ |
| `--outdir` write | ✓ exit 0, created the directory, wrote `SKILL.md` and nothing else |
| written file identical to `--dry-run` output | ✓ `cmp` clean |
| two writes byte-identical | ✓ same `shasum` |
| content hash emitted | ✓ `Generated from 139 docs, 4 rules · content hash sha256:02fb09c222250c87` |
| default outdir | confirmed `.claude/skills/wastech-mdlint/` (`packages/cli/src/commands.ts:46`) — the plan's safety rule 3 was accurate, so every run here used an explicit sandbox outdir |
| honest about what it cannot know | ✓ `No entrypoints configured (LLM-001 not enabled).` |

Read as an agent would: **F-21** — it is a graph dump, not working context. **F-22** — the role column carries little information. **F-23** — the write message mangles an out-of-repo path.

Method note: my first attempt to add the `compile` section stripped the config's JSONC comments with a regex that also ate the trailing commas, producing invalid JSON. The tool's response was still the clean `config.compile is missing` message rather than a parse crash — but the run proves nothing about compile, so the config was rebuilt from scratch and everything above is from that run.

## Phase 8 — MCP server

Driven over real stdio JSON-RPC: `initialize` → `tools/list` → `tools/call`, spawning the sandboxed bin from the target's cwd. A `.mcp.json` was written on the branch declaring that bin, and the final battery was spawned through the command string read out of it, so the host wiring is exercised rather than assumed. `initialize` returns `serverInfo {name: "wastech-mdlint-mcp", version: "0.0.0"}`, protocol `2024-11-05`, capabilities `{tools:{listChanged:true}}`; the readiness line `wastech-mdlint-mcp: ready (stdio)` goes to **stderr**, leaving stdout clean for the protocol.

All six tools registered with correct schemas:

| Tool | `required` | `structuredContent` keys returned | Documented as structured |  |
| --- | --- | --- | --- | --- |
| `lint` | `content`, `rules` | `messages, errorCount, warningCount` | yes | ✓ |
| `lint-files` | — | `messages, files, errorCount, warningCount` | yes | ✓ |
| `context-graph` | — | `nodes, edges, cycles` (`json`) / `nodes, edges, components, readingOrder` (`summary`) | yes | ✓ but F-25 |
| `context-slice` | `query` | `query, matchKind, starts, files, visited` | yes | ✓ |
| `impact-analysis` | `file` | `file, directlyAffected, transitivelyAffected, readingOrder, excluded` | yes | ✓ |
| `compile-context` | — | none — text only | **no** | ✓ correct |

`compile-context`'s lack of `structuredContent` is documented (`README.md`'s tool table says `no`), so it is correct rather than a gap. The other five all deliver. Worth noting that `impact-analysis` **does** expose `excluded` in its structured output — the field F-20 finds missing from the graph JSON.

Behavioral checks:

- `lint` on ad-hoc content used the synthetic path `content.md` as documented and fired `REF-001` on a broken link; `CTX-001` correctly did not fire on a section that had content.
- `context-slice` on a real path resolved `matched: path` with 23 files; on `does-not-exist.md` it returned the honest empty result — `isError: false`, `structuredContent` present, text `No match for query "does-not-exist.md".` — matching the CLI exactly.
- `impact-analysis` returned the same 4-direct / 13-transitive analysis as the CLI.
- `compile-context` returned the byte-identical `SKILL.md` including the same content hash.
- F-19's 3.5 KB blob lines reach the MCP text surface too: the `context-graph` text block is the human report regardless of `format`, so a host renders the same unreadable `entry points (61): …` line.

**The error contract holds where the handler runs**, and the codes are meaningful:

| Failure | `isError` | `structuredContent` | Code |
| --- | --- | --- | --- |
| `impact-analysis` on an out-of-corpus file | true | `code, message, hint` (+ empty result fields) | `TARGET_NOT_FOUND` |
| `compile-context` with no `compile` section | true | `code, message, hint` | `COMPILE_CONFIG_MISSING` |
| `lint` with an unknown rule id | true | `code, message` (+`hint` when a near-miss exists) | `INVALID_INPUT` |
| `context-slice` with `depth: -5` | true | **none** | — (F-26) |
| `context-graph` with `format: "mermaid"` | true | **none** | — (F-26) |

**The documented security boundary is real.** `STR-001` — whose options take file paths — rejects escapes rather than following them: `files: ["/etc/hosts"]` → `Required file "/etc/hosts" escapes the analyzed root and cannot be verified.`, and `files: ["../../../../etc/hosts"]` → the same. A `lint-files` call with `patterns: ["/etc/hosts"]` returned `files: []` — nothing outside the repository was read. `files: ["README.md"]` reports "missing from the project", which is correct for this tool: `lint` does not load project config, so its corpus is the one synthetic document, exactly as the README states.

New findings: **F-24** (hint dropped from the text on one path), **F-25** (third `format` vocabulary, `json` collision, `coverage` unreachable), **F-26** (schema rejections bypass the contract — confirmed, with a verdict).

---

## Target repository state

Everything the run wrote lived on the throwaway branch `mdlint-field-test`, created from a clean `master`: one intended `--fix` edit to `mobile/docs/architecture.md`, plus untracked `wastech-mdlint.config.json`, `schema.json` and `.mcp.json`. Nothing else, at any point — `git status --short` was checked after every phase. The branch was deleted and `master` restored at the end; the CLI was never installed into the target, so its `package.json` and `node_modules` were never touched.

## Plan corrections this run earned

Two expected numbers in the plan are wrong, and both are worth fixing there once the underlying defects are decided:

- Phase 3 expects **323** files and states that `node_modules` is excluded by default. It is not (F-06); the real zero-config number is 3063.
- Phase 4 expects **202** files after `init`. The real number is 139, because `init` writes a hidden-directory exclude (F-11). 202 is reachable only by adding the dot-directories back to `include` explicitly, which Phase 5 did.
