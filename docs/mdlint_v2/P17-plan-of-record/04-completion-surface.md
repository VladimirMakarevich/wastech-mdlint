# P17.04 · The completion surface

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-42](../remediation-backlog-2026-08-05.md) (High), [W-50](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F2 (HIGH; **count corrected** by the QA pass to 30 files / 92 boxes; its HIGH grade was disputed there and the dispute was declined — see the backlog's Corrections table), F33 (LOW). Depends on [P17.03](03-adr-and-dependency-register.md). Blocks [P17.06](06-register-and-roadmap.md).

## Goal

Make the plan's completion state readable in both directions — and **decide** whether per-task checkboxes are load-bearing at all, rather than ticking 92 of them and recreating the problem next phase.

## Problem

**W-42 — no reliable completion surface, in either direction.** Counted over the plan files (148 unchecked / 255 checked boxes total, re-verified in the current tree):

- **92 exit criteria across 30 `Status **Done**` task files are unchecked** while their phase indexes are fully ticked. Two of those boxes are self-referential audits of exactly this.
- **33 phase-index criteria are unchecked across five phases**, four of which read `Status **Not started**` while every task file beneath them reads Done: P9 (7 of 8 done), P10 (8 of 8), P11 (14 of 14), P12 (6 of 6), and `P-release` (0 of 5 — the one honest row). The glossary repeats the stale state at `:12` and `:248`.

**Delivery-history evidence:** `git show 827bce8` shows the merge that landed P11 and P12 **rewriting** the Status line and all seven criteria lines of those indexes — reflowed for the prose-wrap setting — and preserving `Not started` and every empty box verbatim. So this is not neglect; it is a surface nothing maintains.

**Demonstrated harm:** under the stated precedence a reader concludes P0–P3 is unverified and P9–P12 is not done — the exact inverse of the indexes. It has already produced a wrong belief about a release gate: the pack-clean criterion is ticked at `P0-foundations/index.md:43` and open at `P-release/index.md:39`, and `release:check` validates none of it ([P16.03](../P16-release-readiness/03-published-payload.md)).

**One of the 92 boxes cannot honestly be ticked, and a sweep would tick it.** `P0-foundations/index.md:41` claims `[x]` that `scan` and `graph` "produce the same output as before the migration (parity check)"; the same criterion is `[ ]` at `P0-foundations/08-exit-verification.md:34`; and the reference implementation it compares against was **removed at the P3.09 cutover**, with no test standing in for it. The criterion is **permanently unverifiable**, so ticking the task-level box would assert a check nobody can perform — and the already-ticked index box is the false claim.

**Bound on the claim:** of 78 index criteria, only two are not met in code. This task is about the **surface**, not the work beneath it. That bound comes from the audit's own completion table, which the QA pass did **not** re-check — so treat it as single-sourced and re-derive it if a decision turns on it.

**W-50 — an orchestrator task file invisible from its own index.** `P0-foundations/09-audit-remediation.md` is the only phase file with orchestrator frontmatter, **no `Status` line**, `## Acceptance criteria` instead of exit criteria, and no entry in its index — whose task table and sequence diagram both end at P0.08. Verified as a class in both directions: exactly one such file. It is entangled with W-42 because a reader counting open checkboxes sees six unclosed P0 criteria, one of which asserts responsibility for verifying every other P0 criterion.

## Deliverables / steps

1. **Decide first, edit second.** Are per-task checkboxes load-bearing? If they are not, **delete them** rather than shipping 92 that read as open work. If they are, name who ticks them and when. Ticking them without that decision recreates the problem next phase — which is the whole finding.
2. **Flip the five indexes' Status lines and criteria** to match the work beneath them, and fix the two glossary roll-ups at `:12` and `:248` in the same change.
3. **Dispose of the unverifiable parity criterion explicitly:** retire it at both sites (the migration it guarded is three phases behind and its subject no longer exists), **or** keep the text and give it a row in [`accepted-behaviors.md`](../accepted-behaviors.md) recording that it is closed-by-obsolescence rather than verified. Do not leave it as a ticked box with nothing behind it — that is the exact failure this task exists to end.
4. **Fix the pack-clean pair.** `P0-foundations/index.md:43` ticked versus `P-release/index.md:39` open is the second instance of a criterion ticked at one level and open at another. Its substance belongs to [P16.03](../P16-release-readiness/03-published-payload.md); the **surface** belongs here, so reconcile the two boxes once that task has settled what is actually true.
5. **W-50:** either list `09-audit-remediation.md` in its index with a `Status` line and matching heading structure, or move it out of the phase directory. If it stays, its six criteria join the count this task is reconciling.
6. **Prefer a mechanism over a sweep, if one is cheap.** The finding is that nothing maintains this surface. A check that compares each index's Status against the task files beneath it would convert this from a one-time cleanup into a gate — the same move [P17.02](02-self-linting-config.md) makes for links. Worth considering; not worth blocking this task on.

## Out of scope

Verifying the 92 task-level criteria individually. They were counted, not traced — four files were sampled and one criterion followed to a test — so this task establishes that the **surface** is unreliable, **not** that the work beneath it is incomplete. Claiming otherwise in either direction would be the same error in a new place.

## Exit criteria

- [ ] The per-task-checkbox question is **decided**, with the decision written down, before any box is edited.
- [ ] No phase index reads `Not started` above task files that are all Done.
- [ ] The glossary's two phase-status roll-ups agree with the indexes.
- [ ] The permanently unverifiable P0 parity criterion is retired at both sites or registered as closed-by-obsolescence.
- [ ] No criterion remains ticked at index level and open at task level for the same subject.
- [ ] `09-audit-remediation.md` is listed in its index with a `Status` line, or moved out of the phase directory.
- [ ] `npm run format` green.
