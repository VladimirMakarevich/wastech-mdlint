# P17.06 · Register contract and roadmap accuracy

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-48](../remediation-backlog-2026-08-05.md) (Medium), [W-49](../remediation-backlog-2026-08-05.md) (Low), [W-51](../remediation-backlog-2026-08-05.md) (Low), [W-52](../remediation-backlog-2026-08-05.md) (Note). Sources: audit F20, F34, F36, F37, F41. Depends on [P17.04](04-completion-surface.md).

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

**W-51 — two roadmap inaccuracies.** `index.md:17` and the target tree at `:83` list six CLI commands; a **seventh, `schema`, ships** and is mandated by its own task file, by requirement C9, and by the glossary — so under the stated precedence the roadmap summary is the defect, not the code. And `:87` diagrams `schema.json` at the repository root; it has only ever lived at `packages/cli/schema.json`, which the installed-path constant and the CLI's `files` allowlist both require.

**W-52 — the frozen audits are in Russian (note).** The QA pass disputed the value of this item, noting the repository owner is a Russian speaker and no rule requires English. The fact that makes it more than style: those two files are the **definition site** for the finding IDs four phases are written in, and nothing else defines them. `AGENTS.md:47` derives P9–P12 from them by name; `.agents/rules/testing.md:29` rests the four boundary-guard categories on the second report's systemic-cause section; the two release blockers cited in `P11-remediation/index.md` are defined only there.

## Deliverables / steps

1. **W-48:** repoint row `:24` at `docs/guide/cli.md:127`, and add the two missing rows.
2. **W-48 — dispose of row `:39`.** Close it (name the schema in the `init` draft — a small [`init-command.ts`](../../../packages/cli/src/init-command.ts) change, which makes this task `docs, code` rather than docs-only) or re-classify it as genuinely accepted with a stated reason.
3. **W-48 — this is where the phase's decisions land.** Every **decision** item across P13–P16 terminates here if it resolves to "accept": [P13.04](../P13-correctness/04-rule-option-defaults.md)'s `GRP-001` severity, [P14.03](../P14-host-boundary/03-init-disclosure.md)'s hidden-directory default, [P14.05](../P14-host-boundary/05-mcp-error-contract.md)'s two, [P15.01](../P15-output-contracts/01-renderers-at-scale.md)'s role vocabulary, [P16.03](../P16-release-readiness/03-published-payload.md)'s engines question, [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)'s two. Run this task **after** those have decided, and verify each row has a real user-facing home rather than a plausible-looking pointer — which is site 1's exact failure mode.
4. **W-49:** retype the corrupted line, avoiding the construct. The standing rule already exists in the backlog and in `AGENTS.md`; this is the live instance.
5. **W-51:** add `schema` to both command lists at `index.md:17` and `:83`, and move `schema.json` in the tree diagram at `:87` to `packages/cli/`.
6. **W-52 — cheapest sufficient option:** one line at each report's head stating the language, plus an English rendering of the two finding tables — the parts the plan actually cites. Or record the choice, since the audits are frozen by policy. **Not a blocker for anything**, and the QA pass's disagreement about its value should be recorded alongside whatever is done.
7. **Update `P12-consistency/06-process-boundary-tests.md:72`** if its claim is still not literally true after the register is fixed.

## Out of scope

Rewriting the frozen audit reports. Adding register rows for behaviors nobody accepted — the register indexes decisions, and inventing rows to make it look complete is the inverse of this task's point.

## Exit criteria

- [ ] Row `:24` points at a page that states the behavior; the two missing rows exist.
- [ ] Row `:39` is closed in code or re-classified with a reason.
- [ ] Every P13–P16 decision that resolved to "accept" has a register row with a verified user-facing home.
- [ ] `P7-mcp-server/02-lint-tools.md:35` reads as authored, and the format gate is green on it.
- [ ] The roadmap lists seven CLI commands and diagrams `schema.json` under `packages/cli/`.
- [ ] Each frozen audit states its language, or the choice is recorded with the disagreement noted.
- [ ] `P12.06`'s "confirmed to exist and to state it" claim is true or corrected.
- [ ] `npm run format` green.
