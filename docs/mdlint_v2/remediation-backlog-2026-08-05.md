# Consolidated remediation backlog (2026-08-05)

> **Purpose:** one deduplicated, task-ready inventory of every defect found by the four assessments below, so implementation tasks can be created from this file without re-reading them.
>
> **Sources, and what each contributes:**
>
> | Document | What it is | What it contributes here |
> | --- | --- | --- |
> | [`docs/research/audit-v2-implementation/report.md`](../research/audit-v2-implementation/report.md) | Deep audit of the shipped v2 implementation against the plan of record at `d96b64c`. 40 live findings F1–F41 (F29 withdrawn) | The plan-conformance and governance tranche, and about twenty product/tooling items nothing else found — W-01, W-06, W-08, W-09, W-10, W-11, W-16, W-18, W-21, W-24, W-30, W-36, W-37, W-38, W-46, W-53, W-54, W-55, W-56, W-58. The field test reached only four of the report's product defects at all (crosscheck §6); do not read that overlap as the report's contribution |
> | [`docs/research/audit-v2-implementation/report-verification.md`](../research/audit-v2-implementation/report-verification.md) | QA pass over that report | **Zero false positives; all 40 confirmed.** Three count/citation corrections applied below, one grade change applied and one declined, plus one ranking change. Bounded: it did not check the report's 78-criterion completion table, its eight-invariant table, or its Requirement-ID conformance section — see [Coverage this backlog does not claim](#coverage-this-backlog-does-not-claim) |
> | [`field-test-2026-08-05-debates-results.md`](field-test-2026-08-05-debates-results.md) | Practical run of the packed CLI and MCP server against an external Angular/.NET monorepo. 26 findings F-01–F-26 | The zero-config, first-run, and real-scale defects — including the only blocker |
> | [`docs/research/audit-v2-implementation/field-test-crosscheck.md`](../research/audit-v2-implementation/field-test-crosscheck.md) | Maps the two finding sets onto each other | The dedup, plus one factual error in report F13 that **widens the fix** |
>
> **58 work items, W-01 – W-58**, in 15 batches sized for one task each. Every item names its source finding IDs, so the original evidence stays reachable.
>
> **These items are now scheduled as phases P13–P17** — 25 tasks, ordered from the defects that give a wrong answer to the ones that only mislead a maintainer. Each task names the `W-NN` items it closes; this document stays the evidence layer beneath them and is not itself a task list.
>
> | Phase | Covers | Batches | Items |
> | --- | --- | --- | --- |
> | [P13 — Corpus & correctness](P13-correctness/index.md) | wrong answers about the repository, with no signal | B1–B5 | W-01 – W-12 |
> | [P14 — Host boundary](P14-host-boundary/index.md) | silent successes and dropped diagnostics at the CLI/MCP edge | B6–B7 | W-13 – W-21 |
> | [P15 — Output contracts](P15-output-contracts/index.md) | one format name, one shape; renderers at real scale | B8–B9, part of B11 | W-22 – W-28, W-34 – W-36 |
> | [P16 — Release readiness](P16-release-readiness/index.md) | the test debt that let this ship, then a publishable payload | B10, B14, B15, rest of B11 | W-29 – W-33, W-37 – W-40, W-54 – W-58 |
> | [P17 — Plan of record](P17-plan-of-record/index.md) | precedence tiers, the completion surface, and self-linting | B12–B13 | W-41 – W-53, plus W-51a/W-52a |
>
> **Before implementing, read the [pre-implementation addendum](#addendum--pre-implementation-audit-of-p13p17).** An audit of the 25 task files found the coverage complete, and found that six line-number anchors into `glossary.md`/`AGENTS.md` — including two this document relies on — were invalidated by this document's own commit. It also adds the two items above and corrects W-42's box counts and W-45's enumeration.

## Corrections applied while merging

A task built from `report.md` alone would get three of these wrong. They are folded into the items below; recorded here so the divergence from the source is deliberate and visible.

| Source claim | Correction | Applied at |
| --- | --- | --- |
| report F13: the diagnostic class is "one family wide" — custom rules only, because the standard branch is permissive on `options` | **Wrong.** `severity` is a strict `error \| warning \| off` enum on **both** union branches and `ruleEntrySchema` is `.strict()`, so an invalid `severity` or any unknown key on **any** rule entry also collapses to `config.rules.0: Invalid input`. Verified in the crosscheck against the built CLI, four shapes. F13's proposed remediation (discriminate the union on `rule: "custom"`) therefore does not close the paths a built-in-rule user actually hits | **W-12** — scope widened to all families; C7's conformance verdict changes with it |
| report F2: 91 unchecked criteria across 29 `Status **Done**` task files | 30 files / 92 boxes — report-verification found F2 counted P0–P3 only and missed `P11-remediation/12-str001-reach.md`; the error runs in the conservative direction | **W-42** |
| report F6: the 11th dead link is at `audit-2026-07-25-post-p9.md:31` | It is at `:3`; `:31` holds a bare code span, not a link. The count of 11 (and 17 total) is right | **W-43** |
| report F21: `npm pack --dry-run` at the root packs 442 files | 445 today — tree drift since `d96b64c`, not an error. Do not treat 442 as a regression baseline | **W-30** |
| report F15 graded MEDIUM | **Grade change applied.** Downgraded to Low: the report itself marks it `by reading` with no measured behavioral effect | **W-10** |
| report F2 graded HIGH, disputed in report-verification as sitting next to a real wrong-answer defect | **Grade change declined**, deliberately: F2's harm is a wrong belief about a release gate, which is worth the same rank as a wrong answer to a user even though it is not the same kind of failure. Recorded here so the divergence from the QA pass is visible rather than silent | **W-42** stays High |
| report F32 ranked below F2 in the documentation tranche | **Ranking change** (not a grade change): raised above it, because a stale enforced ADR makes the next contributor write wrong code while unchecked boxes only mislead | **W-41** before **W-42** |

Two further notes that change scope rather than correctness: field F-09 adds a half neither audit filed — stage 2 of the config validator renders `Invalid config:` with no filename while stage 1 renders `Invalid config at <file>:` (folded into W-12). And report F25's own reproduction pulled `node_modules/pkg/README.md` into the corpus and filed it as a LOW documentation gap; the missing lint-time default behind it is the blocker **W-02**.

## Standing rules that apply to every item

These are repository policy, not per-item advice. A task that skips one is incomplete.

- `npm run format` before committing **any** deliverable, docs-only included. Prose is not hard-wrapped (`proseWrap: "never"`). Never nest a glob-bearing code span inside a bold span — it corrupts silently and the gate passes on the damage (report F34, and **W-49** is the live instance).
- Keep [`glossary.md`](glossary.md) current in the same change that adds, renames, or retires a load-bearing term — not a later pass.
- A behavior accepted instead of fixed goes in [`accepted-behaviors.md`](accepted-behaviors.md) in the same change, with a README or guide home that actually states it. Items marked **decision** below all terminate either in code or in that register.
- Behavior changes carry tests scaled to risk. Where an item falls into one of the four process-boundary guard categories in [`.agents/rules/testing.md`](../../.agents/rules/testing.md), tag the new guard with `@boundary-guard <category>` — `packages/core/test/boundary-guards.test.ts` enforces the pairing. **W-02** is `shared-exclude`; **W-13** and **W-18** are `installed-bin-spawn`.
- Build before test: `npm run typecheck` or `npm run build` first, or the spawn suites assert against a stale `dist/`.

## Master index

Severity here is a **triage rank for sequencing, not a copy of either source's grade**, and the two source scales do not map onto it mechanically. The report's `MED-HIGH` reads as High and `MED-LOW` as Medium; the field test's `major` reads as High and `polish` as Low or Note; its `minor` lands at Medium or Low depending on whether the failure is silent. `Type` says what a task may touch — relevant because a docs-only task must not change product code.

**Consequence: do not sequence by a source grade.** Where an item's rank differs from its source for a reason, that reason is stated at the item — W-05, W-07, W-26 and W-53 are the clearest cases. Nine items are re-graded beyond any reading of the scales, and are collected here so the divergence is auditable in one place:

- **Raised:** **W-01** (report F1 HIGH → Blocker — the wrong-answer defect the Blocker rank exists for, while F2's equal HIGH stays High, per the Corrections table); **W-12** (F13 MEDIUM → High, on the widened scope); **W-41** (F32 MEDIUM → High); **W-49** (F34 INFO → Low); **W-51** (F36/F37 INFO → Low); **W-53** (F35 LOW → High, on leverage); **W-54** (F28 LOW → Medium, the one item breaching a security rule outright).
- **Lowered:** **W-10** (F15 MEDIUM → Low, per report-verification) and **W-36** (F22 MED-LOW → Low).
- **Raised by the merge:** where a field-test finding and a report finding describe one defect at different ranks, the higher governs — **W-03** (report F25 LOW, field majors) and **W-34** (report F31 LOW, field F-15 major). **W-31** is the exception: both sources are low (field `minor`, report LOW) and it sits at Medium on release impact — 204 unresolvable maps at roughly half the packed size, on a `P-release` criterion.

| ID | Sev | Type | Item | Sources |
| --- | --- | --- | --- | --- |
| **B1 — Glob scoping: what lands in the corpus** |  |  |  |  |
| W-01 | Blocker | code, test | A `!` in any glob list widens or empties scope instead of subtracting | report F1 |
| W-02 | Blocker | code, docs, test | No lint-time default `exclude`, so zero-config lints every `node_modules` tree | field F-06 |
| W-03 | Medium | docs (+ optional code) | The glob anchoring rule is undocumented; the README's own example under-excludes | report F25, field F-14, field F-07 |
| **B2 — Rule options and severities that disable or misfire** |  |  |  |  |
| W-04 | High | code, docs | `SIZE-001` accepts an entry with no metric and silently does nothing | field F-13 |
| W-05 | Medium | code, docs | `GRP-002` has no default `entryPoints`, so it flags canonical entry points | field F-16 |
| W-06 | Medium | code, docs | `TBL-003.caseSensitive` has no schema default; three consumers, two wrong | report F12, report F27 |
| W-07 | Medium | decision, code | `GRP-001` reports a two-node index ↔ member back-link as a cycle, at `error` | field F-17 |
| **B3 — Reference and extension resolution** |  |  |  |  |
| W-08 | High | code, test | `REF-001.exclude` goes inert for root-relative links whenever any `siteRouter` is set | report F4 |
| W-09 | Medium | code | Three incompatible definitions of "a Markdown file"; coverage reports one that can never be a node | report F8 |
| W-10 | Low | code, docs | Two disagreeing image-target resolvers against an invariant claiming one | report F15 |
| **B4 — gitignore semantics** |  |  |  |  |
| W-11 | Medium | code, test | Layer precedence is root-first-wins, so a nested negation cannot re-include | report F9 |
| **B5 — Config diagnostics** |  |  |  |  |
| W-12 | High | code, test | Union collapse hides the key and the enum on **every** rule family; stage 2 drops the filename; two path notations | report F13, field F-09, field F-10 |
| **B6 — CLI boundary: exit codes, disclosure, paths** |  |  |  |  |
| W-13 | High | code, test | `init --on-existing merge` refuses to write and still exits `0` | field F-08 |
| W-14 | High | code | `init` never discloses the Markdown files its hidden-directory exclude drops | field F-11 (b) |
| W-15 | Medium | decision, code | Is a lint-time hidden-directory exclude the right default at all? | field F-11 (a) |
| W-16 | Medium | code, test | `--config` resolves against two different bases across six handlers | report F10 |
| W-17 | Low | code | An out-of-repo `--outdir` renders as `../../../../..` | field F-23 |
| **B7 — MCP boundary: validation and error contract** |  |  |  |  |
| W-18 | High | code, test | A nonexistent `cwd` silently succeeds on all five file-based tools | report F3 |
| W-19 | Medium | code, test | The text block drops the `hint`, hiding the did-you-mean the CLI shows | field F-24 |
| W-20 | Medium | decision, code | Schema-level rejections bypass the `{code, message, hint}` contract entirely | field F-26 |
| W-21 | Medium | decision, code, docs | No operational error code: the same failure is actionable on CLI, anonymous on MCP | report F19 |
| **B8 — Output shapes and cross-host parity** |  |  |  |  |
| W-22 | Medium | code, docs | Graph JSON `coverage`: undocumented on five surfaces, unreachable from MCP, and `json` denotes two shapes | report F11, field F-25 |
| W-23 | Medium | code | `excluded from reading order` exists only in the human format | field F-20 |
| W-24 | Medium | code, docs | Two JSON shapes for one lint capability; the guide documents a `pass/fail` field that does not exist | report F17 |
| W-25 | Low | code, docs | `--format` vocabulary differs on `graph` versus every other command | field F-12 |
| **B9 — Rendering at real scale** |  |  |  |  |
| W-26 | High | code | `graph --format human` emits four single lines of 3.5–3.9 KB | field F-19 |
| W-27 | High | code | The generated `SKILL.md` spends 90% of itself on an edge list and 0.4% on workflow | field F-21 |
| W-28 | Medium | decision, code | The node-role vocabulary collapses: two of five roles absorb 83% of nodes | field F-22 |
| **B10 — Packaging and release readiness** |  |  |  |  |
| W-29 | High | packaging | No package ships a README or LICENSE, and none declares `repository` | field F-04 |
| W-30 | Medium | tooling, docs | `release:check` packs the private root and validates no package's `files` | report F21 |
| W-31 | Medium | packaging | 204 published source maps point at a `../src` the tarballs do not ship | field F-05, report F23 |
| W-32 | Low | decision, packaging | The `engines` pin is advisory: no `engine-strict`, no runtime guard | field F-01 |
| W-33 | Note | docs | 9 dev-chain advisories; the shipped tree installs clean | field F-03 |
| **B11 — User-facing documentation accuracy** |  |  |  |  |
| W-34 | Medium | docs, code | Token heuristic: wrong unit on Concepts, and the calibration is disclosed nowhere a reader of the number will look | report F31, field F-15 |
| W-35 | Medium | docs, decision | JSON emits eight message keys where the guide names five; `helpUri` holds a bare rule ID at 27 sites | report F18 |
| W-36 | Low | code, docs | R6's `docsUrl` and `messages` are threaded but never set or read | report F22 |
| W-37 | Low | code | The generated schema hardcodes the custom `target` vocabulary twice instead of deriving it | report F30 |
| W-38 | Low | code | One rationale comment still calls the P4.06 coverage seam open | report F26 |
| W-39 | Low | decision | `init` can only ever infer 8 of the 24 built-in rules | field F-18 |
| W-40 | Low | decision | Four barrel exports and option hooks with no host caller | report F24 |
| **B12 — Plan of record** |  |  |  |  |
| W-41 | High | docs | The one enforced architecture decision contradicts the code twice, and the glossary repeats the load-bearing half | report F32 |
| W-42 | High | docs, decision | No reliable completion surface in either direction — 30 Done task files with 92 unchecked boxes, 33 unchecked index criteria | report F2 |
| W-43 | Medium | docs | 17 dead links inside the plan | report F6 |
| W-44 | Medium | docs | `PLAN.md` and `docs/plan/` do not exist, yet governance says they remain | report F5 |
| W-45 | Medium | docs | Seven stale "P9 means release" references, three in locked requirements | report F7 |
| W-46 | Medium | code, CI, skills | Eleven stale phase-ID lines in shipped runtime, CI, and published skill frontmatter | report F16 |
| W-47 | Medium | docs | Two cross-phase dependency decisions claim more than shipped | report F39 |
| W-48 | Medium | docs | The accepted-behaviors register fails its own contract at three sites | report F20 |
| W-49 | Low | docs | Live Prettier corruption in a phase task file; the format gate passes on it | report F34 |
| W-50 | Low | docs | An orchestrator task file sits in the plan, invisible from its own index | report F33 |
| W-51 | Low | docs | The roadmap lists six CLI commands where seven ship, and diagrams `schema.json` at the root | report F36, report F37 |
| W-52 | Note | docs | The two frozen audits are in Russian; nothing along the precedence chain says so | report F41 |
| **B13 — Self-linting (highest leverage in the docs tranche)** |  |  |  |  |
| W-53 | High | config, CI | This repository has no configuration of its own, so nothing runs the product on its own corpus | report F35 |
| **B14 — Tooling** |  |  |  |  |
| W-54 | Medium | tooling | The WSL npm wrapper interpolates argv and the repo path into a `cmd.exe` line, and disables the engines gate | report F28 |
| W-55 | Low | tooling | The docs generator passes generated content as a regex replacement string | report F40 |
| W-56 | Low | test, docs | The documented build-before-test remedy does not clear the spawn guard on an mtime-only change | report F14 |
| **B15 — Test debt that let this ship** |  |  |  |  |
| W-57 | High | test | No fixture is at real scale, on the zero-config path, or in a dot-directory | field test §summary |
| W-58 | Medium | test | Nothing pins the ad-hoc MCP `lint` step order against `lintFiles` | report, invariant 2 |

### Suggested execution order

1. **W-01, W-02, W-04, W-11** — the four where the tool gives a wrong answer about the repository with no signal that it did: a negated glob, an absent default, an inert rule, and a file real `git` keeps.
2. **W-12, then B6 and B7** — what a user and an agent meet first: the opening config diagnostic, then the host boundary's silent successes and dropped hints.
3. **W-08, W-09, W-10** — reference and resolution correctness (B3), with B4's `git` semantics already carried in step 1.
4. **W-53** first inside the documentation work: it converts B12's whole class from audit findings into a CI failure, and it closes a plan expectation rather than reversing a decision. Land it after **W-43** clears the existing 17 links.
5. **B9, B10** — needed before anything is published or handed to an agent.
6. **W-41 before W-42**, then the rest of B12.

## Items in detail

### B1 — Glob scoping: what lands in the corpus

#### W-01 · Blocker · code, test · A `!` in any glob list widens or empties scope

- **Sources:** report F1 (HIGH, reproduced 8 ways; independently re-reproduced byte-for-byte in report-verification).
- **Where:** `packages/core/src/discovery/globs.ts:37` calls `micromatch.isMatch` with the whole pattern array, which is a first-truthy OR, so a `!` entry compiles to an inverting term. The correct list form already exists ~200 lines away at `packages/core/src/discovery/workspace-packages.ts:254`, with the reason in prose at `:249` and in an ambient declaration at `packages/core/src/types/micromatch.d.ts:8`.
- **Blast radius:** every glob surface — top-level `include`/`exclude`, directory pruning, every rule's `files`/`exclude`, `LLM-001.entrypoints`, `SIZE-001.overrides.pattern`, `CTX-003.glossary`, `REF-006`, `GRP-002.entryPoints`, `GRP-003.chain[].files`, `STR-001` entries, REF-001/003 target `exclude`, `SEC-001`'s inferred scope.
- **Fix — pick deliberately, it is a behavior change either way:** route `matchesConfigGlob` through the list form, **or** reject a leading `!` during config validation. The first delivers negation as a feature and shrinks any corpus that currently relies on the accidental widening; the second turns a silent wrong answer into a loud one without delivering the feature. Also normalize a leading `!` before the depth-agnostic prefix at `globs.ts:14`, or a bare `!keep.md` stays a silent no-op.
- **Accept when:** `include: ["docs/**", "!docs/private/**"]` yields only `docs/public`; `exclude: ["docs/private/**", "!docs/private/keepme.md"]` no longer empties the corpus and no longer exits `0` on a repository with findings; a rule-level negated `files` no longer pulls in a third file; and `packages/core/test/rule-utils.test.ts` carries an ordered-negation case — its silence there is what let this ship.

#### W-02 · Blocker · code, docs, test · No lint-time default `exclude`

- **Sources:** field F-06 (blocker; the symptom was independently reproduced by report F25 and mis-graded LOW).
- **Where:** `packages/core/src/markdown/load-documents.ts:147` — `exclude: options.exclude ?? []`. The only `node_modules` literals in `core/src` are `discovery/repo-scan-constants.ts` and `discovery/config-writer.ts`, both `init`-only, so the `npx wastech-mdlint lint .` first-run path prunes nothing. The schema declares no `default` for `exclude` or `respectGitignore` either.
- **Measured cost:** 3063 files instead of 323 (2740 of them under a nested `mobile/node_modules/`), 19.30 MB parsed instead of ~1.9 MB, 31 s instead of 2 s — at exit `0` with zero findings, because the zero-config ruleset is empty. Silent in every direction.
- **Fix:** ship a lint-time default `exclude` (at minimum the any-depth `node_modules`, `dist`, `build`, `.git` set `init` already writes) and declare it in the schema so an editor shows it. Decide separately whether `respectGitignore` should default `true`.
- **Accept when:** a three-file fixture — `docs/a.md`, `mobile/node_modules/leftpad/README.md`, `node_modules/rightpad/README.md`, no config — lints exactly one file; the guard is tagged `@boundary-guard shared-exclude`; and the field-test plan's Phase 3 expectation of 323 is restored as correct.
- **Also:** fix the stale expectation in [`field-test-2026-08-05-debates.md`](field-test-2026-08-05-debates.md) Phase 3 once the default lands.

#### W-03 · Medium · docs (+ optional code) · The anchoring rule is undocumented, and the README's example under-excludes

- **Sources:** report F25 (LOW), field F-14 (major), field F-07 (major) — one rule, three symptoms.
- **The rule:** `packages/core/src/discovery/globs.ts` returns a pattern containing `/` untouched (root-anchored) and prepends `**/` to a slash-free one (any depth). Internally consistent; documented only at `docs/guide/rules/STR-001.md:25`, and nowhere in `docs/guide/configuration.md`, `docs/guide/config-reference.md`, or `README.md`.
- **Both directions bite:** `exclude: ["node_modules/**"]` prunes only the root copy and silently under-excludes a monorepo — which is exactly what `README.md:127` tells a user to copy — while `include: ["*.md"]` recurses into the whole tree, the opposite of shell, gitignore, and tsconfig. `init` emits `"./*.{md,mdx}"` because the `./` is load-bearing, and nothing says so.
- **Fix:** state the rule where a user writes config (`configuration.md`, `config-reference.md`), and change `README.md:127` to the any-depth prefix. `README.md:80` and `discovery/config-writer.ts:134` are already correct, so only the hand-copy example is wrong.
- **Accept when:** each of the four shapes in field F-14's table has a documented, predictable answer, and the README example prunes a nested `node_modules`. That much is documentation-only.
- **Scope note:** the optional extra — warning when a slash-free directory-ish pattern was probably meant to be anchored — is product code, so it does **not** belong in a docs-only task. Either scope the task as docs-only and drop it, or state the widened scope up front; AGENTS.md forbids a documentation task touching product code either way. It also overlaps W-01's second remediation option (rejecting a leading `!` at config validation), so decide it there rather than twice.

### B2 — Rule options and severities that disable or misfire

#### W-04 · High · code, docs · `SIZE-001` can be enabled into inertness

- **Sources:** field F-13 (major).
- **Where:** `packages/core/src/engine/rules/size.ts:32-39` — `bytes`, `lines`, `tokens` each `.optional()` with no default; the check `continue`s when a metric is undefined (`:84`). Verified against the tree.
- **Why it is a defect and not a documented choice:** `SIZE-001` is the only rule whose options carry no `required` entry. Its nearest sibling `LLM-001` requires `entrypoints` and `maxTokensPerEntrypoint`; `SEC-001` requires `sections`; `SEC-002` requires `order`. A user who enables "File stays within byte / line / token budgets" gets a green run over a 96 KB document and is told nothing. `size.ts:8` documents the design, which is what makes it self-consistent and inert at once.
- **Fix:** mark at least one metric required, matching `LLM-001`, or ship defaults. With explicit thresholds the rule is correct — byte counts matched `stat` exactly on all 10 flagged files.
- **Accept when:** `{"rule":"SIZE-001"}` with no options either errors with a config diagnostic naming the missing metric, or fires against a default budget. Regenerate `schema.json` and the README table in the same change.
- **Pairs with W-39:** `init` never infers `SIZE-001` either, so today neither path lands a user on a working size budget.

#### W-05 · Medium · code, docs · `GRP-002` has no default `entryPoints`

- **Sources:** field F-16 (minor).
- **Where:** `packages/core/src/engine/rules/grp.ts:66` — `entryPoints: z.array(z.string()).optional()`, and `:82-87` skips the exemption entirely when undefined. Verified against the tree.
- **Effect:** 111 orphan warnings on 202 files (55%), including `CLAUDE.md`, `backend/AGENTS.md`, `mobile/CLAUDE.md`, and both `README.md` files — the repository's canonical entry points — plus 50 harness-loaded files that are never linked from Markdown by design.
- **Fix:** default to `["README.md", "CLAUDE.md", "AGENTS.md", "index.md"]`. Under the anchoring rule those are already any-depth patterns, which is what is wanted here. Loud rather than silent, hence Medium.
- **Accept when:** `{"rule":"GRP-002"}` on a repository with a root `README.md` does not flag it. Consider naming the `entryPoints` option in the message, which states the fix but not the option that performs it.

#### W-06 · Medium · code, docs · `TBL-003.caseSensitive` has no schema default

- **Sources:** report F12 (MEDIUM) and report F27 (LOW) — one unrecorded default with three consumers.
- **Where:** the primitive falls back to `true` at `packages/core/src/engine/primitives/table.ts:98`; the Zod schema carries no `.default()`, so nothing records it and `packages/cli/schema.json:1123` emits a bare boolean.
- **Three consumers, two wrong:** `docs/guide/config-reference.md:80` documents `// default false` (inverted); `packages/core/src/compile/describe-rules.ts:118` annotates only an explicit `true`, so the committed `SKILL.md` renders a case-sensitive custom rule identically to a case-insensitive one; `docs/guide/rules/custom.md:47` lists the option with no default at all. `docs/guide/rules/TBL-003.md` is right twice.
- **Fix:** put the default in the Zod schema so the generated schema, the skill renderer, and all guide pages read one source.
- **Accept when:** `schema.json` records the default, the config reference matches it, and a compiled skill distinguishes a default-cased custom rule from an explicit `false`. Report F27's reproduction shows built-in `TBL-003` entries render only their registry description, so this is custom-rule-only on the skill side.

#### W-07 · Medium · decision, code · `GRP-001` calls a two-node back-link a cycle, at `error`

- **Sources:** field F-17 (polish, raised here because it drives users to disable the rule).
- **Observed:** 8 cycles, all genuine mutual references, all accurately reported with the full cycle path. Four are one deliberate, recognizable pattern: a README indexing its siblings while a sibling links back.
- **The problem is severity, not accuracy:** at `error` a normal documentation shape fails the build, and the likely response is to disable `GRP-001` — which forfeits the genuine 3- and 4-node cycles it also found.
- **Fix — decide:** a minimum-cycle-length option, a default severity of `warning`, or keep the behavior and record it in [`accepted-behaviors.md`](accepted-behaviors.md) with a guide home.
- **Accept when:** a two-document mutual link and a four-hop chain are distinguishable by configuration, or the choice is stated in the register.

### B3 — Reference and extension resolution

#### W-08 · High · code, test · `REF-001.exclude` goes inert whenever any `siteRouter` is set

- **Sources:** report F4 (MED-HIGH; reproduced in the report and again, verbatim, in report-verification).
- **Where:** `packages/core/src/engine/primitives/reference.ts:70` splits resolution into two branches and applies `options.exclude` on only one (`:88`). The image sibling has no split and always applies it.
- **The trigger is cheap:** every `siteRouter` field is optional and the object is strict, so a bare `{}` validates, and with no preset the router returns the stripped path — behaviorally identical to the no-router branch **except** that `exclude` stops applying. Reproduced: same fixture, `exclude: ["generated/**"]` and no router exits `0`; adding `"settings": {"siteRouter": {}}` and nothing else reports the link and exits `1`.
- **Second caller:** the declarative-custom-rule dispatcher passes a user's `assert.exclude` straight into `linkResolves` (`packages/core/src/engine/primitives/assert.ts:233`), so a `custom` rule inherits the hole — the family where the option is most likely hand-written. `docs/guide/config-reference.md` pairs a whole-config `starlight` router with a per-rule `exclude`, so a reader gets the inert combination by following the guide.
- **Fix:** apply `options.exclude` on the router branch before the candidate loop, as the non-router branch does.
- **Accept when:** the reproduction above exits `0` in both configurations, and a test covers the router-plus-exclude combination for both `REF-001` and a `custom` `linkResolves` rule.

#### W-09 · Medium · code · Three incompatible definitions of "a Markdown file"

- **Sources:** report F8 (MEDIUM, reproduced).
- **Where:** coverage uses `.md` + `.markdown` (`packages/core/src/graph/coverage.ts:32`); `init`'s scanner uses `.md` + `.mdx` (`packages/core/src/discovery/repo-scan.ts:55`); the default `include` is the `.md` glob alone (`packages/core/src/engine/lint-files.ts:75`). `.markdown` appears nowhere else in core and on no guide page.
- **Effect:** the coverage signal — whose entire job is naming on-disk Markdown that is linked-to but outside the corpus — checks for an extension no default configuration can admit, and is blind to the one `init` is built to find. Reproduced: `filesOutsideCorpus` listed `docs/legacy.markdown` and never mentioned `docs/page.mdx`.
- **Fix:** share one extension constant between the three sites, as `packages/core/src/discovery/gitignore-layers.ts:6` already does for the sibling problem.
- **Accept when:** one constant governs all three, and the fixture above reports the `.mdx` file.

#### W-10 · Low · code, docs · Two disagreeing image-target resolvers

- **Sources:** report F15 (graded MEDIUM there; **downgraded to Low** per report-verification, which confirms the structure and notes the behavioral effect was never measured).
- **Where:** router-aware in `packages/core/src/graph/build-context-graph.ts:20` and `packages/core/src/graph/coverage.ts:86`; router-blind in `packages/core/src/engine/primitives/reference.ts:129` and in `init`'s REF-003 tally at `packages/core/src/discovery/rule-inference.ts:114`, whose comment claims it mirrors the rule.
- **Fix — either direction is acceptable:** route images through the shared candidate helper, or narrow the graph builder's invariant comment to say images are deliberately excluded. Practical impact is low because a router-routed candidate ends in a Markdown extension and an image rarely does.
- **Accept when:** one resolution model is claimed and implemented, or the exclusion is stated where the invariant is.

### B4 — gitignore semantics

#### W-11 · Medium · code, test · Layer precedence is root-first-wins

- **Sources:** report F9 (MEDIUM; reproduced against real `git` in both the report and report-verification).
- **Where:** `packages/core/src/discovery/gitignore-layers.ts:42` iterates from the root down and returns `true` at the first layer that ignores. Git's rule is that the deeper `.gitignore` wins, so a nested `!keep.md` cannot re-include a file a root pattern ignored. One shared matcher with two call sites — the corpus walk and `init`'s scan — so both are consistently wrong.
- **Effect:** under-reporting. The linter drops a file real `git` keeps, silently. Reproduced: with root `*.md` and `docs/.gitignore` holding `!keep.md`, `git check-ignore` says not-ignored while the linter's corpus was empty.
- **Fix:** evaluate layers deepest-first and stop at the first layer with an opinion. This needs the `ignore` package's three-state `test()` rather than boolean `ignores()`, so it is not a one-line change.
- **Accept when:** a fixture with a nested Markdown re-inclusion agrees with `git check-ignore` in both directions. Note the field test's clean bill on `respectGitignore` is not counter-evidence — its target's five nested negations were all `.vscode/*.json` and `/build/.npmkeep`, so the case was never presented.
- **Documentation:** `docs/guide/configuration.md:48` currently sells `respectGitignore` with no caveat; either the fix removes the need for one or the caveat lands there.

### B5 — Config diagnostics

#### W-12 · High · code, test · The first error a new user meets says only `Invalid input`

- **Sources:** report F13 (MEDIUM), field F-09 (minor), field F-10 (minor). **Scope is wider than report F13 states** — see Corrections.
- **Three defects in one validator:**
  1. **Union collapse on every family.** A Zod union failure renders through `formatRootIssue` (`packages/core/src/config/load-config.ts:58`) and collapses to `- config.rules.0: Invalid input`, naming neither the key nor the allowed values. Verified against the built CLI: `{"rule":"REF-001","severity":"warn"}` and `{"rule":"REF-001","bogusKey":1}` both produce it, because `severity` is a strict `error | warning | off` enum on **both** branches and `ruleEntrySchema` is `.strict()`. `warn` for `warning` is the single likeliest severity typo. The custom-rule `assert` path report F13 documents is one member of this class, not its bound — and passing `options.assert` as an array produced the same bare message.
  2. **Stage 2 drops the filename.** Stage 1 throws `Invalid config at wastech-mdlint.config.json:`; `resolveConfiguredRules` throws `Invalid config:` with no `displayPath`. Worst in the case that needs it most: an ancestor directory's config can govern the run, so "which file?" is a real question.
  3. **Two path notations from one validator:** `config.rules.0` versus `rules[1].options`.
- **Fix:** render union-branch failures through the C7 formatter — discriminate the union on `rule: "custom"` **and** surface the per-branch issue detail from `issue.errors`, which currently is discarded — give stage 2 the `displayPath`, and settle on one notation.
- **Accept when:** all four shapes below name the offending key and, for an enum, the allowed values; every message names the file; one notation throughout.

  | Config | Required message content |
  | --- | --- |
  | `{"rule":"REF-001","severity":"warn"}` | the path to `severity`, and `error \| warning \| off` |
  | `{"rule":"REF-001","bogusKey":1}` | the unrecognized key |
  | `{"rule":"SIZE-001","options":{"maxBytes":10}}` | already correct — do not regress |
  | a typo'd key inside a custom rule's `assert` | the key and its location |

- **Also:** the two stages fail fast independently, so a config with both a shape error and an options error reports only the first, and a user fixing config by trial hits one error per run. Decide whether to aggregate.
- **Requirement impact:** report.md grades C7 "partially unmet — the standard path is covered; the custom-rule path bypasses the renderer", and both halves of that are wrong: it was covered for `options` and uncovered for `severity` and unknown keys, on every rule family rather than only on `custom`. **Post-fix ([P13.06](P13-correctness/06-config-diagnostics.md)) the verdict is met**: every diagnostic names the config file, one notation (`config.rules[0].options.assert.kind`) spans both validation stages, and union/enum failures name the offending key and the allowed values. The corrected verdict is carried in [requirements/01-configuration.md](requirements/01-configuration.md) at C7; `report.md` stays frozen as a historical record ([P10.01](P10-consistency/01-governance-docs.md)). The residual — no aggregation across the two stages — is in the [accepted behaviors register](accepted-behaviors.md).

### B6 — CLI boundary: exit codes, disclosure, paths

#### W-13 · High · code, test · `init --on-existing merge` refuses and exits `0`

- **Sources:** field F-08 (major).
- **Observed:** with an unloadable existing config, `init` prints a correct, well-worded refusal — `Not written: the existing config … could not be read, parsed, or validated, so a merge cannot guarantee a valid config …` — and exits `0`. `lint` given the identical file exits `2`.
- **Fix:** map the refusal path to the operational-error exit `2`. The refusal text is right; only the code is wrong.
- **Why it matters:** `--yes` exists for CI, where a merge step that silently no-ops reports success.
- **Accept when:** the refusal exits `2`, spawned as a process; tag the guard `@boundary-guard installed-bin-spawn`. Only a real process has an exit code, so an in-process test cannot see this.

#### W-14 · High · code · `init` never discloses what its hidden-directory exclude drops

- **Sources:** field F-11 (b) — the worse half of that finding.
- **Observed:** `init --yes` prints 5 include patterns and 11 exclude globs, then leaves the corpus at 139 files where `git ls-files` tracks 202. The 63-file gap is entirely `"**/.*/**"`: `.claude/` (28), `.agents/` (23), `backend/.rules/` (6), `mobile/.rules/` (6). Nothing says so. A user reads the include list, sees the visible directories, and has no reason to suspect `.claude/` was considered and dropped.
- **The information is demonstrably available at write time:** `graph`'s own `coverage.filesOutsideCorpus` already lists 12 of these files as linked-but-outside-the-corpus.
- **Fix:** report the count and the reason in `init`'s summary — "63 Markdown files were excluded because they live in hidden directories" — which makes the default self-correcting even if W-15 keeps it.
- **Accept when:** `init --yes` on a repository with Markdown in a dot-directory names the excluded count in its summary.

#### W-15 · Medium · decision, code · Is the hidden-directory exclude the right lint-time default?

- **Sources:** field F-11 (a).
- **The confusion to resolve:** the rationale in `discovery/repo-scan-constants.ts` is sound for the **scan** — `.github`, `.venv`, `.husky` hold tooling Markdown that would pollute cluster inference, and hidden directories are pruned by shape because a name list can never enumerate them (audit L-7). But that pruning decision is then written out as a permanent **lint-time** exclude, and those are different questions.
- **Why it matters for this product specifically:** in the field-test target the dot-directories hold `.claude/skills/`, `.agents/rules/`, and two `.rules/` sets — 31% of the tracked corpus, and precisely the LLM-facing documentation this tool exists to lint. This repository has the same shape.
- **Fix — decide:** separate the scan prune from the written exclude, or keep the exclude and record it in [`accepted-behaviors.md`](accepted-behaviors.md) with W-14's disclosure requirement as its condition.
- **Where:** `HIDDEN_DIR_EXCLUDE_GLOB` in `packages/core/src/discovery/config-writer.ts`.

#### W-16 · Medium · code, test · `--config` resolves against two different bases

- **Sources:** report F10 (MEDIUM).
- **Where:** `loadConfiguration` resolves an explicit config path against the process working directory, ignoring its own `cwd` parameter (`packages/core/src/config/load-config.ts:182`). Four CLI handlers inherit it — `lint`, `graph`, `slice`, `impact` — while `compile` and the MCP context helper work around it locally, with the hazard written down at `packages/cli/src/commands.ts:422`.
- **User-visible:** from a directory containing `proj/cfg.json`, `lint proj --config cfg.json` prints `Config file not found: ../cfg.json` — a path the user never typed, rendered relative to the lint root while resolved against the shell. `compile --cwd proj --config cfg.json` finds the same file.
- **Fix:** honor the caller's `cwd` for all six call sites, **or** add the register row and state the base at `docs/guide/cli.md:43`. The deferral currently lives only in a task file (`P11-remediation/10-cli-exit-contract.md:47`), which violates the same-change register rule.
- **Accept when:** all six handlers agree, or the divergence is in the register and in the guide.

#### W-17 · Low · code · An out-of-repo `--outdir` renders as `../../../../..`

- **Sources:** field F-23 (polish).
- **Where:** `packages/cli/src/commands.ts` — the repo-relative-POSIX normalization mandated for public output is right inside the repository and actively worse outside it.
- **Fix:** fall back to the absolute path once the relative form needs a leading `..`.
- **Accept when:** `compile --outdir <path outside the repo>` prints something a user can read.

### B7 — MCP boundary: validation and error contract

#### W-18 · High · code, test · A nonexistent `cwd` silently succeeds on all five file-based tools

- **Sources:** report F3 (MED-HIGH, reproduced over real stdio across all five tools).
- **Where:** five tools accept `cwd` as a raw optional string and hand it to core unvalidated. The terminating behavior in core is a silent empty map on a root that does not stat as a directory (`packages/core/src/markdown/load-documents.ts:134`), pinned as intentional — which is precisely why the guard belongs at each host boundary. The CLI has that guard and names the defect class in its rationale: "indistinguishable from a clean repository (M-7)" (`packages/cli/src/program.ts:103`), exit `2`. Inside the same MCP helper a bad `configPath` **is** caught; only the root is unchecked.
- **How each tool fails:** `lint-files` returns `No problems found.`; `context-graph` an empty success; `context-slice` `No match for query "x"`, indistinguishable from a real miss; `impact-analysis` `File not found in the context graph`, which misattributes the cause; `compile-context` a missing-compile-config error.
- **Fix — four sites, not one:** `cwd ?? process.cwd()` is recomputed outside the shared resolver, so a stat-and-reject surfacing `INVALID_INPUT` must land at `packages/mcp-server/src/shared/tool-context.ts:27` and `:52`, `packages/mcp-server/src/tools/lint-files.ts:61`, and `packages/mcp-server/src/tools/compile-context.ts:38`. Guarding only the resolver leaves `lint-files` and `compile-context` still returning silent success. The cleaner alternative is to make the resolver the single entry point first by returning the resolved `cwd`; both tool modules already document the duplication in place.
- **Accept when:** all five tools reject a nonexistent `cwd` with `INVALID_INPUT` over real stdio.

#### W-19 · Medium · code, test · The MCP text block drops the `hint`

- **Sources:** field F-24 (minor).
- **Observed:** on an unknown rule id, `structuredContent` carries the full contract (`code: "INVALID_INPUT"`, message, `hint: 'Did you mean "REF-001"?'`) but `content[].text` is only `Unknown rule "REF-01".` The CLI prints the suggestion. The text block is what a host renders and what a model reads, and the dropped sentence is the actionable half.
- **It is an asymmetry, not a global rule** — verified by asserting `text.includes(structuredContent.hint)`: `compile-context`/`COMPILE_CONFIG_MISSING` yes, `impact-analysis`/`TARGET_NOT_FOUND` yes, `lint`/`INVALID_INPUT` no.
- **Fix:** concatenate the hint into the text in `packages/mcp-server/src/tools/lint.ts` or the shared error wrapper.
- **Accept when:** a test asserts `text.includes(hint)` for every error path that carries one. The `hint` is legitimately conditional — an unknown rule with no near-miss returns `{code, message}` only — so assert conditionally.

#### W-20 · Medium · decision, code · Schema-level rejections bypass the error contract

- **Sources:** field F-26 (minor, confirmed with a verdict).
- **Observed:** any argument the tool's own `inputSchema` rejects returns `isError: true`, **no `structuredContent` at all**, and raw transport text: `MCP error -32602: Input validation error: … Too small: expected number to be >=0 at depth`. No `code`, no `hint`, and the `-32602` prefix leaks transport detail into user-facing text.
- **Verdict from the run:** acceptable to a human, useless to a program. The message names the offending field and the constraint, so a model can fix the call; a host that branches on `code` sees nothing.
- **The mechanism is already written down in the tree** at `packages/core/src/config/config-schema.ts:77-79`, three lines above the `ruleEntrySchema` declaration: the SDK validates tool input before the handler runs, so a rejected entry "would come back as raw InvalidParams text with no structuredContent instead of the M6 `{ code, message, hint }` payload".
- **Fix — decide:** pre-validate inside the handler so the contract owns every path, **or** document that schema rejections are contract-exempt (register row plus a line in the guide).
- **Accept when:** either every failure path carries `{code, message}`, or the exemption is stated where the contract is documented.

#### W-21 · Medium · decision, code, docs · No operational error code

- **Sources:** report F19 (MED-LOW).
- **Observed against one fixture (a directory chmod'd `000`):** CLI prints `Operational error: EACCES on docs/locked` and exits `2` — errno plus a normalized path. MCP `lint-files` returns `INTERNAL_ERROR` and "An unexpected internal error occurred." — no path, no errno, which is the whole actionable content.
- **The part that is conformant:** `INTERNAL_ERROR` is what the taxonomy specifies for an unexpected throwable. What no document records is that the closed set has **no operational-error code at all**, so nothing will flag the asymmetry. `docs/guide/output.md:35` describes operational failures in CLI terms only.
- **Fix — decision-level, not local:** add an operational code to `TOOL_ERROR_CODES` and amend the decision entry at `docs/mdlint_v2/decisions/pre-implementation-decisions.md:57` in the same change, as that log's own honesty rule requires; **or** keep the closed set and register the asymmetry. Widening `isStructuredError` to duck-type errno errors is explicitly the wrong fix and `packages/core/src/errors.ts:32` says why.
- **Caller-visible either way:** a host matching on `INTERNAL_ERROR` breaks. Say so in the change.

### B8 — Output shapes and cross-host parity

#### W-22 · Medium · code, docs · Graph JSON `coverage`

- **Sources:** report F11 (MEDIUM) and field F-25 (minor) — reproduced identically and independently on both hosts.
- **Three problems in one output:**
  1. `coverage` is a shipped fifth key documented on **none** of five surfaces that all say four: `README.md:73`, `docs/guide/cli.md:67`, `docs/guide/context-graph.md:39`, `glossary.md:204`, and the authoritative `P4-graph/07-cli-graph-slice-impact.md:17`.
  2. It is unreachable from MCP in either format, though the CLI states in place that JSON consumers "must see `filesOutsideCorpus` too" (`packages/cli/src/commands.ts:228`). The field test calls `coverage.filesOutsideCorpus` the single best diagnostic in the report — and it is exactly W-14's evidence.
  3. `format: "json"` denotes different documents on the two hosts: CLI gives `nodes, edges, components, readingOrder, coverage`; MCP gives `nodes, edges, cycles`, while MCP `summary` gives the CLI's json shape minus coverage.
- **Fix:** pass coverage in `packages/mcp-server/src/tools/context-graph.ts` and add it to that tool's output schema; rename MCP's raw shape (`raw`?) or make MCP `json` mean what CLI `json` means; document the fifth key on all five surfaces. The source comment at `context-graph.ts:50-54` explains honestly why the split exists (`registerTool` takes a single `outputSchema`) — what is not defensible is reusing the word.
- **Accept when:** `coverage` is documented and reachable from both hosts, and one format name denotes one shape.

#### W-23 · Medium · code · `excluded from reading order` exists only in the human format

- **Sources:** field F-20 (minor).
- **Observed:** the human report prints `excluded from reading order (73): …`; the JSON has no `excluded` field, so a machine consumer must derive it as `nodes` minus `readingOrder`. 73 of 139 nodes — including all of the substantive documentation directories — is a large enough share that a reader will ask why, and neither format answers.
- **Fix:** expose the same set in JSON, and ideally state **why** a node is excluded. Note `impact-analysis` on MCP already exposes `excluded`, so the field name and shape exist.
- **Accept when:** both formats carry the set, with parity asserted by a test.

#### W-24 · Medium · code, docs · Two JSON shapes for one lint capability

- **Sources:** report F17 (MED-LOW).
- **Where:** `packages/core/src/engine/format-lint-result.ts:5` claims "the JSON shape is the structured contract MCP reuses (P7)". It is not: core wraps `{summary, messages, files}`, MCP `lint-files` returns the raw `LintResult` with `errorCount`/`warningCount`, and the ad-hoc MCP `lint` tool assembles a third, narrower shape. So one finding count is `summary.errors` on one host and `errorCount` on the other. Both shapes are recorded, unremarked, in the field test's Phase 3 and Phase 8.
- **Second site, same contract:** `docs/guide/output.md:17` describes `summary` as counts "and pass/fail". There is no pass/fail field — the keys are `files`, `errors`, `warnings`, and the `files` count is itself undocumented.
- **Fix:** the divergence is defensible (MCP consumers want the typed record); asserting the shapes are identical is not. Amend the core comment to describe both, and correct `output.md:17`. `README.md:220` already states the CLI contract correctly. The sibling difference in `impact` is documented honestly in a table in the shipped skill — match that.
- **Accept when:** each host's shape is documented where a consumer looks, and no source comment claims they are one.

#### W-25 · Low · code, docs · `--format` vocabulary differs across CLI commands

- **Sources:** field F-12 (polish), and W-22 supersedes it in scope.
- **Observed:** `graph` accepts `human | json | mermaid | dot` and rejects `text`; `lint`/`slice`/`impact` accept `text | json` and reject `human`. Both rejections exit `2` and name the valid choices, and `README.md:62-65` documents the split faithfully — so this is loud, not silent.
- **Fix:** accept both words on both, or rename one, in `packages/cli/src/program.ts`.
- **Accept when:** one word means "plain text for a human" across the CLI, or the split is deliberate and stated as such.

### B9 — Rendering at real scale

Three defects that no fixture in the repository can produce. The audit's compile output was 1415 bytes; the field test's was 110789.

#### W-26 · High · code · `graph --format human` emits multi-KB single lines

- **Sources:** field F-19 (minor, raised here because it makes the format's own promise false).
- **Observed on a 139-node graph:** 77 lines / 19790 bytes, of which four are comma-joined blobs — one `clusters` entry at 3904 chars, `reading order (66)` at 3668, `excluded from reading order (73)` at 3561, `entry points (61)` at 3497. `top hubs`, `cycles`, and `coverage` are correctly one item per indented line, so the format is internally inconsistent: three sections line-oriented, three single-line blobs.
- **Fix:** render those three like `top hubs` already is, in `packages/core/src/graph/graph-render.ts`.
- **Accept when:** no line in the human report exceeds a sane width at 139 nodes. `json`, `mermaid`, and `dot` are all fine and must stay byte-stable.
- **Reaches MCP too:** the `context-graph` text block is the human report regardless of `format`, so a host renders the same unreadable line.

#### W-27 · High · code · The generated `SKILL.md` is a graph dump

- **Sources:** field F-21 (major).
- **Observed on 139 docs:** 110789 bytes / 831 lines / ~27697 tokens by the tool's own estimate, apportioned `Document Dependencies` 89.7%, `Document Architecture` 9.3%, `Workflow` 0.4%, `Document Rules` 0.3%, `Context Budget` 0.1%. Inside the dependency section sits a **single line of 17530 characters** — the `- to:` fan-out for one hub with 290 references, comma-joined.
- **Why it matters:** the two sections that would tell an agent how to operate are 0.7% of the artifact, while the edge list an agent cannot act on is nine tenths — and a skill file is loaded into context whole. The skill is ~8.7% of the corpus it describes.
- **Fix:** cap or summarize the fan-out in `packages/core/src/compile/synthesize.ts` and give the budget back to rules and workflow. `hubMinInDegree` exists but governs role assignment, not this.
- **Accept when:** a 139-document corpus produces a skill whose dependency section is bounded, no line exceeds a stated cap, and determinism plus the content hash are preserved.

#### W-28 · Medium · decision, code · The node-role vocabulary collapses

- **Sources:** field F-22 (minor).
- **Observed:** of 139 nodes — `hub` 66, `isolated` 50, `entry` 11, `bridge` 8, `leaf` 4. Two of five roles hold 83%, and in practice read as "has edges" / "has no edges", so the `Role` column of `Document Architecture` teaches a reader almost nothing.
- **Fix — decide:** raise the `hubMinInDegree` default or subdivide the role vocabulary, in `packages/core/src/compile/synthesize.ts`.
- **Accept when:** no single role holds a near-majority of a realistic corpus, or the coarseness is stated where the column is documented.

### B10 — Packaging and release readiness

#### W-29 · High · packaging · No package ships a README or LICENSE, and none declares `repository`

- **Sources:** field F-04 (major).
- **Observed:** every tarball contains only `package.json` + `dist/` (`cli` additionally `schema.json`). No `README*` or `LICENSE*` exists anywhere under `packages/` — both live at the repository root only, so npm's automatic inclusion has nothing local to pick up. All three declare `"license": "MIT"` with no license text in the payload, and all three omit `repository`, which the root manifest does set.
- **Why it stayed invisible:** nothing asserts on tarball contents, and `npm pack --dry-run --workspaces` prints the payload without judging it. It becomes visible only after publishing — three blank npm pages with no source link.
- **Fix:** per-package `README.md`, a copied or symlinked `LICENSE`, and `repository` with `directory` in each manifest.
- **Accept when:** a test or release check asserts each tarball carries a README and a license, and each manifest declares `repository`.

#### W-30 · Medium · tooling, docs · `release:check` validates nothing

- **Sources:** report F21 (MED-LOW; numbers refreshed per report-verification).
- **Where:** `package.json:38` defines it with no workspace flag, run from a root that is `"private": true` with no `files` field — so it exercises none of the three allowlists. CI does it correctly (`.github/workflows/ci.yml:63`). `glossary.md:275` is the only document describing the script and states the inverse: that it "validates each package's published `files` set".
- **Measured:** `npm pack --dry-run` at the root packs **445 files** today (442 at `d96b64c` — tree drift, not a regression), including `.github/workflows/ci.yml` and `docs/guide/cli.md`; `-w @wastech-mdlint/cli` packs **26**.
- **Fix:** add `--workspaces` to the script, or correct the glossary entry. A maintainer trusting the glossary believes a gate exists that does not.
- **Accept when:** the local command and the CI step check the same thing, and the glossary describes what the script does.

#### W-31 · Medium · packaging · 204 dangling source maps

- **Sources:** field F-05 (minor) and report F23 (LOW) — independently found, same mechanism, matching counts.
- **Observed:** `tsconfig.base.json:9-10` enable both map kinds; each package ships `dist` only. Core packs 337 entries including 168 maps, cli 26 including 12, mcp-server 49 including 24 — 204 maps, **zero** `src/` entries anywhere. `dist/index.js.map` has `"sources":["../src/index.ts"]` and no `sourcesContent`, so every map is unresolvable at the consumer, and they are roughly half core's 205.8 KB packed size.
- **Fix — pick one, all one line:** add `src` to each package's `files`, set `inlineSources`, or turn off `declarationMap` and `sourceMap` for published output. Today's payload carries the cost of maps with none of the benefit.
- **Accept when:** every shipped map resolves, or no maps ship. This is a release-shape decision that belongs with the `P-release` pack criterion.

#### W-32 · Low · decision, packaging · The `engines` pin is advisory

- **Sources:** field F-01 (minor).
- **Observed:** `npm ci` prints `EBADENGINE` for the root and all three packages and exits `0`; no `.npmrc` sets `engine-strict`; nothing reads `process.version` at runtime. The whole field test then ran on `v24.8.0` against a `>=24.17.0` floor — so the floor is untested in practice.
- **Fix — decide:** `engine-strict=true` in a root `.npmrc`, a startup guard in `packages/cli/src/index.ts`, or lower the pin to what is actually tested.
- **Related:** report F28 (W-54) passes `--engine-strict=false` in the WSL wrapper, on the one platform combination those scripts exist to cover. Resolve both together.

#### W-33 · Note · docs · Dev-chain advisories

- **Sources:** field F-03 (polish).
- **Fact:** the workspace reports `9 vulnerabilities (1 low, 3 moderate, 5 high)`; installing the three published tarballs into a bare sandbox reports `found 0 vulnerabilities` across 196 packages. The advisories are entirely in the dev chain.
- **Action:** record the evidence as a note at the release-verification step. No dependency bump is warranted on this evidence.

### B11 — User-facing documentation accuracy

#### W-34 · Medium · docs, code · The token heuristic is undisclosed where the number is reported

- **Sources:** report F31 (LOW) and field F-15 (major) — same mechanism, two different gaps.
- **The code:** `Math.ceil(text.length / 4)` (`packages/core/src/engine/tokens.ts:5`) — UTF-16 code units, no language term.
- **Gap 1, the report's half:** `docs/guide/concepts.md:38` states the heuristic as `ceil(bytes / 4)`. One wrong site of seven; the other six are right and one warns explicitly that the units diverge for multi-byte content. For CJK, UTF-8 bytes run about 3× characters, so a budget set from that page is off by that factor. One-word fix.
- **Gap 2, the field test's half:** nothing states the calibration where a user meets the number. `grep -niE 'token' README.md` returns three lines, none of which says how tokens are estimated, and the finding message — `File exceeds tokens warn budget: 14179 tokens` — carries no calibration either. Measured on real data: bytes-per-token ranged 4.03 to 6.83, and the largest document is 70.3% Cyrillic, so the estimate errs **low** — the wrong direction for a budget whose job is preventing context overflow.
- **Fix:** correct `concepts.md:38`; state the calibration in `README.md` and in the finding's message. Do **not** change the arithmetic in this item — `AGENTS.md` mandates keeping the heuristic isolated precisely so it can be swapped, and fixing the honesty does not require fixing the math. Weighting by byte length, which the rule already computes one line above for the `bytes` metric, is a separate decision.
- **Accept when:** every statement of the heuristic in the tree agrees with the code, and a reader of a `tokens` finding can learn the calibration without reading source.

#### W-35 · Medium · docs, decision · JSON message keys, and `helpUri`

- **Sources:** report F18 (MED-LOW).
- **Observed:** `lint --format json` emits `["ruleId","severity","message","filePath","line","column","data","helpUri"]`; `docs/guide/output.md:18` names five. The omitted `data` is exactly why requirement R3 was accepted — "Enable SARIF + machine action". Separately, `helpUri` holds a bare rule ID at 27 report sites and never a URI, and the word appears nowhere in `docs/guide/` despite crossing the MCP wire schema.
- **Fix:** extend `output.md:18` to the emitted set; and either populate `helpUri` with a real documentation URL — the per-rule guide pages already exist — or rename the field. R3's SARIF rationale cannot be met by a field whose value is not a link.
- **Accept when:** the documented set matches the emitted set, and `helpUri` either resolves or is named for what it holds.

#### W-36 · Low · code, docs · R6's `docsUrl` and `messages` are vacuous

- **Sources:** report F22 (MED-LOW).
- **Observed:** `docsUrl` exists at exactly three lines in all of `packages/*/src` (declared, copied, re-declared) and `messages` at exactly one. No built-in sets either; no generator reads either. R6 is therefore true for six fields and vacuous for two.
- **Fix:** populate `docsUrl` from the per-rule guide pages and read it in the docs generator — which pairs naturally with W-35's `helpUri` decision — or drop both fields and amend R6.

#### W-37 · Low · code · The generated schema hardcodes the custom `target` vocabulary twice

- **Sources:** report F30 (LOW).
- **Observed:** `packages/core/src/engine/schema.ts:88` and `:104` spell the enum as literals while the typed authority is `ASSERTION_TARGETS`. Correct today; a new assert kind needs two hand edits in a function whose own framing is metadata-driven. The config loader is looser than the schema (`config-schema.ts:98` accepts any string), so drift would present as "the editor rejects a config the linter accepts".
- **Fix:** derive both from `ASSERTION_TARGETS`.

#### W-38 · Low · code · A stale rationale comment

- **Sources:** report F26 (LOW).
- **Observed:** `packages/core/src/graph/coverage.ts:73-74` still says the coverage signal is "Core-only for P4.06" with "no CLI/lint-output consumer yet". `packages/cli/src/commands.ts:232` calls it. Per report-verification, the comment continues "(P4.07 surfaces this in the `graph` command)", so it points at the consumer that arrived — the fix is still to delete the stale half.

#### W-39 · Low · decision · `init` infers 8 of 24 built-in rules

- **Sources:** field F-18 (polish).
- **Observed:** the inference vocabulary is `CTX-001 CTX-002 GRP-001 REF-001 REF-002 REF-003 SEC-001 TBL-002`. The other 16 — including `SIZE-001` and `LLM-001`, the two LLM-context rules the README leads with — are never proposed, so a user reaches them only by hand-writing config.
- **Concretely reachable:** the scan already samples file sizes, so a derived `SIZE-001` budget is inferrable; `CLAUDE.md`/`AGENTS.md` with `@` imports are detectable, so `LLM-001` is too.
- **Fix — decide:** widen `packages/core/src/discovery/rule-inference.ts`, or record the scope choice. Combined with W-04, nothing guides a user to a working size budget from either direction.

#### W-40 · Low · decision · Four uncalled barrel exports

- **Sources:** report F24 (LOW), minus the half report F39 settles.
- **Observed:** `slice`, the single-document `extractDocProfile`, the `fileMatches` hook on assertion options, and the retained `files` option on the column-unique primitive have no host caller, against a barrel whose own comment frames hosts as the audience and a rule against extension points built ahead of need.
- **Genuinely a judgment call:** `core` is a published package, so "no internal caller" is not automatically a defect, and no document names an expected consumer for these four. `getImpactSet` is **not** in this item — a tier-3 decision names it as consumed, which is W-47.
- **Fix — decide:** keep as library surface and say so, or remove.

### B12 — Plan of record

#### W-41 · High · docs · The enforced architecture decision contradicts the code twice

- **Sources:** report F32 (MEDIUM). **Do this first in B12** — report-verification's one ranking change, on the grounds that this is the finding that will actively make the next contributor write wrong code.
- **Two clauses of a tier-3 "Accepted (enforced)" decision no longer describe the code:**
  1. It names three core APIs that do not exist — `loadConfig` and two formatter functions — with **zero** occurrences across all three packages. The real exports are `formatLintResultText`, `formatLintResultJson`, and `loadConfiguration`, which the glossary names correctly.
  2. It prohibits the pipeline that shipped: "`lintFiles` is intentionally **synchronous** (`globSync` + `readFileSync`) … Do not introduce an async variant". The shipped `lintFiles` returns a `Promise`, the corpus loader is built on `node:fs/promises`, `loadConfiguration` is async, and `globSync` appears nowhere in core. `glossary.md:68` restates the prohibition verbatim and links back to the decision as its authority.
- **What must not be swept with it:** rules themselves are synchronous — `check(context): void` — and two shipped behaviors depend on that (STR-001's corpus-only glob satisfaction, recorded as accepted for this reason; and the primitives' purity requirement). The false claim is about the pipeline entry point, not rule execution.
- **Fix:** correct the three API names; replace the synchronicity clause with the real constraint (rules and primitives sync, pipeline entry points async); update `glossary.md:68` in the same change. A tier-1 task file and a code comment already say the right thing.
- **Accept when:** the ADR, the glossary, and the code agree, and a reviewer citing the ADR would not block an async change.

#### W-42 · High · docs, decision · No reliable completion surface

- **Sources:** report F2 (HIGH; **count corrected** by report-verification to 30 files / 92 boxes, and its HIGH grade disputed there as sitting next to a real wrong-answer defect).
- **Two mirrored halves, counted over all 132 plan files (148 unchecked / 255 checked boxes):**
  - **92 exit criteria across 30 `Status **Done**` task files are unchecked** while their phase indexes are fully ticked. Two of those boxes are self-referential audits of exactly this.
  - **33 phase-index criteria are unchecked across five phases**, four of which read `Status **Not started**` while every task file beneath them reads Done: P9 (7 of 8 done), P10 (8 of 8), P11 (14 of 14), P12 (6 of 6), and `P-release` (0 of 5 — the one honest row). The glossary repeats the stale state at `:12` and `:248`.
- **Delivery-history evidence:** `git show 827bce8` shows the merge that landed P11 and P12 rewriting the Status line and all seven criteria lines of those indexes — reflowed for the prose-wrap setting — and preserving `Not started` and every empty box verbatim.
- **Demonstrated harm:** under the stated precedence a reader concludes P0–P3 is unverified and P9–P12 is not done, the exact inverse of the indexes. It has already produced a wrong belief about a release gate: the pack-clean criterion is ticked at `P0-foundations/index.md:43` and open at `P-release/index.md:39`, and `release:check` validates none of it (W-30).
- **Bound on the claim:** of 78 index criteria, only two are not met in code. This item is about the surface, not the work beneath it. That bound comes from the report's own completion table, which report-verification did **not** re-check — so treat it as the report's finding, not as independently confirmed, and re-derive it if a task turns on it.
- **One of the 92 boxes cannot honestly be ticked, and a sweep would tick it.** `P0-foundations/index.md:41` claims `[x]` that `scan` and `graph` "produce the same output as before the migration (parity check)"; the same criterion is `[ ]` at `P0-foundations/08-exit-verification.md:34`; and the reference implementation it compares against was removed at the P3.09 cutover (`P3-rules/index.md:48`), with no test standing in for it. The criterion is **permanently unverifiable**, so ticking the task-level box would assert a check nobody can perform, and the already-ticked index box is the false claim.
- **Fix:** flip the five indexes' Status lines and criteria and the two glossary roll-ups — **and decide whether per-task checkboxes are load-bearing at all.** If they are not, delete them rather than shipping 92 that read as open work. Ticking them without that decision recreates the problem next phase.
- **Fix, second half — dispose of the unverifiable criterion explicitly:** retire it at both sites (the migration it guarded is three phases behind and its subject no longer exists), or keep the text and give it a row in [`accepted-behaviors.md`](accepted-behaviors.md) recording that it is closed-by-obsolescence rather than verified. Do not leave it as a ticked box with nothing behind it — that is the exact failure this item exists to end.
- **Accept when:** no phase index reads `Not started` above task files that are all Done; no criterion is ticked at index level and open at task level for the same subject (the pack-clean pair at `P0-foundations/index.md:43` versus `P-release/index.md:39` is the second instance, and it belongs to W-30); the two glossary roll-ups agree; and the parity criterion above is retired or registered.

#### W-43 · Medium · docs · 17 dead links inside the plan

- **Sources:** report F6 (MEDIUM; **citation corrected** — the 11th link is at `audit-2026-07-25-post-p9.md:3`, not `:31`).
- **Observed:** 11 links across 9 files point at a report removed in `d96b64c`; **five of them are `Status **Done**` task-file header lines whose sole citation for the defect the task claims to fix is the missing file.** Four more point into gitignored `tasks/pending/`, and two are W-44's. Reproduced by the product's own REF-001 with an externally supplied config: exactly 17 problems.
- **Fix:** repoint the 11 citations at the two frozen audit reports that remain, and drop or re-target the four `tasks/pending/` links.
- **Depends on W-53** for prevention: REF-001 is precisely the rule that catches this and it never runs here.

#### W-44 · Medium · docs · `PLAN.md` and `docs/plan/` do not exist

- **Sources:** report F5 (MEDIUM).
- **Observed:** `AGENTS.md:39` states that historical v1 planning remains in both. `PLAN.md` was deleted in `957a1ca` as a side effect of a P8.01 skills commit; `docs/plan/` was never tracked at all. The roadmap links to both at `index.md:5` and `:11`. The governance file is the first thing a new contributor or agent reads.
- **Fix:** drop the sentence and the two links.

#### W-45 · Medium · docs · Seven stale "P9 means release" references

- **Sources:** report F7 (MEDIUM).
- **Observed:** after the `P9-release` → `P-release` rename, three phase indexes still assign release work to P9, and **three of the six locked requirements documents — precedence tier 2 — assign accepted requirements to it**, two of them naming work that shipped in P7.05 and P8.05. So a tier-2 document and a tier-1 index now contradict each other about what P9 is. P10.02 closed this class in the glossary alone and says so.
- **Fix:** run the same sweep across `docs/mdlint_v2/requirements/` and the phase indexes.

#### W-46 · Medium · code, CI, skills · Eleven stale phase-ID lines in shipped artifacts

- **Sources:** report F16 (MED-LOW; counts re-derived independently in report-verification, matching line for line).
- **Observed:** the same rename left 11 stale lines in 7 files, 10 of them in shipped artifacts — `packages/core/src/discovery/config-writer.ts:170-171` (shipped core runtime), `.github/workflows/ci.yml:44`, four lines in `.github/workflows/publish.yml` (`:43` is a user-visible log line), and `:5` of all three published `skills/*/SKILL.md` frontmatter — plus one test comment. A twelfth candidate at `packages/core/src/compile/skill-frontmatter.ts:4` names "P9's CI check" for what shipped as P8.05.
- **Why it matters:** three sites are published skill frontmatter promising users a release that no longer has that name. This survived `P10-consistency/03-stale-comments.md`, a phase whose explicit job was cleaning stale source comments, marked Done.
- **Fix:** replace `P9`/`P9.03` with `P-release`/`PR.03` at the eleven cited lines across those seven files, plus `README.md:34`, which still describes the shipped MCP surface in future tense by phase — same pass, eighth file.
- **Do not sweep by pattern.** Report F16 checked the rest of the tree and found the references to **`P9.04`, `P9.06`, and `P9.07` are all correct** — `P9` still names the post-audit remediation phase, and only the release sense of it is stale. `.github/workflows/ci.yml:16` (`M-6 / P9.06`, the format gate) is a live example a blind `s/P9/P-release/` would break. Edit the enumerated lines, then re-grep and classify each remaining hit by what it refers to.
- **Accept when:** every `P9` outside `docs/` either names the remediation phase correctly or is gone; `ci.yml:16` is untouched; and the twelfth candidate at `packages/core/src/compile/skill-frontmatter.ts:4` ("P9's CI check" for what shipped as P8.05) is either corrected or left deliberately, stated in the change.

#### W-47 · Medium · docs · Two cross-phase dependency decisions overstate what shipped

- **Sources:** report F39 (MED-LOW).
- **Observed:** entry **4.2** fixes the deterministic-fixable subset as `SEC-*` plus `TBL-002`. `SEC-*` is three rules; only `SEC-001` is fixable, with SEC-002 and SEC-003 explicitly `fixable: false` — and the code states the true count in place: "those two are the only `fixable: true` rules". Entry **4.3** asserts that `query`, `getImpactSet`, and `classifyImpact` are "reused directly by P7.03"; one of the three is. `getImpactSet` has no caller anywhere outside its own unit test.
- **Why it matters:** 4.2 is the entry a `--fix` change is measured against, so a contributor would expect SEC-002 to be fixable or would "restore" fixability the code deliberately withheld. 4.3 is what lifts `getImpactSet` out of W-40's judgment call and into a documented expectation the code does not meet — `query` is named there too and likewise has no host caller.
- **Fix:** narrow 4.2 to `SEC-001` + `TBL-002` and 4.3 to `classifyImpact`, per that log's own honesty rule — or record the two unconsumed exports as intended surface and close them with W-40.

#### W-48 · Medium · docs · The accepted-behaviors register fails its own contract

- **Sources:** report F20 (MED-LOW; all three sites re-verified in report-verification, including that `docs/guide/output.md` contains **zero** occurrences of "schema").
- **Three breaches of the register's own three rules:**
  1. Row `:24` names `docs/guide/output.md` as the home of the leftover-`schema.json` behavior; that page never mentions the subject. The behavior **is** stated for users, at `docs/guide/cli.md:127` — so the defect is the pointer.
  2. The id-ref-inside-a-code-fence inflation was accepted twice in task files and has no row, though it inflates `impact`, `slice`, and GRP-002.
  3. Dangling reference-style links invisible to REF-001 were accepted and given a README home, but never a row.
- **Consequence:** `P12-consistency/06-process-boundary-tests.md:72` claims each accepted behavior has a home "confirmed to exist and to state it". Site 1 falsifies that.
- **Fix:** repoint row `:24`, add the two missing rows. Every **decision** item in this backlog terminates here if it resolves to "accept".
- **While in this file, dispose of the one row the register flags against itself.** Row `:39` — the `init` draft a user confirms does not name the project-local `schema.json` the `npx` path writes, only the after-the-fact write summary does — is marked **deferred rather than accepted**, and its own reason column calls it "the one row here a future task should close rather than keep". It is a gap against the warn-before-confirming discipline, not a behavior anyone chose. Close it (name the schema in the draft, which is a small `init-command.ts` change and moves this item's Type to `docs, code`) or re-classify it as genuinely accepted with a stated reason. Leaving a self-flagged row untouched while fixing the register's other three failures is the one outcome to avoid.

#### W-49 · Low · docs · Live Prettier corruption in a phase task file

- **Sources:** report F34 (INFO).
- **Observed:** `docs/mdlint_v2/P7-mcp-server/02-lint-tools.md:35` has been destructively rewritten where a glob-bearing code span was nested inside a bold span — the following inline delimiters were eaten and the sentence is unreadable as authored. `proseWrap: "never"` is why the gate cannot see it. The class grep returns exactly one site.
- **Fix:** retype the line, avoiding the construct. Then add the construct to the standing rules so it stops recurring — it already is, above.

#### W-50 · Low · docs · An orchestrator task file invisible from its own index

- **Sources:** report F33 (LOW).
- **Observed:** `docs/mdlint_v2/P0-foundations/09-audit-remediation.md` is the only phase file with orchestrator frontmatter, no `Status` line, `## Acceptance criteria` instead of exit criteria, and no entry in its index — whose task table and sequence diagram both end at P0.08. Verified as a class in both directions: exactly one such file.
- **Why it is entangled with W-42:** a reader counting open checkboxes sees six unclosed P0 criteria, one of which asserts responsibility for verifying every other P0 criterion.
- **Fix:** either list it in the index with a Status line, or move it out of the phase directory.

#### W-51 · Low · docs · Two roadmap inaccuracies

- **Sources:** report F36 (INFO) and report F37 (INFO) — same file, same fix pass.
- **Observed:** `docs/mdlint_v2/index.md:17` and the target tree at `:83` list six CLI commands; a seventh, `schema`, ships and is mandated by its own task file, by requirement C9, and by the glossary. Under the stated precedence the roadmap summary is the defect, not the code. And `:87` diagrams `schema.json` at the repository root; it has only ever lived at `packages/cli/schema.json`, which the installed-path constant and the CLI's `files` allowlist both require.
- **Fix:** add `schema` to both lists; move `schema.json` in the tree diagram.

#### W-52 · Note · docs · The frozen audits are in Russian

- **Sources:** report F41 (INFO; **value disputed** in report-verification, which notes the repository owner is a Russian speaker and that no rule requires English).
- **The fact that makes it more than style:** those two files are the definition site for the finding IDs four phases are written in, and nothing else defines them. `AGENTS.md:47` derives P9–P12 from them by name; `.agents/rules/testing.md:29` rests the four boundary-guard categories on the second report's systemic-cause section; the two release blockers cited in `P11-remediation/index.md` are defined only there.
- **Action — cheapest sufficient option:** one line at each report's head stating the language, plus an English rendering of the two finding tables — the parts the plan actually cites. Or record the choice, since the audits are frozen by policy. Not a blocker for anything.

### B13 — Self-linting

#### W-53 · High · config, CI · The repository never runs the product on itself

- **Sources:** report F35 (LOW there; **raised to High here on leverage**, which the report's own recommendation section argues for).
- **Observed:** `wastech-mdlint.config.json` does not exist at the root, and no v2-shaped config exists anywhere outside four test fixtures. CI runs ESLint, Prettier, Vitest, `tsc -b`, and `npm pack --dry-run` — and nothing runs the product. Meanwhile requirement **I8** (tier 2) states that "the repo's own config is simply rewritten in the new shape" and `glossary.md:305` repeats it, both written as though the artifact exists. Nothing records a decision against one in either direction.
- **The demonstration:** W-43's seventeen dead links were all found by REF-001 in a single run, once a configuration was supplied from outside the repository — a run this repository cannot perform on itself. This is a Markdown analyzer whose own 132 plan files, 51 guide pages, and README are never analyzed.
- **Fix:** add a narrow docs-only configuration — `include` over `docs/**` and `README.md`, with the reference rules that pay for themselves immediately — and a CI step that runs it. Adding one **closes a plan expectation rather than reversing a decision.**
- **Accept when:** CI fails on a dead link inside `docs/`. That single change converts most of B12 from an audit finding into a build failure.
- **Sequencing:** land after W-43 clears the existing 17, or the first run is red on known debt. Note W-01/W-02/W-03 change what a config means, so pick the config shape after B1.

### B14 — Tooling

#### W-54 · Medium · tooling · The WSL npm wrapper interpolates argv into a `cmd.exe` line

- **Sources:** report F28 (LOW there; Medium here because it is the one item that breaches a security rule outright).
- **Observed:** `scripts/run-npm-windows.sh:17` flattens the argument vector into one string and `:19` interpolates both it and the repository path, unquoted, into a `cmd.exe` command line — so a checkout path containing a space or an ampersand breaks or injects. The same line passes `--engine-strict=false`, suppressing the Node constraint all three packages declare, on the one platform combination these scripts exist to cover.
- **Plan clause:** `.agents/rules/security.md:40` requires explicit argument vectors rather than shell interpolation. Scope is dev-only — no package's `files` ships it — and the two process spawns in product code were checked and are compliant.
- **Fix:** explicit argv; drop `--engine-strict=false` and resolve the engines question with W-32.

#### W-55 · Low · tooling · The docs generator uses generated text as a regex replacement string

- **Sources:** report F40 (LOW, latent).
- **Observed:** `scripts/generate-docs.mjs:38` and `:42` interpolate generated content into the **replacement** string of `String.prototype.replace`, where `$` is a metacharacter — so a `$&`, `` $` ``, `$'`, or `$n` in any rule or MCP tool description would expand instead of being written. The `$1`/`$2` in those templates are deliberate, which is exactly why the payload cannot be trusted to be inert. The damage would be a corrupted `README.md` with the END marker in the middle, then a docs-sync failure on bytes nobody wrote.
- **Latent, not live:** both generated strings were regenerated and contain zero `$`-sequences.
- **Fix:** pass a replacer function at both call sites, matching what `packages/core/src/discovery/repo-scan.ts:82` already does for the same reason. This is the replacement-string half of the class P11.06 closed inside the rules.

#### W-56 · Low · test, docs · The build-before-test remedy does not always clear the guard

- **Sources:** report F14 (LOW; reproduced independently in an isolated probe by report-verification).
- **Observed:** both `installed-bin-spawn` guards compare modification times and tell the reader to run `npm run build` or `npm run typecheck`. Both are `tsc -b`, whose up-to-date decision is content-aware — so when a source file's timestamp moved but its content did not, `tsc -b` exits `0` without re-emitting, the comparison still fails, and the message names the command just run. Reachable via `git checkout --`, a stash pop, or a copy that resets timestamps.
- **Fix:** compare build state rather than timestamps in `assertBuilt` (two sites), or name `tsc -b --force` in the failure message **and** in `.agents/rules/testing.md:68`.

### B15 — Test debt that let this ship

#### W-57 · High · test · No fixture is at real scale, on the zero-config path, or in a dot-directory

- **Sources:** the field test's own summary — the four findings that would change a user's first ten minutes "are all invisible to the in-repo suite for the same reason: no fixture has a nested `node_modules`, a dot-directory full of real documentation, a 96 KB document, or a hand-written glob." The crosscheck generalizes it: of 16 defects the audit missed, all fall into fixture scale, default quality, the zero-config path, or process-boundary rendering.
- **What to add:**
  1. A fixture with a **nested** `node_modules` and a root one, linted with **no config** — covers W-02, and would have caught the blocker.
  2. A fixture with Markdown in a dot-directory, run through `init` then `lint`, with the corpus compared to a tracked-file list in **both** directions — covers W-14 and W-15.
  3. A large-corpus assertion for the two renderers: a bound on the longest line of `graph --format human` and on the dependency section's share of a compiled skill — covers W-26 and W-27.
  4. Hand-written glob shapes, including the four in field F-14's table and an ordered negation — covers W-01 and W-03.
  5. Where a defect is only observable across a process boundary, tag the guard with its `@boundary-guard` category.
- **Accept when:** each of W-01, W-02, W-14, W-26, W-27 has a test that fails before its fix.

#### W-58 · Medium · test · Nothing pins the ad-hoc MCP `lint` step order against `lintFiles`

- **Sources:** report.md, invariant 2 — recorded there as within the invariant but named as the one place the pipeline's order exists twice.
- **Observed:** `handleLint` assembles, inside the host, the sequence `lintFiles` owns in core — parse, synthetic one-document corpus, `runRules`, the inline-disable filter, the severity counts, core's text formatter. Every step composes a core export and every choice is justified in place, but nothing pins the two orders together, so **a step added to `lintFiles` would silently not reach this tool.**
- **Fix:** a differential test asserting the two paths agree on the same content, or hoist an "ad-hoc lint" entry point into core, which is where the report says the seam would pay for itself.

## Parked, with the reason

Not backlog items. Recorded so they are not re-triaged.

| Source | Why parked |
| --- | --- |
| field F-02 (format gate red on an in-flight docs edit) | Fixed during the field-test run; no product defect. The class is prevented by the standing format-gate rule |
| report F29 | Withdrawn in the source after re-checking, and kept there as a visible withdrawal. The comment is accurate as written |
| report F38 (all six skipped tests are the Windows path guards) | Correct as designed and correctly gated; the field test independently reproduced `850 passed, 6 skipped`. Worth knowing when verifying H-2 locally: a green POSIX run proves the POSIX half only |
| report F24's `getImpactSet` half | Not a judgment call — it is settled by the decision record, so it lives in **W-47**, not W-40 |
| P12.03's quadratic-hot-path conclusion | Neither the audit nor its verification re-benchmarked it. No performance claim is made here in either direction |
| report F23's missing per-package lifecycle hook | The report filed the shipped-payload half as F23 (**W-31**) and explicitly **corrected and parked** this half: `private: true` blocks publishing, not packing, so a root `npm pack` does run `prepack` → `npm run build`, while `npm pack -w <pkg>` runs no lifecycle script at all. A workspace pack of an unbuilt tree would therefore ship no `dist`; CI compensates by building first and says why (`.github/workflows/ci.yml:61`). Packaging lifecycle hooks are `P-release/index.md:35` and `:39`, which has not started, so this is pending phase work rather than a defect. **Relevant to W-30:** its fix adds `--workspaces` to `release:check`, i.e. the pack path that runs no build — the script already chains `npm run build` first, and it must keep doing so. The end state was never reproduced (producing a `dist`-less tarball would have destroyed the build the audit depended on) |
| requirement I6's unqualified acceptance | `requirements/06-installation.md:16` marks I6 "✅ Accepted" for a publishable Action that is `PR.03`, Not started, while the glossary marks it planned. The report judged this a readability complaint rather than a false claim, because that column records requirement _acceptance_, not delivery. **W-45** sweeps the same file — fold a qualifier in there if it is cheap; do not open a task for it |

## Addendum — pre-implementation audit of P13–P17

A pass over the 25 task files before implementation started, checking each item's requirements and goals against this document and against the tree. Coverage came out complete — all 58 items land in exactly one task, and the code citations spot-checked (~50 line references across `packages/`, `scripts/`, `.github/`, `README.md`, `docs/guide/`) were accurate. Four things did not survive contact with the current tree, and they are recorded here rather than folded silently into the tasks.

**Line-number anchors into `glossary.md` and `AGENTS.md` are stale.** Every one was correct at `d96b64c` and was invalidated by `add1ee5` — this document's own commit, which also edited both files. Corrections, and the reason the task files now cite entries by **name** instead of by line:

| Cited here | Where it actually is |
| --- | --- |
| `glossary.md:68` (W-41) | the **`lintFiles`** entry |
| `glossary.md:204` (W-22) | the **`graph`** entry |
| `glossary.md:275` (W-30) | the **`release:check` / `npm pack --dry-run`** entry |
| `glossary.md:305` (W-53) | the **`migrate` command (I8)** entry |
| `glossary.md:12` and `:248` (W-42) | **one** roll-up survives, the **Phase** entry; the `:12` "Shipped vs planned" bullet was deleted in `add1ee5` |
| `AGENTS.md:47` (W-52) | **deleted** in `add1ee5` — see W-52a |

**W-41's scope is one glossary site wider than stated.** Besides the `lintFiles` entry, the **LSP server** and **Async rules / external HTTP checks** entries restate the synchronous-pipeline framing. The second is partly true (rules are synchronous), so both need classifying rather than deleting, or the corrected ADR still has the glossary contradicting it. Folded into [P17.03](P17-plan-of-record/03-adr-and-dependency-register.md).

**W-45's enumeration was six sites for a count of seven.** The seventh is `requirements/index.md:14`, which assigns requirements document 06 to "P6, P9". Also worth naming as a do-not-touch neighbour: `requirements/06-installation.md:30` ("audit P9 engines gap") is the correct remediation sense **in a file this sweep does edit at `:3`**. Folded into [P17.05](P17-plan-of-record/05-p-release-rename-sweep.md).

**W-42's box counts describe the pre-P13 plan, not the tree.** 148 unchecked / 255 checked is exact for everything outside `P13-correctness/` … `P17-plan-of-record/`; those five directories added **223** unchecked boxes of their own, so the tree carries 371 today. By the time [P17.04](P17-plan-of-record/04-completion-surface.md) runs, P13–P16 will read `Status **Done**` with roughly 180 open boxes beneath them — the same defect one round later — so that task's decision has to cover its own phases. Recorded there.

### Two items with no source finding

Both are drift created **after** the four assessments, so no `F`-number defines them. They are the same classes this backlog already carries, which is why they belong in [P17.06](P17-plan-of-record/06-register-and-roadmap.md) rather than in a new phase.

| ID | Sev | Type | Item |
| --- | --- | --- | --- |
| W-51a | Low | docs | The glossary's **Milestone (M1–M4)** entry omits P13–P17 from M4 while the roadmap's §7 list includes them — W-51's class, introduced by the change that created these phases |
| W-52a | Medium | docs | **It also left the format gate red at `HEAD`:** the deletion stranded a double blank line under the glossary's `# ` heading, so `prettier --check .` failed on a committed file until the audit fixed that one line. `add1ee5` deleted `AGENTS.md`'s `## Delivery Order` section and the whole glossary preamble — its `Status` header, "How to use", the "Shipped vs planned" roll-up, and the **Maintenance rule** that `CLAUDE.md`, `AGENTS.md` and `.agents/rules/coding-style.md` all point at. `CLAUDE.md`'s "see the glossary's maintenance rule" is now a pointer to deleted text. This is **W-44's mechanism** — a load-bearing document removed as a side effect of an unrelated commit — and it is absent from this backlog because the deletion shipped in the same commit as the backlog |

## Coverage this backlog does not claim

Stated so a future reader does not mistake the inventory for exhaustive.

- **Three of the report's own sections were never independently checked, and they are the largest such surface.** report-verification confirmed all 40 findings but states plainly that it did not verify the **78-criterion completion table**, the **eight-invariant table**, or the **Requirement-ID conformance section** — calling them "самая большая непроверенная мной поверхность отчёта". So the header's "all 40 confirmed" covers the findings, not those three verdict tables. Two claims in this backlog rest on them: W-42's "only two of 78 index criteria are not met in code", and every "the invariant holds" premise behind items that describe a defect as local rather than architectural. Neither is disputed; both are single-sourced.
- **Roughly 20 of the decision log's 29 numbered entries are unexamined.** Nine were traced to code and two of those nine were wrong (W-47). The report names this as the largest un-swept surface it leaves behind and the most likely place for another finding of that shape.
- **The 92 task-level exit criteria were counted, not individually traced.** Four files were sampled and one criterion followed to a test. W-42 establishes that the completion surface is unreliable — **not** that the work beneath it is incomplete.
- **85 of 132 plan task files were read only through whole-corpus extractions.** Their per-task design narrative and their `Previous`/`Next`/`Depends on`/`Blocks` chains are unverified.
- **The behavioral prose of 19 of the 26 per-rule guide pages** was never compared to code. The comparison produced two findings on the seven pages where it was done.
- **20 test files were read at inventory level only.** "A test asserting X exists at this line" is verified; "that test's body is adequate" is not.
- **The field test exercised one external repository on macOS.** Windows and Linux behavior at real scale, and any repository shaped unlike an Angular/.NET monorepo, are untested in practice.
