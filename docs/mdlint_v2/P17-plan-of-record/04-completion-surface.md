# P17.04 · The completion surface

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-42](../remediation-backlog-2026-08-05.md) (High), [W-50](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F2 (HIGH; **count corrected** by the QA pass to 30 files / 92 boxes; its HIGH grade was disputed there and the dispute was declined — see the backlog's Corrections table), F33 (LOW). Depends on [P17.03](03-adr-and-dependency-register.md). Blocks [P17.06](06-register-and-roadmap.md).

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

- [ ] The per-task-checkbox question is **decided**, with the decision written down, before any box is edited, and the decision explicitly covers this phase's own task files.
- [ ] No phase index reads `Not started` above task files that are all Done — P10, P11, P12 and P9, with P13–P16 verified as already reconciled.
- [ ] The glossary's surviving **Phase** roll-up agrees with the indexes.
- [ ] The permanently unverifiable P0 parity criterion is retired at both sites or registered as closed-by-obsolescence.
- [ ] No criterion remains ticked at index level and open at task level for the same subject.
- [ ] `09-audit-remediation.md` is listed in its index with a `Status` line, or moved out of the phase directory.
- [ ] `npm run format` green.
