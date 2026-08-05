# Cross-check: the deep-research report against the field test (2026-08-05)

> **Question:** how many of the 26 defects a practical run against an external repository found were already in [`report.md`](report.md), and what does the answer say about the quality of that research?
>
> **Sources:** [`report.md`](report.md) (40 live findings F1–F41, audited at `d96b64c`) versus [`field-test-2026-08-05-debates-results.md`](../../mdlint_v2/field-test-2026-08-05-debates-results.md) (26 findings F-01–F-26, produced by running the packed CLI and MCP server against a private Angular/.NET monorepo). Neither document was written with knowledge of the other.
>
> **Verdict in one line:** the report found **4 of the field test's 25 product defects outright and 2 more partially** — and **1 of the 4 the field test names as changing a user's first ten minutes.** It is a strong plan-conformance audit and a weak product audit, and the gap has a single structural cause: it validated the code against its own documentation over hand-built fixtures, never against an unfamiliar repository at scale on the zero-config path.

## Scoreboard

Field-test F-02 was a transient format-gate failure resolved during the run, not a product defect, so the denominator is 25.

| Outcome | Count | Field-test findings |
| --- | --- | --- |
| **Direct hit** — same defect, same code site, same remediation direction | 4 | F-05, F-14, F-15, F-25 |
| **Partial hit** — same mechanism found, class or second half missed | 2 | F-09, F-10 (both to report F13) |
| **Adjacent** — root cause or sibling filed, this symptom not | 3 | F-06, F-07, F-20 |
| **Clean miss** | 16 | F-01, F-03, F-04, F-08, F-11, F-12, F-13, F-16, F-17, F-18, F-19, F-21, F-22, F-23, F-24, F-26 |

Weighted by severity, the picture is worse than the raw count. Of the 9 highest-severity field findings (1 blocker + 8 major): **2 hits, 2 adjacent, 5 clean misses.** Of the four the field test singles out as the ones a new user meets first — F-06, F-11, F-13, F-14 — the report found **one**, and graded it LOW.

## Table A — every field-test finding against the report

| Field | Sev | Finding | Report | Status |
| --- | --- | --- | --- | --- |
| F-06 | **blocker** | Zero-config `lint .` has no default `exclude`; lints every `node_modules` tree (3063 files vs 323) | F25 (LOW) | **adjacent** — F25's own reproduction pulled `node_modules/pkg/README.md` into the corpus and filed it as a documentation gap. The missing default was never asked about. See §3 |
| F-04 | major | No package ships README or LICENSE; none declares `repository` | — | **miss**. The report counted pack payloads three ways (F21, F23) without noticing what was absent from them |
| F-07 | major | README's example `exclude` is root-anchored, under-excludes a monorepo | F25 | **adjacent** — same anchoring rule, opposite direction. F25 covers slash-free widening; F-07 is slash-bearing anchoring, and the README site is unchecked |
| F-08 | major | `init --on-existing merge` refuses to write and still exits `0` | — | **miss**, inside the file the report traced most deeply (`init-command.ts`, 8 cited lines, reproduced twice) |
| F-11 | major | `init` silently drops every dot-directory — 63 files, 31% of the corpus | — | **miss**. The report's traced property for `discovery` is literally this chain: "scan prune → written `exclude` → pinned `respectGitignore`", verified as internally consistent |
| F-13 | major | `SIZE-001` accepts an entry with no metric and does nothing, silently | — | **miss**. `size.ts` was read (cited at `:71`) and `SIZE-001.md` prose compared to code |
| F-14 | major | Glob anchoring rule undocumented and surprising in both directions | **F25** | **hit** — same line `globs.ts:14`, same doc gap, same remediation |
| F-15 | major | Token estimate is `chars/4`, language-blind, under-reports | **F31** | **hit** — same line `tokens.ts:5`, same chars-vs-bytes defect, same multi-byte concern |
| F-21 | major | Generated `SKILL.md` is 90% edge list, 0.4% workflow | — | **miss**. The report's compile output was 1415 bytes; the field test's was 110789 |
| F-01 | minor | `engines` pins Node above the developer's own, no runtime check | (F28) | **miss**. F28 touches `--engine-strict=false` in the WSL wrapper only; the advisory pin itself is unfiled |
| F-02 | minor | Format gate red on an in-flight docs edit — resolved | n/a | not a product defect |
| F-05 | minor | Shipped sourcemaps are dangling; ~half the packed size | **F23** | **hit** — same mechanism, same counts (168 maps in `core`), same three remediation options |
| F-09 | minor | Validator's second stage drops the file path and changes notation | F13 | **partial** — the two-formatter notation split is F13's core evidence. The dropped `displayPath` (`Invalid config:` with no filename) is missed |
| F-10 | minor | `severity: "warn"` reports only `Invalid input` | F13 | **partial** — same collapse, but F13 bounds the class to custom rules only, which is wrong. See §4 |
| F-16 | minor | `GRP-002` has no default `entryPoints`; flags the repo's own entry points | — | **miss**. `entryPoints` appears in the report once, inside F1's blast-radius list |
| F-19 | minor | `graph --format human` emits four lines of 3.5–3.9 KB | — | **miss**. The report ran the human format twice (F11, F26) on fixtures too small to produce a blob |
| F-20 | minor | `excluded from reading order` exists only in the human format | F11 | **adjacent** — same file, same class (graph output parity), different missing field |
| F-22 | minor | Node-role vocabulary collapses: 2 of 5 roles absorb 83% of nodes | — | **miss**. `hubMinInDegree` appears nowhere in the report |
| F-24 | minor | MCP text drops the `hint`, hiding the did-you-mean the CLI shows | — | **miss**. The report cites 7 line numbers inside `tools/lint.ts` and never compares `content[].text` against `structuredContent.hint` |
| F-25 | minor | `format` has a third vocabulary on MCP; `json` means two payloads | **F11** | **hit** — byte-identical reproduction on both hosts, same remediation |
| F-26 | minor | Schema-level rejections bypass the `{code, message, hint}` contract | — | **miss** — and the mechanism is spelled out at `config-schema.ts:77-79` ("the MCP SDK validates tool input _before_ the handler runs, so a malformed custom entry rejected at the wire would come back as raw InvalidParams text with no structuredContent instead of the M6 payload"), three lines above the `ruleEntrySchema` declaration the report cites four times |
| F-03 | polish | 9 npm advisories in the workspace; shipped tree clean | — | **miss** (note-only either way) |
| F-12 | polish | `--format` vocabulary differs on `graph` vs every other command | (F11) | **miss** — F11 covers the CLI/MCP `json` collision, not the CLI-internal `text` vs `human` split |
| F-17 | polish | `GRP-001` calls an index ↔ member back-link a cycle, at `error` | — | **miss** (a judgment finding, arguably outside a conformance audit's remit) |
| F-18 | polish | `init` can only ever infer 8 of the 24 built-in rules | — | **miss**. `rule-inference.ts` was read (cited at `:114`) |
| F-23 | polish | An out-of-repo `--outdir` is reported as `../../../../..` | — | **miss**. The report gave invariant 7 (repo-relative POSIX paths) a clean "Upheld" |

## 1. The four direct hits

These are unambiguous, and they are the evidence that the research did find real product defects rather than only paperwork drift. In each case the two documents were written independently and converge on the same line of code.

- **F-05 ↔ F23 — dangling sourcemaps.** Both reach `sources: ["../src/index.ts"]` with no `sourcesContent` against a `files` allowlist shipping `dist` only; both count 168 maps in `core`; both offer the same three-way choice (ship `src`, set `inlineSources`, or drop the map emit). The field test adds that maps are roughly half the 205.8 KB packed size.
- **F-14 ↔ F25 — glob anchoring.** Both land on `globs.ts:14`, both establish that the rule is documented on exactly one rule page and absent from the pages where a user writes config, and both reproduce the same surprise (a slash-free pattern reaching `node_modules`). The field test extends it with the `./` anchoring prefix and the slash-bearing direction; the report bounds the documentation class by grep. Complementary, not redundant.
- **F-15 ↔ F31 — the token heuristic.** Both find `Math.ceil(text.length / 4)` counting UTF-16 code units where the documentation implies bytes, and both identify multi-byte content as where it breaks. The report frames it as one wrong page out of seven (LOW, one-word fix); the field test measures it on a 70.3% Cyrillic document, shows the error runs in the unsafe direction for a budget, and notes the README never states the calibration at all. The report audited `docs/guide/` and not the README, which is why it reads as smaller there.
- **F-25 ↔ F11 — the MCP graph shapes.** The reproductions are byte-identical: `["nodes","edges","cycles"]` for `format: "json"` and `["nodes","edges","components","readingOrder"]` for `"summary"`, with `coverage` unreachable from either. Same remediation. The field test adds the third-vocabulary framing and the `mermaid`/`human` rejections.

## 2. Corroborations the field test produced without filing

Three report findings were independently confirmed by numbers in the field test that it did not treat as findings:

- **F38** (all six skipped tests are the Windows path guards): field-test Phase 1 reports `850 passed, 6 skipped` — the report's exact figures, from a separate run.
- **F17** (two JSON shapes for one lint capability): the field test documents the CLI shape as `{ summary: { files, errors, warnings }, messages, files }` in Phase 3 and the MCP shape as `messages, files, errorCount, warningCount` in Phase 8 — the divergence F17 names, recorded on both surfaces without being flagged.
- **F36** (a seventh CLI command ships): Phase 2 counts eight commands in `--help`.

## 3. The blocker the report had in its hands

This is the most instructive intersection in either document.

Report F25 is graded LOW. Its verification reads: `include: ["*.md"]` pulled `node_modules/pkg/README.md` into the corpus. So the report **reproduced Markdown inside `node_modules` being linted** and filed it as a documentation gap about pattern anchoring.

Field-test F-06 asks the next question — why was `node_modules` a candidate at all? — and finds `exclude: options.exclude ?? []` at `load-documents.ts:147`, verified again in this pass. There is no lint-time default. The only `node_modules` literals in `core/src` are `init`-only, so the `npx wastech-mdlint lint .` first-run path prunes nothing: 3063 files instead of 323, 19.30 MB parsed instead of 1.9 MB, 31 s instead of 2 s, exit `0`, zero findings, silently.

The report's method explains the miss precisely. It asks whether code contradicts a documented claim. No document promises a default `exclude`, so there was no contradiction to find — while the field test's plan _expected_ `node_modules` to be excluded by default, and that expectation is what turned a passing observation into a blocker. A conformance audit cannot see a defect that the documentation and the code agree about.

## 4. One affirmative error, not a miss: F13's class bound

Report F13 finds the right defect and then bounds it wrongly, in a report whose stated discipline is that "every finding states the search that bounded its class."

F13 claims: "Because the standard branch is permissive on `options`, the only entries that can fail _during_ union matching are `custom` ones — so the class is one family wide, and it is the family whose options no page can document in advance."

Field-test F-10 contradicts this with a built-in rule. Re-verified in this pass against the built CLI, four config shapes:

| Config | Output |
| --- | --- |
| `{"rule":"REF-001","severity":"warn"}` — standard entry | `Invalid config at wastech-mdlint.config.json:` / `- config.rules.0: Invalid input` |
| `{"rule":"REF-001","bogusKey":1}` — standard entry | `Invalid config at wastech-mdlint.config.json:` / `- config.rules.0: Invalid input` |
| `{"rule":"SIZE-001","options":{"maxBytes":10}}` — stage 2 | `Invalid config:` / `- rules[0].options: Unrecognized key: "maxBytes"` |
| `{"includ":[...]}` — root key | `Invalid config at wastech-mdlint.config.json:` / `- config: Unrecognized key: "includ"` |

The bound is wrong because the reasoning covered `options` and stopped there. In `config-schema.ts`, `severity` is `severityOverrideSchema.optional()` — a strict `error | warning | off` enum — on **both** union branches, and `ruleEntrySchema` is `.strict()`. So an invalid `severity` or any unknown key on _any_ rule entry fails both branches, collapses to `invalid_union`, and renders through the root formatter. The class is every rule family, not one; and the trigger is `warn` for `warning`, the single most likely severity typo a first-time user makes.

Two consequences worth recording:

1. **The remediation changes.** F13 proposes discriminating the union on `rule: "custom"` before validation. That fixes the custom-options path and leaves the `severity` and unknown-key paths — the ones a built-in-rule user actually hits — still reporting `Invalid input`.
2. **Requirement C7's verdict changes.** The report grades C7 "partially unmet — the standard path is covered; the custom-rule path bypasses the renderer." The standard path is _not_ covered: it is covered for `options` (stage 2) and uncovered for `severity` and unknown keys (stage 1).

Field-test F-09 adds the half neither pass caught: stage 2 renders `Invalid config:` with no filename, while stage 1 renders `Invalid config at <file>:`. Three diagnostic shapes from one validator, and the one that omits the filename is the one that needs it — the README documents that an ancestor directory's config can govern a run.

## 5. What the misses have in common

Every clean miss falls into one of four buckets. None is a random oversight; each is a direct consequence of the method.

| Cause | Field findings | Why the method could not see it |
| --- | --- | --- |
| **Fixture scale** | F-19, F-21, F-22 | The report's fixtures were 3–6 files and its compile output 1415 bytes. A 3.9 KB comma-joined line, a 110 KB `SKILL.md` that is 90% edge list, and a role vocabulary where 2 of 5 buckets hold 83% of nodes are all invisible below a few dozen documents. The field test's graph had 139 nodes and one hub with 290 references |
| **Default quality, not doc conformance** | F-06, F-13, F-16, F-18 | The audit asks "does the code contradict the documentation?" When both agree an option is optional with no default, there is nothing to contradict. `size.ts:8` even documents the design — "omitting it disables that check" — which makes `SIZE-001` self-consistent and inert at the same time. The defect only exists relative to what a user reasonably expects, which is a question the method never asks |
| **Zero-config and first-run paths** | F-06, F-11, F-18 | The report supplied a config for every reproduction. The blocker and two majors live on the `npx … lint .` path and on `init` run against a repository it did not design. This is where 3 of the field test's top 4 findings are |
| **Process-boundary rendering and exit codes** | F-08, F-23, F-24, F-26 | The report verified exit codes for cases a phase criterion names and read `tools/lint.ts` line by line, but never diffed the human-facing text against the structured payload, never checked `init`'s refusal exit code, and never sent an input the wire schema rejects. Each needs a spawned process and a comparison between two surfaces, not a citation |

A fifth, narrower cause covers F-04 and F-03: the report measured pack payloads (442 files at the root, 26 in `cli`, 204 maps) but asked only what was in them, never what a published npm page would be missing.

## 6. What the field test could not reach

Symmetry matters for the verdict: several report findings are real and the field test's corpus structurally could not exercise them. Verified in this pass rather than assumed.

| Report | Why unreachable |
| --- | --- |
| **F1** (HIGH, `!` negation widens or empties scope) | The field test never wrote a `!` pattern in any config. Its F-14 glob table has no negation row. The report's top finding is neither confirmed nor refuted by the run |
| **F9** (nested `.gitignore` negation cannot re-include) | Checked: the target's 7 `.gitignore` files carry 5 negations, all `.vscode/*.json` and `/build/.npmkeep` — no Markdown. The field test's clean bill on `respectGitignore` is a case the corpus never presented, not counter-evidence |
| **F4** (`REF-001.exclude` inert with any `siteRouter`) | No `siteRouter` was ever configured. REF-001 scored 19/19 on real data with the option's hole untouched |
| **F8** (three definitions of "a Markdown file") | Needs a `.markdown` file; the target has none |
| **F10** (`--config` resolves against two bases) | The flag was never used |
| **F14, F28, F40** | An mtime-only rebuild state, a WSL host, and a `$`-sequence in a generated description — none present |
| **F2, F5, F6, F7, F16, F20, F32, F33, F35, F39, F41** | The governance and plan-of-record tranche. Out of scope for a run against an external repository, and real work regardless |

## 7. Verdict on the research

**Where it is strong.** The report is an excellent audit of the plan against the code. Its governance tranche is real and unreachable any other way: `PLAN.md` does not exist while `AGENTS.md` says it does (F5), 17 dead links inside the plan (F6), an "Accepted (enforced)" decision that names three nonexistent APIs and forbids the async pipeline that shipped (F32), a dependency register claiming `SEC-*` is fixable when only `SEC-001` is (F39). Its one HIGH product finding, F1, is a genuine silent-wrong-answer defect reproduced eight ways and re-run on an independent fixture — and the field test missed it entirely. Its self-discipline is unusual: four upstream claims withdrawn rather than dropped, `read` versus `run` marked per finding, unexamined surfaces enumerated by name.

**Where it is weak.** As a product audit it is thin, and the field test is the measurement. Six of 25 defects covered, one of the four that shape a first impression, and the blocker reproduced-then-mis-graded. The report's own coverage section is honest about the mechanism without naming the consequence: reproductions ran against "purpose-made fixtures in a scratch directory," which is the right tool for confirming a documented contract and the wrong one for finding a bad default, an unreadable report at scale, or a silent no-op on a repository nobody designed for.

**The one thing to correct in the report itself.** F13's class bound is wrong, verified above. It is not a severity disagreement or a matter of framing — it is an affirmative claim of the form the report treats as its own quality bar, and correcting it widens the finding from one rule family to all of them, changes the remediation, and changes C7's conformance verdict.

**What a subsequent pass should add.** Two changes would have caught most of the 16 misses at modest cost: (a) one run of every command against a real external repository with no configuration, then again after `init`, comparing the corpus to `git ls-files` in both directions; and (b) for every user-facing surface, a diff of the human rendering against the structured payload, and of each host's rendering against the other's. Neither requires new method — the report already spawns processes, drives real stdio, and compares hosts. It just never did it at scale, without a config, or on the first-run path.

## Provenance

Produced by reading both documents in full and re-verifying, against the working tree, the field-test code claims the crosswalk depends on: `load-documents.ts:147` (`exclude: options.exclude ?? []`, no lint-time default), `size.ts:32-38` (three metrics `.optional()`, no default), `grp.ts:66-87` (`entryPoints` optional, exemption skipped when undefined), `config-schema.ts:9`/`:83-131` (the `severity` enum on both union branches, `ruleEntrySchema` strict), and the four config diagnostics in §4 reproduced through the built CLI. The target repository's `.gitignore` negations were enumerated to settle §6's F9 row. Keyword absences asserted in Table A were established by grep over `report.md`: `LICENSE`, `on-existing`, `hubMinInDegree`, `inputSchema`, `-32602`, `outdir`, and `excluded from reading order` return zero hits; `hint` returns one, in a completion-table row.
