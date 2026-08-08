# Completion surface

> Roadmap: [v2 Index](index.md) · Reference (not a precedence tier) · Decided by [P17.04](P17-plan-of-record/04-completion-surface.md).

The plan of record answers "is this done?" in two places — a phase index's `Status` line and its exit-criteria boxes, and the exit-criteria boxes inside each task file beneath it. For most of this project's life those two answers disagreed, in both directions: four phase indexes read `Not started` above task files that were all `Done`, while 91 boxes in four finished phases read as open work. A reader obeying the stated precedence — the task file wins over the index — concluded that P0–P3 was unverified and that P9–P12 had not started.

This document is the decision that ends that, and the rule the surface is maintained by from here on.

## The rule

**Per-task exit-criteria checkboxes are load-bearing and stay.** They are ticked by the author of the change that lands the work, never by a later sweep:

- **Task file.** The change that lands a task ticks that task's exit criteria in the same change. Nobody else is in a position to: the author is the only person who has just run the checks.
- **Phase index.** The change that lands a phase's **last** task sets the index `Status` and ticks the index criteria in the same change. This is the half that drifted, and it drifted because it was the half with no owner — the last task's author is the nearest thing to one.
- **A criterion nobody can perform is retired in place.** The box is removed, the text is kept, and the line states why the check is impossible. It is never ticked, and it is never left open either: an open box that nobody can ever close is indistinguishable from work someone still owes.
- **A criterion a task decides not to meet is disposed of visibly** — struck through with the reason on the line, or carried by the task's own `Status` (`Deferred …`). What is not acceptable is leaving it silent.

The invariant those add up to, and the one a test can check: **no file whose `Status` is `Done` carries an open checkbox** — index or task file alike.

**This applies to P17's own six task files first, not only to the history it is cleaning up.** A round that reconciled fourteen phases and left its own behind would be the newest instance of the finding it closed. [P17.01](P17-plan-of-record/01-dead-links.md), [P17.02](P17-plan-of-record/02-self-linting-config.md) and [P17.03](P17-plan-of-record/03-adr-and-dependency-register.md) each ticked their criteria as they landed; [P17.04](P17-plan-of-record/04-completion-surface.md) ticks its own in the change that writes this document; [P17.05](P17-plan-of-record/05-p-release-rename-sweep.md) and [P17.06](P17-plan-of-record/06-register-and-roadmap.md) are open and their index reads `In progress`, which is the state this vocabulary was extended to be able to say. Whoever lands the last of the two sets the index to `Done` and ticks its criteria in that change.

## Index status vocabulary

A phase index `Status` is **derived from the task files beneath it**, not asserted independently:

| `Status` | Derived from |
| --- | --- |
| `Not started` | No task file in the phase is `Done` or explicitly disposed of. |
| `In progress` | Some task files are, but not all. |
| `Done` | Every task file in the phase is `Done`, or explicitly disposed of with a `Deferred …` status. |

`In progress` is new here. The vocabulary had only two values, and neither of them is a true description of "four of six tasks have landed" — which is why `Not started` sat above finished work rather than anything more honest. A phase index is allowed to carry open boxes exactly while it is `Not started` or `In progress`.

A task file explicitly disposed of counts toward `Done` because the disposition **is** the outcome: [P9.08](P9-remediation/08-idref-prose-scan.md) is a stretch item whose own exit criteria admit deferral as an acceptable result, it carries a dated deferral note, and the P9 phase criteria never included it. Its two remaining open boxes are honest — they describe work that would close it if the gate it waits on ever lifts.

## Why this, and not the alternatives

The evidence is not evenly distributed, and it settles the question rather than leaving it to taste:

- **Every task file from P4 onward ticked its own criteria at landing** — fifteen phases of unbroken practice, including the four most recent, where 19 task files landed with zero open boxes between them. The convention already exists; it was simply never written down.
- **Every phase index drifted anyway.** The merge that landed P11 and P12 rewrote the `Status` line and all seven criteria lines of both indexes, reflowing them for the prose-wrap setting, and preserved `Not started` and every empty box verbatim. That is not neglect — it is a surface nobody was responsible for, being carried along by a formatting pass.

So the failure is at the index, and the fix is to give the index an owner rather than to abolish a convention that holds everywhere it is practiced. Deleting per-task checkboxes wholesale would discard the one part of the surface that works.

## The P0–P3 exit criteria are records, not checklists

Ninety-one boxes across 29 `Status **Done**` task files in P0, P1, P2 and P3 were never ticked, because the tick-at-landing convention did not exist yet. **Their markup is stripped — `- [ ] X` becomes `- X` — and they are not ticked.**

Ticking them would assert a verification nobody performed: those criteria were counted, not traced, and the task that reconciled this surface was explicitly scoped to the surface rather than to the work beneath it. Claiming 91 verifications on that basis is the same class of false completion signal this document exists to end, only pointed the other way. Leaving them open leaves the harm: four finished phases reading as unverified. Stripping is the third option and the only honest one — the line still records the bar the task was written against, and stops claiming to be a live tracking box.

What is lost is uniformity: P0–P3 read differently from P4 onward, and each stripped file says so in one line under its `## Exit criteria` heading. What is gained is that the invariant above becomes true of the whole tree at once, and therefore enforceable.

Phase completion for P0–P3 is carried by the phase indexes, which were ticked at the time and which — with one retired criterion, below — hold.

## Retired criteria

A criterion is retired when its subject no longer exists, so the check can never be run again by anyone. The line keeps its text, loses its box, and gains the reason in place. One criterion is retired today:

**`scan`/`graph` output parity with the pre-migration implementation.** P0 relocated a single-package codebase into `packages/core` without changing its behavior, and this criterion was how that was to be proved. The reference implementation it compares against was removed at the P3.09 cutover, and no test stands in for it — so there is nothing left to diff against and no way to produce one. It appeared at three sites that stated it as a phase- or verification-level criterion, all now retired: [`P0-foundations/index.md`](P0-foundations/index.md), [`P0.08`](P0-foundations/08-exit-verification.md), and [`P0.09`](P0-foundations/09-audit-remediation.md). The index site was the more damaging of the three, because it was **ticked** — asserting a completed check that, by the time anyone read it, could not have been performed. [`P0.05`](P0-foundations/05-cli-package-commander.md) states the same check as a delivery criterion rather than a phase- or verification-level one; it is stripped with the rest of P0–P3 rather than retired individually, since stripping already removes the false signal a live checkbox would carry.

It is retired rather than added to the [accepted-behaviors register](accepted-behaviors.md): that register indexes product behaviors a task chose to document instead of fixing, each pointing at where a user or maintainer can read about it. A planning checkbox whose subject was deleted is not a product behavior, and giving it a row would make the register a second home for plan bookkeeping.

## Where open boxes are still correct

Two places in the tree carry open checkboxes on purpose, and a green run of the enforcing test depends on them staying legible as such:

- **[`P-release`](P-release/index.md)** and its five task files. Nothing there has shipped; `Status **Not started**` and six open index criteria are the accurate reading.
- **[P9.08](P9-remediation/08-idref-prose-scan.md)**, deferred with a dated note, as described above.

An open box is not a defect. A `Done` file carrying one is.

## Enforcement

`packages/core/test/plan-completion-surface.test.ts` reads every phase index and its task files and asserts both halves of the rule: that each index's `Status` equals the state derived from the task files beneath it, and that no `Done` file carries an open checkbox. It runs in the ordinary `npm test` gate.

That converts this from a cleanup into a gate — the same move the repository's own [self-linting configuration](P17-plan-of-record/02-self-linting-config.md) makes for dead links. What it cannot check is whether a criterion is _true_; it checks only that the surface is internally consistent, which is precisely the property that was missing.
