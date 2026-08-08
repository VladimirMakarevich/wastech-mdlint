# P17.05 · The `P-release` rename sweep

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Backlog: [W-45](../remediation-backlog-2026-08-05.md) (Medium), [W-46](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F7 (MEDIUM), F16 (MED-LOW; counts re-derived independently in the QA pass, matching line for line). Depends on [P16](../P16-release-readiness/index.md).

## Goal

Finish a rename that was applied to one directory and never swept: `P9-release` became `P-release`, and lines across the tree still assign release work to `P9` — **seven in the plan** (W-45), **four in shipped artifacts and CI** (W-46, down from eleven), plus `README.md:35`, which W-46's fix adds as the same class through a different mechanism. The two halves are swept differently: the plan half is prose in tiers 1 and 2, the artifact half is published skill frontmatter and a user-visible CI log line.

> **Re-derived after P13–P16.** The artifact half shrank from eleven lines to four. Enforcing self-contained code comments during that round deleted every planning-tag comment in product code, CI, and tests — which took seven of W-46's sites with it as a side effect, along with the twelfth candidate this task was to decide. What survives is the half that is **not** a comment: three `compatibility:` strings in published skill frontmatter and one `run: echo` line users read in a CI log. W-45's seven plan sites are untouched, because prose in a task file is not a code comment. Counts below are as re-verified in the current tree.

## Problem

The release phase was renamed from `P9-release` to `P-release` in `573d4f6`, a commit that touched nothing outside `docs/`. After the rename, `P9.03` means "Add Windows/macOS to the CI matrix" (`Status **Done**`), while the composite Action is `PR.03` (`Status **Not started**`) — so a stale `P9.03` now names a completed task instead of the pending one it meant.

**W-45 — seven stale references inside the plan.** Enumerated in the current tree, so the sweep is not left to a grep:

| Site | Tier |
| --- | --- |
| `P0-foundations/index.md:51`, `P6-init/index.md:47`, `P7-mcp-server/index.md:45` | phase indexes (tier 1) |
| `requirements/04-skills-compile.md:50`, `requirements/05-mcp-server.md:44`, `requirements/06-installation.md:3` | locked requirements (tier 2) |
| `requirements/index.md:14` | the requirements index — the seventh, and the one an enumeration of "three indexes plus three documents" loses |

**Three of the six locked requirements documents — precedence tier 2 — assign accepted requirements to P9**, two of them naming work that shipped in P7.05 and P8.05. So a tier-2 document and a tier-1 index now contradict each other about what P9 is. `P10.02` closed this class **in the glossary alone** and says so, which is why the rest survived.

**W-46 — four stale lines in shipped artifacts.** Re-verified in the current tree; a full `git grep -n P9 -- ':!docs/'` returns these four plus the correct-sense references in step 3 and lockfile hash noise:

| Site | Kind |
| --- | --- |
| `skills/wastech-mdlint-init/SKILL.md:5`, `skills/wastech-mdlint-fix/SKILL.md:5`, `skills/wastech-mdlint-impact/SKILL.md:5` | **published skill frontmatter** — `compatibility:` promises a release "from one P9 single-tag release" |
| `.github/workflows/publish.yml:43` | shipped CI, a **user-visible log line**: `Single-tag release … lands in P9 (I4)` |

**Seven sites are already gone, and it is worth knowing why** — so a sweep does not go looking for them. `config-writer.ts` (2 lines), `ci.yml` (1), `publish.yml` (3 of its 4), one test comment, and the twelfth candidate in `compile/skill-frontmatter.ts` were all **comments**, and the self-contained-comment rule adopted during P13–P16 removed every planning tag from code, CI, and test comments. The rule is now in `.agents/rules/coding-style.md`, so those sites cannot come back in that form. Nothing decided the P8.05-versus-P9 question the twelfth candidate posed; the comment carrying it was simply deleted, which closes it.

**Why the remainder still matters:** the three survivors are published skill frontmatter promising users a release that no longer has that name, and the fourth is a CI log line users read. All four are **values**, not comments, which is exactly why the comment sweep did not reach them. And the original class survived `P10-consistency/03-stale-comments.md` — a phase whose explicit job was cleaning stale source comments, marked Done.

## Deliverables / steps

1. **Sweep the plan (W-45):** all seven sites in the table above — the three phase indexes, the three locked requirements documents, and `requirements/index.md:14`. The tier-2 documents are the priority: a locked requirement contradicting an index about what a phase is called is worse than a summary doing it.
2. **Edit the four enumerated lines (W-46)**, plus `README.md:35`, which still describes the shipped MCP surface in future tense by phase (`lint`/`lint-files` "ship in P7.02" …) — the same class, different mechanism, and a fifth file. All five are user-visible strings; none is a comment.
3. **Do not sweep by pattern.** `P9` still names the post-audit remediation phase, and only the _release_ sense of it is stale. Four live examples a blind `s/P9/P-release/` would break, re-derived in the current tree: `AGENTS.md:89` and `:99`, `.agents/rules/architecture.md:51` (the roadmap order), `.agents/rules/testing.md:29` (the post-P9 audit the boundary-guard categories rest on), and `requirements/06-installation.md:30` ("audit P9 engines gap") — the last of which sits in a file this task **does** edit at `:3`, so the same file needs one line changed and one left alone. (The `ci.yml` format-gate reference the backlog paired with it is gone; it was a comment.) Edit the enumerated lines, then re-grep and classify each remaining hit by what it refers to.
4. **Hand-edit the skill frontmatter — it is authored, not generated.** Verified: `scripts/generate-docs.mjs` writes exactly two files, `packages/cli/schema.json` and the README's generated block, and touches nothing under `skills/`. So there is no generator to fix here, and no regeneration step to run.
5. **Say what the compatibility strings should say instead.** They are a version-coupling promise, not a phase reference: the useful form names the coupling (one tag ships the CLI and the skills together) without naming a phase that will be renamed again. Whatever is chosen lands in all three files identically, since they are three copies of one sentence.

## Out of scope

Renaming anything else, and re-opening the `P9-release` → `P-release` decision. Also out of scope: the neighbouring stale-identifier class inside guide pages, if any — this task's class is the release-sense `P9` specifically, bounded by the enumeration above.

## Exit criteria

- [x] All seven plan sites — three phase indexes, three locked requirements documents, and `requirements/index.md:14` — no longer assign release work to `P9`.
- [x] The four enumerated artifact lines plus `README.md:35` are corrected.
- [x] Every remaining `P9` outside `docs/` either names the remediation phase correctly or is gone — verified by a re-grep with each hit classified, not by a pattern replace.
- [x] `AGENTS.md:89`/`:99`, `.agents/rules/architecture.md:51`, `.agents/rules/testing.md:29`, and `requirements/06-installation.md:30` are **untouched** — all name the remediation phase correctly.
- [x] The three `SKILL.md` `compatibility:` strings carry the same replacement sentence and no phase name.
- [x] Gates green, including `npm run format`.

## Implementation notes

**The enumeration was not complete, and the sweep was extended past it rather than stopping at twelve.** Classifying every `P9` in `docs/` — not just the enumerated files — turned up **nine more release-sense sites in five plan files** that the "enumerated in the current tree, so the sweep is not left to a grep" table missed. They are all in task files and a decision log rather than in the indexes and requirements the enumeration sampled, which is why an enumeration built from tiers 1 and 2 did not see them. Leaving them would have reproduced this task's own defect one directory over, so they were swept in the same pass:

| Site | Was | Now |
| --- | --- | --- |
| `P0-foundations/07-ci-packaging-baseline.md:7`, `:24` | `[P9](../index.md)` | `[P-release](../P-release/index.md)` — and the link now points at the release phase index rather than the roadmap, so it resolves to the thing it names |
| `P0-foundations/07-ci-packaging-baseline.md:29`, `:41` | "deferred to P9", "P9 inherits" | `P-release` |
| `P5-compile/04-synthesize.md:21` | "P9 CI validates against the same schema" | the CI validation added at [P8.05](../P8-skills/05-skills-validation.md) — this is the question the twelfth candidate posed and nobody answered; it is answered here |
| `P6-init/04-config-writer-schema.md:19`, `:42` | `P9.03` | [PR.03](../P-release/03-github-action.md) |
| `decisions/pre-implementation-decisions.md:58` | `P9.01` in the target list | `PR.01` |
| `p1-p3-execution-notes.md:25` | "Полный маркетинговый polish — P9." | `P-release` |

`P9.01` and `P9.03` are the two that prove the sense: in the remediation phase they are "import positions" and "cross-OS CI", neither of which has anything to do with packaging metadata or a composite Action. The two `P6-init` sites are the case the Problem section describes exactly — the sentence at `:19` already links `PR.03` two clauses earlier and then hands the same work to `P9.03`, so the file contradicted itself in one paragraph.

**Two of the three locked requirements were repointed forward, not renamed.** `requirements/04-skills-compile.md:50` and `requirements/05-mcp-server.md:44` name work that already shipped, so `P-release` would have been a second wrong answer. They now read `CI (P8)` and `Docs/CI (P7)` and each links the task that delivered it, which is checkable by the link gate rather than by a reader's memory. Only `06-installation.md:3` describes genuinely unshipped work, so it is the one that became `P-release`.

**The `engines.node` phrase was left alone at all four of its sites, deliberately and slightly uncomfortably.** "audit P9 engines gap" appears at `requirements/06-installation.md:30`, `P0-foundations/01-workspace-decisions.md:19`, `P0-foundations/07-ci-packaging-baseline.md:23`, and as the label on `decisions/pre-implementation-decisions.md:58`. The exit criteria name the first as remediation-sense and require it untouched, so all four were treated the same way for consistency — a phrase cannot be correct in one file and stale in the next. Worth recording the doubt rather than burying it: the decision is dated 2026-07-02, three weeks before the P0–P8 audit that created the remediation phase, so at authoring time `P9` in that phrase can only have meant the release directory. The `P9.01` inside that same bullet's target list was unambiguous and was corrected; the label was not. If a later reader wants the phrase reworded, it is one class of four lines, not a scattered sweep.

**The compatibility string was rewritten to stop naming a phase at all.** All three files carry the identical sentence, and the parenthetical changed from "both ship from one P9 single-tag release" to "one tag publishes the CLI and tags the skills together". That states the coupling a user needs — same tag on both, do not mix — without a name that gets renamed again; the previous form would have been stale a second time the moment `P-release` acquired a number. Nothing asserts this value: `compile/skill-frontmatter.ts` types it as an optional string with no content constraint, and `skills-validation.test.ts` validates the frontmatter parse and the body but never reads the field. The mechanical constraints that do apply were respected — the hand-rolled YAML reader in `skills/parse-static-skill.ts` requires a single-line, JSON-parseable double-quoted scalar, and Prettier covers `skills/**`.

**`publish.yml:43` lost its requirement id along with its phase.** The line is an `echo` a maintainer reads in a workflow log, so `(I4)` was as opaque there as `P9` was — it now says what is missing ("the single-tag release that publishes core+cli+mcp and tags the skills together is not wired up") instead of pointing at a document. This is a value, not a comment, so the self-contained-comment rule did not reach it during P13–P16; the same reasoning applies anyway.

**`README.md:35` was rewritten to the present tense rather than to the right phase numbers.** The row promised tools that "ship in P7.02 / P7.03 / P7.04"; all six shipped, and the README already carries a generated MCP tool table further down. It now names the six as delivered surface, so the hand-authored row and the generated block agree. It sits outside both `BEGIN GENERATED` regions, so `generate-docs.mjs` does not overwrite it and neither `docs-sync` test compares it.

**The roadmap's own summary of this sweep was re-derived out of existence.** `index.md:305` still carried the pre-re-derivation figures — "19 stale release-sense `P9` lines (7 in the plan, 11 in shipped artifacts and CI … plus `README.md:34`)" — which were wrong in three ways after P13–P16 and would have been wrong a fourth way after this task extended the plan half. Writing a count into a summary is what produced that drift, so the count is gone: the line now says the sweep covers every stale release-sense `P9` across the plan, three published skill frontmatter strings, and a CI log line.

**The re-grep, with every hit classified.** Outside `docs/` exactly four references remain — `AGENTS.md:89` and `:99`, `.agents/rules/architecture.md:51`, `.agents/rules/testing.md:29` — all naming the post-audit remediation phase correctly, and all on the untouched list. `package-lock.json`'s eleven hits are base64 inside `integrity` digests, not references. Inside `docs/` what remains is remediation-sense (`P9.05`, `P9.06`, `P9.07`, "post-P9", the P10 index's `Depends on`, the roadmap's sequence diagram), frozen record (the two audit reports, the backlog's evidence rows, `docs/research/**`), or this phase's own prose describing the defect — including this file, which keeps the stale strings it quotes because a task file that erased its own evidence would be unreviewable.

**Out of class and left alone, but worth naming:** `README.md:7` says "22 built-in rules" where the generated table has 24 rows. It is a stale user-facing number found while editing the same file, but it is not a phase reference and nothing asserts it — a separate item, not a quiet widening of this one.

**No code, no tests.** Documentation, three skill frontmatter values, one CI `echo`, and one README row. No term was added, renamed, or retired, so the glossary needed nothing; nothing was accepted instead of fixed, so the register needed nothing. Verification was by command: `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`, `npm run lint:docs`, and `npm run format`.
