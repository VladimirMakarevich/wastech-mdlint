# P17.06 · Register contract and roadmap accuracy

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-48](../remediation-backlog-2026-08-05.md) (Medium), [W-49](../remediation-backlog-2026-08-05.md) (Low), [W-51](../remediation-backlog-2026-08-05.md) (Low), [W-52](../remediation-backlog-2026-08-05.md) (Note), plus **W-51a** and **W-52a** from the backlog's [pre-implementation addendum](../remediation-backlog-2026-08-05.md#addendum--pre-implementation-audit-of-p13p17) (drift created after the backlog was written). Sources: audit F20, F34, F36, F37, F41. Depends on [P17.04](04-completion-surface.md).

## Goal

Make the accepted-behaviors register satisfy its own contract — it is where every **decision** item in this backlog terminates — and clear the last three roadmap and documentation inaccuracies.

## Problem

**W-48 — the register fails its own three rules, at three sites.**

1. Row `:24` names `docs/guide/output.md` as the home of the leftover-`schema.json` behavior; that page contains **zero** occurrences of "schema" (verified). The behavior **is** stated for users, at `docs/guide/cli.md:127` — so the defect is the pointer, not a missing home.
2. The id-ref-inside-a-code-fence inflation was accepted **twice in task files** and has no row, though it inflates `impact`, `slice`, and `GRP-002`.
3. Dangling reference-style links invisible to `REF-001` were accepted and given a README home, but never a row.

**Consequence:** `P12-consistency/06-process-boundary-tests.md:72` claims each accepted behavior has a home "confirmed to exist and to state it". Site 1 falsifies that.

**And the register flags one row against itself.** Row `:39` — the `init` draft a user confirms does not name the project-local `schema.json` the `npx` path writes, only the after-the-fact write summary does — is marked **deferred rather than accepted**, and its own reason column calls it "the one row here a future task should close rather than keep". It is a gap against the warn-before-confirming discipline, not a behavior anyone chose. Leaving a self-flagged row untouched while fixing the register's other three failures is the one outcome to avoid.

**W-49 — live Prettier corruption in a phase task file.** `P7-mcp-server/02-lint-tools.md:35` has been destructively rewritten where a glob-bearing code span was nested inside a bold span: the inline delimiters were eaten and the sentence is unreadable as authored (`**/_.md` where `**/*.md` was written, with the surrounding spacing collapsed). `proseWrap: "never"` is why the gate cannot see it — **the format gate passes on the damage.** The class grep returns exactly one site.

**W-51a — the roadmap and the glossary disagree about milestone M4.** `index.md`'s §7 milestone list assigns "P6, P8, then P9/P10, P11/P12 and P13–P17 (three post-audit remediation rounds), then P-release" to M4; the glossary's **Milestone (M1–M4)** entry still reads "(P6, P8, then P9/P10 and P11/P12, then P-release)" — P13–P17 missing. Same class as W-51, introduced by the change that created these phases rather than by the original rename, so it is swept here.

**W-51 — two roadmap inaccuracies.** `index.md:17` and the target tree at `:83` list six CLI commands; a **seventh, `schema`, ships** and is mandated by its own task file, by requirement C9, and by the glossary — so under the stated precedence the roadmap summary is the defect, not the code. And `:87` diagrams `schema.json` at the repository root; it has only ever lived at `packages/cli/schema.json`, which the installed-path constant and the CLI's `files` allowlist both require.

**W-52 — the frozen audits are in Russian (note).** The QA pass disputed the value of this item, noting the repository owner is a Russian speaker and no rule requires English. The fact that makes it more than style: those two files are the **definition site** for the finding IDs four phases are written in, and nothing else defines them. `.agents/rules/testing.md:29` rests the four boundary-guard categories on the second report's systemic-cause section; the two release blockers cited in `P11-remediation/index.md` are defined only there; and the glossary's **Phase** entry derives all three remediation rounds from the three assessments by name. The backlog's third citation, `AGENTS.md:47`, **no longer exists** — see W-52a below, which is where that deletion is handled.

**W-52a — an unrecorded governance deletion, found while auditing this phase.** Commit `add1ee5`, the same commit that added the backlog, also removed content nothing asked it to:

1. **`AGENTS.md`'s entire `## Delivery Order` section** — the `P0 → … → P-release` order, the sentence deriving P9–P12 from the two audits by name (the backlog's `AGENTS.md:47`), and "respect each task file's `Previous`, `Next`, `Depends on`, and `Blocks` links". The phase order survives in [`.agents/rules/architecture.md`](../../../.agents/rules/architecture.md); the audit derivation and the task-chain rule survive nowhere.
2. **The glossary's entire preamble** — its `> **Status:**` header (every other plan document has one), "How to use this glossary", the "Shipped vs planned" roll-up (W-42's `:12`), and the **Maintenance rule**. [`CLAUDE.md`](../../../CLAUDE.md) still instructs the reader to "see the glossary's maintenance rule", which is now a pointer to deleted text — and both `AGENTS.md` and [`.agents/rules/coding-style.md`](../../../.agents/rules/coding-style.md) restate that rule while the glossary itself no longer carries it.

This is W-44's mechanism exactly — a load-bearing document removed as a side effect of an unrelated commit — one round later, and it is not in the backlog because the backlog was committed alongside it. It also **left the format gate red at `HEAD`**: the deleted preamble stranded a double blank line under the glossary's heading, so `prettier --check .` failed on a committed file. That one line is already fixed (it blocked every other commit); the rest of this item is the work below.

## Deliverables / steps

1. **W-48:** repoint row `:24` at `docs/guide/cli.md:127`, and add the two missing rows.
2. **W-48 — dispose of row `:39`.** Close it (name the schema in the `init` draft — a small [`init-command.ts`](../../../packages/cli/src/init-command.ts) change, which makes this task `docs, code` rather than docs-only) or re-classify it as genuinely accepted with a stated reason.
3. **W-48 — this is where the phase's decisions land.** Every **decision** item across P13–P16 terminates here if it resolves to "accept": [P13.04](../P13-correctness/04-rule-option-defaults.md)'s `GRP-001` severity, [P14.03](../P14-host-boundary/03-init-disclosure.md)'s hidden-directory default, [P14.05](../P14-host-boundary/05-mcp-error-contract.md)'s two, [P15.01](../P15-output-contracts/01-renderers-at-scale.md)'s role vocabulary, [P16.03](../P16-release-readiness/03-published-payload.md)'s engines question, [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)'s two. Run this task **after** those have decided, and verify each row has a real user-facing home rather than a plausible-looking pointer — which is site 1's exact failure mode.
4. **W-49:** retype the corrupted line, avoiding the construct. The standing rule already exists in the backlog and in `AGENTS.md`; this is the live instance.
5. **W-51:** add `schema` to both command lists at `index.md:17` and `:83`, and move `schema.json` in the tree diagram at `:87` to `packages/cli/`.
6. **W-51a:** bring the glossary's **Milestone (M1–M4)** entry in line with the roadmap's §7 list by adding P13–P17 to M4.
7. **W-52a — restore what `add1ee5` dropped, deliberately rather than by revert.** The glossary's `> **Status:**` header and its **Maintenance rule** come back (the rule is quoted in three governance files, so the canonical statement belongs in the document they point at); the "Shipped vs planned" roll-up does **not** need restoring as a second roll-up — [P17.04](04-completion-surface.md) maintains the surviving **Phase** entry, and reintroducing a duplicate would recreate W-42's two-places-to-drift shape. For `AGENTS.md`, decide where the two orphaned statements live: the audit-to-phase derivation (needed by W-52's argument) and the `Previous`/`Next`/`Depends on`/`Blocks` task-chain rule, which `.agents/rules/architecture.md` states only for `Depends on`-style chains. Whatever is chosen, `CLAUDE.md`'s pointer must resolve when this task is done.
8. **W-52 — cheapest sufficient option:** one line at each report's head stating the language, plus an English rendering of the two finding tables — the parts the plan actually cites. Or record the choice, since the audits are frozen by policy. **Not a blocker for anything**, and the QA pass's disagreement about its value should be recorded alongside whatever is done.
9. **Update `P12-consistency/06-process-boundary-tests.md:72`** if its claim is still not literally true after the register is fixed.

## Out of scope

Rewriting the frozen audit reports. Adding register rows for behaviors nobody accepted — the register indexes decisions, and inventing rows to make it look complete is the inverse of this task's point.

## Exit criteria

- [ ] Row `:24` points at a page that states the behavior; the two missing rows exist.
- [ ] Row `:39` is closed in code or re-classified with a reason.
- [ ] Every P13–P16 decision that resolved to "accept" has a register row with a verified user-facing home.
- [ ] `P7-mcp-server/02-lint-tools.md:35` reads as authored, and the format gate is green on it.
- [ ] The roadmap lists seven CLI commands and diagrams `schema.json` under `packages/cli/`.
- [ ] The glossary's **Milestone** entry and the roadmap's §7 list agree about M4 (W-51a).
- [ ] The glossary carries a `Status` header and the **Maintenance rule** again, `AGENTS.md`'s two orphaned statements have a home, and `CLAUDE.md`'s "see the glossary's maintenance rule" pointer resolves (W-52a).
- [ ] Each frozen audit states its language, or the choice is recorded with the disagreement noted.
- [ ] `P12.06`'s "confirmed to exist and to state it" claim is true or corrected.
- [ ] `npm run format` green.
