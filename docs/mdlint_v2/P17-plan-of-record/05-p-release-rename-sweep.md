# P17.05 · The `P-release` rename sweep

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-45](../remediation-backlog-2026-08-05.md) (Medium), [W-46](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F7 (MEDIUM), F16 (MED-LOW; counts re-derived independently in the QA pass, matching line for line). Depends on [P16](../P16-release-readiness/index.md).

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

- [ ] All seven plan sites — three phase indexes, three locked requirements documents, and `requirements/index.md:14` — no longer assign release work to `P9`.
- [ ] The four enumerated artifact lines plus `README.md:35` are corrected.
- [ ] Every remaining `P9` outside `docs/` either names the remediation phase correctly or is gone — verified by a re-grep with each hit classified, not by a pattern replace.
- [ ] `AGENTS.md:89`/`:99`, `.agents/rules/architecture.md:51`, `.agents/rules/testing.md:29`, and `requirements/06-installation.md:30` are **untouched** — all name the remediation phase correctly.
- [ ] The three `SKILL.md` `compatibility:` strings carry the same replacement sentence and no phase name.
- [ ] Gates green, including `npm run format`.
