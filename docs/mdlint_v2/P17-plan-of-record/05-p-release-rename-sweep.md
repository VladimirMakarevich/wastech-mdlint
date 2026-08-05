# P17.05 · The `P-release` rename sweep

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-45](../remediation-backlog-2026-08-05.md) (Medium), [W-46](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F7 (MEDIUM), F16 (MED-LOW; counts re-derived independently in the QA pass, matching line for line). Depends on [P16](../P16-release-readiness/index.md).

## Goal

Finish a rename that was applied to one directory and never swept: `P9-release` became `P-release`, and eighteen lines across the plan and the **shipped artifacts** still assign release work to `P9`.

## Problem

The release phase was renamed from `P9-release` to `P-release` in `573d4f6`, a commit that touched nothing outside `docs/`. After the rename, `P9.03` means "Add Windows/macOS to the CI matrix" (`Status **Done**`), while the composite Action is `PR.03` (`Status **Not started**`) — so a stale `P9.03` now names a completed task instead of the pending one it meant.

**W-45 — seven stale references inside the plan.** Three phase indexes still assign release work to P9, and **three of the six locked requirements documents — precedence tier 2 — assign accepted requirements to it**, two of them naming work that shipped in P7.05 and P8.05. So a tier-2 document and a tier-1 index now contradict each other about what P9 is. `P10.02` closed this class **in the glossary alone** and says so, which is why the rest survived.

**W-46 — eleven stale lines in shipped artifacts.** Verified in the current tree, ten of them in shipped artifacts across six files plus one test comment:

| Site | Kind |
| --- | --- |
| `packages/core/src/discovery/config-writer.ts:170`, `:171` | shipped core runtime, naming the composite Action as P9.03 |
| `.github/workflows/ci.yml:44` | shipped CI comment |
| `.github/workflows/publish.yml:5`, `:7`, `:19`, `:43` | shipped CI; `:43` is a **user-visible log line** |
| `skills/wastech-mdlint-init/SKILL.md:5`, `skills/wastech-mdlint-fix/SKILL.md:5`, `skills/wastech-mdlint-impact/SKILL.md:5` | **published skill frontmatter** |
| `packages/cli/test/init.e2e.test.ts:1249` | test comment, not a shipped artifact |

**Why it matters:** three of the sites are published skill frontmatter promising users a release that no longer has that name, and one is a CI log line users read. And this survived `P10-consistency/03-stale-comments.md` — a phase whose explicit job was cleaning stale source comments, marked Done.

A twelfth candidate at `packages/core/src/compile/skill-frontmatter.ts:4` names "P9's CI check" for what shipped as P8.05 — softer than the others, because the check it names does exist.

## Deliverables / steps

1. **Sweep the plan (W-45):** the three phase indexes and the three locked requirements documents under `docs/mdlint_v2/requirements/`. The tier-2 documents are the priority — a locked requirement contradicting an index about what a phase is called is worse than a summary doing it.
2. **Edit the eleven enumerated lines (W-46)**, plus `README.md:34`, which still describes the shipped MCP surface in future tense by phase — the same class, different mechanism, and an eighth file.
3. **Do not sweep by pattern.** The audit checked the rest of the tree and found the references to **`P9.04`, `P9.06`, and `P9.07` are all correct** — `P9` still names the post-audit remediation phase, and only the _release_ sense of it is stale. `.github/workflows/ci.yml:16` (`M-6 / P9.06`, the format gate) is a live example a blind `s/P9/P-release/` would break. Edit the enumerated lines, then re-grep and classify each remaining hit by what it refers to.
4. **Decide the twelfth candidate** deliberately: correct `skill-frontmatter.ts:4` to P8.05, or leave it and say why in the change. Silence here is how it becomes a thirteenth finding.
5. **Regenerate rather than hand-edit** anything generated. The three `SKILL.md` files are published artifacts; check whether their frontmatter is generated or authored before editing, and if generated, fix the generator.
6. **Note the shipped-runtime consequence.** `config-writer.ts:170-171` is core runtime that `init` reads when writing a CI workflow template; changing a comment there is safe, but confirm the comment is not load-bearing for the template's `uses:`-versus-inline decision, which it explains.

## Out of scope

Renaming anything else, and re-opening the `P9-release` → `P-release` decision. Also out of scope: the neighbouring stale-identifier class inside guide pages, if any — this task's class is the release-sense `P9` specifically, bounded by the enumeration above.

## Exit criteria

- [ ] The three phase indexes and three locked requirements documents no longer assign release work to `P9`.
- [ ] The eleven enumerated lines plus `README.md:34` are corrected.
- [ ] Every remaining `P9` outside `docs/` either names the remediation phase correctly or is gone — verified by a re-grep with each hit classified, not by a pattern replace.
- [ ] `.github/workflows/ci.yml:16` is **untouched**.
- [ ] The three published `SKILL.md` frontmatter lines are correct, via the generator if they are generated.
- [ ] `skill-frontmatter.ts:4` is corrected or deliberately left, stated in the change.
- [ ] Gates green, including `npm run format`.
