# P18.07 — Trace the remaining dependency-register entries

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.
>
> Spun out of [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md), which named this the largest un-swept surface it left behind and put it explicitly out of its own scope.

## Problem

`docs/mdlint_v2/decisions/pre-implementation-decisions.md` carries 29 numbered register entries. [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) traced **nine** of them against current source and found **two** wrong — entries 4.2 and 4.3. Twenty entries have never been checked against the code they describe.

Two things make the remaining twenty worth a task rather than a note. A 2-of-9 hit rate is not a rate that decays on its own: the entries were written before implementation, and every one of them describes a dependency the code has since either honored, replaced, or dropped. And this document sits in a **precedence tier** contributors are told to obey, so a wrong entry does not merely confuse a reader — it makes a future change wrong in the direction the register points.

The method is already established by the nine: grep the named symbol, package or version constraint against the current tree, and record for each entry whether it holds, holds with a qualifier, or is false — with the file and line that decides it.

## Deliverables / steps

- [ ] Enumerate the 29 entries and mark the nine [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) already traced, so the audit's scope is the complement and is visible as such.
- [ ] For each remaining entry, grep the symbol, package or constraint it names against the current tree and record the deciding file and line.
- [ ] Classify each as **holds**, **holds with a qualifier**, or **false**, and correct the false ones in place with the same in-place-correction style [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) used, rather than rewriting the register wholesale.
- [ ] Where an entry describes a dependency that no longer exists at all, say what replaced it rather than deleting the entry — the register is a record of decisions, and a decision that was reversed is still a decision.
- [ ] Record the hit rate over the full 29 in the implementation notes, so the next reader knows whether this surface is now trustworthy or merely swept once.

## Exit criteria

- [ ] Every one of the 29 entries has been traced against current source, and the notes name which pass did it.
- [ ] No entry states a dependency, symbol or version the tree contradicts.
- [ ] Each corrected entry names the file and line that decided it, so a future reader can re-check without repeating the grep.
