# P17.04 · The completion surface

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-42](../remediation-backlog-2026-08-05.md) (High), [W-50](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F2 (HIGH; **count corrected** by the QA pass to 30 files / 92 boxes; its HIGH grade was disputed there and the dispute was declined — see the backlog's Corrections table), F33 (LOW). Depends on [P17.03](03-adr-and-dependency-register.md). Blocks [P17.06](06-register-and-roadmap.md).

## Goal

Make the plan's completion state readable in both directions — and **decide** whether per-task checkboxes are load-bearing at all, rather than ticking 92 of them and recreating the problem next phase.

## Problem

**W-42 — no reliable completion surface, in either direction.** Counted over the plan files that existed when the backlog was written — **148 unchecked / 255 checked**; re-derived in the current tree against everything outside `P13-correctness/` … `P17-plan-of-record/` it is now **150 / 255**, so the historical half has barely moved:

- **92 exit criteria across 30 `Status **Done**` task files are unchecked** while their phase indexes are fully ticked. Two of those boxes are self-referential audits of exactly this. Re-derived in the current tree: still exactly 30 files and 92 boxes.
- **33 phase-index criteria are unchecked across five phases** — P9 (7 of 8 task files Done), P10 (8 of 8), P11 (14 of 14), P12 (6 of 6), and `P-release` (0 of 5 — the one honest row), of which the first four read `Status **Not started**` above task files that are Done. The glossary repeats the stale state in its **Phase (P0–P8, …)** entry — "P9 … is in progress; P10 …, P13–P17 … are pending". The backlog cites two roll-ups, at `glossary.md:12` and `:248`; **only one survives.** The `:12` "Shipped vs planned" bullet was deleted along with the rest of the glossary's preamble in `add1ee5`, the same commit that added the backlog — which is itself an instance of this phase's class and is picked up by [P17.06](06-register-and-roadmap.md).

**The P13–P16 half of this is already reconciled, and the shape of what happened is evidence for step 1.** The prediction here was that P13–P16 would land Done with roughly 180 open boxes. It did not happen that way in the task files: each of the 19 P13–P16 task files ticked its own exit criteria as it landed, so those directories now hold **0** unchecked boxes. Their four **indexes** did drift exactly as described — `Status **Not started**` above all-Done task files, with 43 criteria unticked — and have since been flipped to `Done` with their criteria ticked, ahead of this task. So the surface fails at the level nothing owns (the index) and holds at the level the task's own author is standing in (the task file), which is the distinction step 1 has to decide on.

**What is left for this task**, re-derived in the current tree: **206 unchecked / 429 checked** overall — 150 outside P13–P17, 56 inside `P17-plan-of-record/` (its own six task files plus its index), and 0 in P13–P16. The indexes still to flip are the **five** the backlog counted, not nine.

**Delivery-history evidence:** `git show 827bce8` shows the merge that landed P11 and P12 **rewriting** the Status line and all seven criteria lines of those indexes — reflowed for the prose-wrap setting — and preserving `Not started` and every empty box verbatim. So this is not neglect; it is a surface nothing maintains.

**Demonstrated harm:** under the stated precedence a reader concludes P0–P3 is unverified and P9–P12 is not done — the exact inverse of the indexes. It had already produced a wrong belief about a release gate: the pack-clean criterion is ticked at `P0-foundations/index.md:43` and open at `P-release/index.md:39`, and at the time `release:check` validated none of it. [P16.03](../P16-release-readiness/03-published-payload.md) has since closed the substance — `release:check` now ends in `npm pack --dry-run --workspaces` and `ci.yml` matrixes the same check per package — so the P0 box is now true and the `P-release` one is open only for the half it also asserts (the end-to-end CLI + MCP + skill smoke). The surface half is still this task's: two boxes about overlapping subjects, at different levels, that nothing keeps in step.

**One of the 92 boxes cannot honestly be ticked, and a sweep would tick it.** `P0-foundations/index.md:41` claims `[x]` that `scan` and `graph` "produce the same output as before the migration (parity check)"; the same criterion is `[ ]` at `P0-foundations/08-exit-verification.md:34`; and the reference implementation it compares against was **removed at the P3.09 cutover**, with no test standing in for it. The criterion is **permanently unverifiable**, so ticking the task-level box would assert a check nobody can perform — and the already-ticked index box is the false claim.

**Bound on the claim:** of 78 index criteria, only two are not met in code. This task is about the **surface**, not the work beneath it. That bound comes from the audit's own completion table, which the QA pass did **not** re-check — so treat it as single-sourced and re-derive it if a decision turns on it.

**W-50 — an orchestrator task file invisible from its own index.** `P0-foundations/09-audit-remediation.md` is the only phase file with orchestrator frontmatter, **no `Status` line**, `## Acceptance criteria` instead of exit criteria, and no entry in its index — whose task table and sequence diagram both end at P0.08. Verified as a class in both directions: exactly one such file. It is entangled with W-42 because a reader counting open checkboxes sees six unclosed P0 criteria, one of which asserts responsibility for verifying every other P0 criterion.

## Deliverables / steps

1. **Decide first, edit second.** Are per-task checkboxes load-bearing? If they are not, **delete them** rather than shipping 92 that read as open work. If they are, name who ticks them and when — and note that P13–P16 already answer that question in practice: the author ticks them in the landing change. Ticking the 92 without a written decision recreates the problem next phase, which is the whole finding; and the decision has to cover this phase's own six task files, or the round that fixed this leaves the newest instance of it behind.
2. **Flip the Status lines and criteria** of every remaining index whose task files are all Done — P10, P11 and P12, plus P9 once its eighth task is disposed of — and fix the glossary's surviving **Phase** roll-up in the same change. P13–P16 were reconciled ahead of this task; verify rather than redo them. `P-release` stays open and is the honest row.
3. **Dispose of the unverifiable parity criterion explicitly:** retire it at both sites (the migration it guarded is three phases behind and its subject no longer exists), **or** keep the text and give it a row in [`accepted-behaviors.md`](../accepted-behaviors.md) recording that it is closed-by-obsolescence rather than verified. Do not leave it as a ticked box with nothing behind it — that is the exact failure this task exists to end.
4. **Fix the pack-clean pair.** `P0-foundations/index.md:43` ticked versus `P-release/index.md:39` open is the second instance of a criterion ticked at one level and open at another. Its substance was settled by [P16.03](../P16-release-readiness/03-published-payload.md) — pack-clean per package is now checked by both `release:check` and CI — so what remains is to make the two boxes say the same thing: the `P-release` row should be about the part still open (the end-to-end smoke), not re-assert a check that already runs.
5. **W-50:** either list `09-audit-remediation.md` in its index with a `Status` line and matching heading structure, or move it out of the phase directory. If it stays, its six criteria join the count this task is reconciling.
6. **Prefer a mechanism over a sweep, if one is cheap.** The finding is that nothing maintains this surface. A check that compares each index's Status against the task files beneath it would convert this from a one-time cleanup into a gate — the same move [P17.02](02-self-linting-config.md) makes for links. Worth considering; not worth blocking this task on.

## Out of scope

Verifying the 92 task-level criteria individually. They were counted, not traced — four files were sampled and one criterion followed to a test — so this task establishes that the **surface** is unreliable, **not** that the work beneath it is incomplete. Claiming otherwise in either direction would be the same error in a new place.

## Exit criteria

- [x] The per-task-checkbox question is **decided**, with the decision written down, before any box is edited, and the decision explicitly covers this phase's own task files.
- [x] No phase index reads `Not started` above task files that are all Done — P10, P11, P12 and P9, with P13–P16 verified as already reconciled.
- [x] The glossary's surviving **Phase** roll-up agrees with the indexes.
- [x] The permanently unverifiable P0 parity criterion is retired at both sites or registered as closed-by-obsolescence.
- [x] No criterion remains ticked at index level and open at task level for the same subject.
- [x] `09-audit-remediation.md` is listed in its index with a `Status` line, or moved out of the phase directory.
- [x] `npm run format` green.

## Implementation notes

**The decision is [`completion-surface.md`](../completion-surface.md), written before any box was edited.** Per-task checkboxes are load-bearing and stay; the author of the landing change ticks the task's criteria, and the author of the change landing a phase's _last_ task also sets the index `Status` and ticks the index criteria. The evidence is one-sided: unchecked task-level boxes existed in **P0–P3 only**, and every task file from P4 onward ticked its own at landing — fifteen phases of practice, not just the four the problem statement cites. So the convention already worked everywhere it was practiced, and the level that failed was the index, which had no owner. The rule is mirrored as a bullet in [`AGENTS.md`](../../../AGENTS.md)'s Repository Hygiene section, because a rule only agents' own instruction files carry is a rule agents read — leaving it solely in `docs/` would have reproduced this finding's own shape.

**Index `Status` gains a third value, `In progress`.** The two-value vocabulary had no honest word for "four of six tasks are done", which is a large part of why `Not started` sat above finished work for four phases. The three values are now derived from the task files beneath the index, not asserted independently.

**Disposition of the 91 historical boxes: strip the markup, do not tick.** `- [ ] X` became `- X` across 29 `Status **Done**` task files in P0–P3, plus one line in [P11.12](../P11-remediation/12-str001-reach.md) that was already struck through as not-applicable. Ticking would assert 91 verifications this task is explicitly forbidden to perform; leaving them leaves four finished phases reading as unverified. Stripping keeps the text as the record of the bar the task was written against and drops only the claim to be a live tracking box — and it is what makes the invariant _no `Done` file carries an open checkbox_ true of the whole tree, and therefore enforceable. Each stripped file carries one line under its `## Exit criteria` heading saying so. The known cost is that P0–P3 now read differently from P4 onward.

**Retired rather than registered, for the parity criterion.** The exit criterion offered both. [`accepted-behaviors.md`](../accepted-behaviors.md) indexes _product_ behaviors a task documented instead of fixing, each pointing at where a user or maintainer can read about it; a planning checkbox whose subject was deleted three phases ago is not one, and giving it a row would make that register a second home for plan bookkeeping — the opposite of the single-index discipline it was established with.

### Contradictions surfaced against the task file

Three, per the precedence rule that a contradiction changing behavior is surfaced rather than guessed:

1. **The parity criterion has three phase-/verification-level sites, not two — and a fourth at delivery-criterion level.** Deliverable 3 and its exit criterion both say "both sites" — [`P0-foundations/index.md`](../P0-foundations/index.md) (`[x]`) and [`P0.08`](../P0-foundations/08-exit-verification.md) (`[ ]`). The sixth acceptance criterion of [`P0.09`](../P0-foundations/09-audit-remediation.md), the W-50 file, is "`scan`/`graph` output parity with the pre-migration implementation is re-confirmed" — a third live instance, inside the very file the other half of this task is about. All three are retired. [`P0.05`](../P0-foundations/05-cli-package-commander.md) states the same check too, but as a delivery criterion rather than a phase- or verification-level one, so it is stripped with the rest of P0–P3 instead of retired individually — the strip already removes the false signal a live checkbox would carry.
2. **P9.08 needed no new disposition.** Deliverable 2 says to flip P9 "once its eighth task is disposed of". It already was: [P9.08](../P9-remediation/08-idref-prose-scan.md) has read `Status **Deferred to backlog (2026-07-25)**` with a dated note and a ticked "Or: explicitly deferred" box since that date. What was missing was the **index** recording it, which is this task's own class of defect rather than an open decision.
3. **The 78-criteria bound re-derives in scope, but its claim does not, so nothing here leans on it.** Index criteria totalled 132 going into this change and 131 coming out of it, the parity line having been retired; restricted to the phases that existed when the audit ran (the P0–P12 indexes, 72, plus `P-release`, 6) it is exactly **78**, so the count is sound. "Only two are not met in code" cannot survive `P-release`'s six rows, though — the single-tag release, the Action, the README's generated MCP tool list and M4 are all genuinely unshipped. The 27 P9–P12 rows were therefore verified individually against the ticked task-level criteria beneath them, per the table below, rather than by inheriting that bound.

### The 27 index criteria, mapped to the ticked task criteria that own them

No row was ticked without a mapping. Every task-level criterion cited below was already `[x]` before this change.

| Index criterion | Owned by |
| --- | --- |
| P9 — multi-line `@import` line/column | [P9.01](../P9-remediation/01-import-positions.md) 1–2 (per-import position + a test that fails on the old code) |
| P9 — deterministic load order | [P9.02](../P9-remediation/02-deterministic-sort.md) 1–2 (no `localeCompare` on output paths + a non-ASCII ordering test) |
| P9 — Windows/macOS CI | [P9.03](../P9-remediation/03-cross-os-ci.md) 1–2 (full gate on `windows-latest`; POSIX normalization asserted there) |
| P9 — honest MCP tool descriptions | [P9.04](../P9-remediation/04-mcp-lint-description.md) 1–2 (`lint` corrected; all six verified) |
| P9 — `custom` `target` consistency | [P9.05](../P9-remediation/05-custom-heading-target.md) 1–2 (requirements/glossary/schema/primitives agree; schema regenerated) |
| P9 — format gate green and enforced | [P9.06](../P9-remediation/06-format-gate.md) 1–2 (exits `0` on a clean checkout; CI enforces it) |
| P9 — `init` CI package manager | [P9.07](../P9-remediation/07-init-ci-package-manager.md) 1–2 (behavior chosen and pinned by a test) |
| P10 — post-P3.09 governance docs | [P10.01](../P10-consistency/01-governance-docs.md) 1–3 (no phantom root `src/`; typo; layout wording) |
| P10 — glossary shows P6–P8 shipped | [P10.02](../P10-consistency/02-glossary-status.md) 1–2 |
| P10 — no stale source comments | [P10.03](../P10-consistency/03-stale-comments.md) 1–2 (`CHK-*`; the "P2 wires" future tense) |
| P10 — registry inventory guard | [P10.04](../P10-consistency/04-registry-inventory-guard.md) 1–2 (24 IDs / 8 categories asserted in code) |
| P10 — parser and per-rule test depth | [P10.05](../P10-consistency/05-test-depth.md) 1–2 |
| P10 — requirement texts agree with code | [P10.06](../P10-consistency/06-requirement-reconciliation.md) 1–3 (R7, the M1 table, P5.04's schema location) |
| P10 — accepted behaviors documented | [P10.08](../P10-consistency/08-accepted-behaviors.md) 1–2 (dangling links; the `compatibility` follow-up tracked against the release phase) |
| P11 — installed bin runs, correct exit codes | [P11.01](../P11-remediation/01-cli-bin-noop.md) 1–2, 5 (symlink/junction spawn, real `npx` on POSIX, guard fails on regression) |
| P11 — no filesystem read outside the root | [P11.02](../P11-remediation/02-sec003-path-escape.md) 1–2, 4–5 (both escape forms, the sweep, the MCP description) |
| P11 — `init` never clobbers config or schema | [P11.03](../P11-remediation/03-init-schema-clobber.md) 1–2 and [P11.04](../P11-remediation/04-findconfig-boundary.md) 2–4 (nested project, honest prompt path, explicit `[path]` honored) |
| P11 — no crash, no false `error` finding | [P11.06](../P11-remediation/06-regex-substitution-safety.md) 1, [P11.07](../P11-remediation/07-custom-missing-id.md) 1, [P11.05](../P11-remediation/05-table-primitive-scope.md) 1–2 (`exclude` honored; `g`/`y` order-independent) |
| P11 — exit-code contract and routing | [P11.10](../P11-remediation/10-cli-exit-contract.md) 1–4 |
| P11 — atomic, newline-safe writes | [P11.09](../P11-remediation/09-atomic-writes.md) 1–3 |
| P11 — `STR-001` reach; duplicates/no-ops closed | [P11.12](../P11-remediation/12-str001-reach.md) 1–2, [P11.11](../P11-remediation/11-llm-dedup.md) 1, [P11.13](../P11-remediation/13-grp-size-hygiene.md) 1–2 |
| P12 — end-to-end `exclude` coverage | [P12.01](../P12-consistency/01-exclude-coverage.md) 1–2 (including the `exclude`-only case; fails against pre-P11.05) |
| P12 — glossary `custom.target` optional | [P12.02](../P12-consistency/02-glossary-custom-target.md) 1–2 |
| P12 — quadratic hot paths | [P12.03](../P12-consistency/03-quadratic-hotpaths.md) 1–2 |
| P12 — MCP `lint` custom-rule boundary | [P12.04](../P12-consistency/04-mcp-custom-rules.md) 1–2 |
| P12 — recursive-DFS bound | [P12.05](../P12-consistency/05-recursion-depth.md) 1 (documented at each site; its second criterion is marked N/A because the guard path was not the direction chosen) |
| P12 — process-boundary checklist and format gate | [P12.06](../P12-consistency/06-process-boundary-tests.md) 1–3 |

Two observations from building it, recorded because they are the kind of thing a later reader would otherwise re-derive: **P10.07** (frontmatter import direction) and **P11.08** / **P11.14** (`init` `exclude` anchoring, `init`/CLI micro-fixes) have no dedicated index criterion of their own — they were folded into sibling rows or into the phase goal. That is a scoping choice made when those indexes were written, not drift, and it is why the mapping is 27 rows over 36 task files rather than one row per file.

**P13–P16 verified, not redone.** Their four indexes already read `Status **Done**` with 11/10/11/11 criteria ticked and zero open boxes across all 19 task files. Nothing in those directories was touched.

### The pack-clean pair

`P0-foundations/index.md`'s "CI runs the workspace matrix on Node 24; `npm pack --dry-run` is clean per package" is ticked and true: [P16.03](../P16-release-readiness/03-published-payload.md) put `npm pack --dry-run --workspaces` at the end of `release:check`, and `ci.yml`'s `pack` job matrixes `npm pack --dry-run -w <package>` over all three packages. The same subject was open at three release-phase sites, so all three now say what is actually left rather than re-asserting a check that already runs: [`P-release/index.md`](../P-release/index.md) is narrowed to the end-to-end CLI + MCP + skill smoke, and [`PR.01`](../P-release/01-package-metadata.md) and [`PR.05`](../P-release/05-release-verification.md) annotate their pack halves using the "delivered by P16.03 … measured by running the gate rather than re-tracked here" pattern those files already used for the two P16.02/P16.03 criteria above them.

**The no-conflict claim, derived rather than asserted.** After this change, no criterion is ticked at index level and open at task level for the same subject anywhere in the tree, and the reasoning is exhaustive rather than sampled: P0–P3 task files now carry no boxes at all, so no pair can form; P4–P8 and P10–P16 have zero open boxes at either level; P9's seven index criteria are ticked and its only open boxes are P9.08's, whose subject (id-ref edges from code fences) appears in none of them; P17's remaining open index rows belong to P17.05 and P17.06, which are `Not started` with their own criteria open; and the release phase is open at both levels except for the pack-clean subject just reconciled.

### W-50 — the orchestrator file

Moving it out was the other sanctioned option and was **not available**: the only plausible destination is `tasks/`, which is gitignored and outside what this work may touch. So [`P0.09`](../P0-foundations/09-audit-remediation.md) is normalized in place — the YAML front matter's `id`/`depends_on` folded into the standard header line with `Size **M** · Status **Done**`, one sentence recording that it ran as an orchestrator task and that this is why it looked different, `## Acceptance criteria` renamed to `## Exit criteria`, its content re-homed under the `## Goal` / `## Sequence` / `## Deliverables / steps` headings its eight siblings use (no prose rewritten, only moved), five criteria stripped and the sixth retired. It now has a row in the P0 task table and a node in the sequence diagram, which both previously stopped at P0.08.

### The mechanism

`packages/core/test/plan-completion-surface.test.ts` reads every phase index and its task files, parses the `Status **…**` header and line-anchored checkboxes, and asserts both halves of the rule: each index's `Status` equals the state derived from the task files beneath it, and no `Done` file carries an open box. It also asserts that every plan file declares a status at all — the W-50 shape, where a file authored by a different path is invisible to the derivation and would silently hold its phase at `In progress` forever — and that the tree it found is large enough for those assertions to mean something, since a renamed directory would otherwise make all three vacuously green. The derivation is additionally exercised on synthetic status sets, because today the tree has exactly one `In progress` phase and one `Deferred` file, and landing P17 would take the first of those cases with it.

No new dependency, no CI change, and nothing under `packages/*/src`: it runs in `npm test` as tooling. Not tagged `@boundary-guard` — that inventory is a paired set whose category list belongs to a task that owns it, and planning-document consistency is not one of its five categories.

Run against the tree with only P17's own index left unflipped, it failed on exactly that one entry and nothing else, which is the evidence that steps 1–5 were complete before step 7 closed them out.

### Counts

Re-derived over `^- \[ \]` / `^- \[x\]` (line-anchored, so the inline `` `[ ]` `` spans in prose are excluded). Before: **181 unchecked / 454 checked**, 635 total — the task file's 206/429 with 25 boxes flipped by P17.01–P17.03 landing since it was written. Its 150-outside-P13–P17 figure and its "92 boxes across 30 files" both re-derive exactly; the 92 is 91 boxes in P0–P3 task files plus the one struck-through line in P11.12, and P0.09's six are **not** among them because it had no `Status` line to be counted by.

After: **47 unchecked / 489 checked**, 536 total. Ninety-nine boxes left the tree — 90 stripped from P0–P3 (91 less the parity line, retired instead), 6 from P0.09 (5 stripped, 1 retired), 1 from P11.12, and 2 more parity lines at the P0 index and P0.08. Thirty-six were ticked: the 27 index criteria above, this file's 7, and 2 rows in the P17 index. The 47 that remain are the honest ones — 23 in the release phase, 22 in P17 for the two tasks still open, and P9.08's 2.
