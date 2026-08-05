# P17.03 · The enforced ADR and the dependency register

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**. Backlog: [W-41](../remediation-backlog-2026-08-05.md) (High), [W-47](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F32 (MEDIUM), F39 (MED-LOW). **Do this first in P17** — the QA pass's one ranking change, on the grounds that this is the finding that will actively make the next contributor write wrong code. Depends on [P16](../P16-release-readiness/index.md). Blocks [P17.04](04-completion-surface.md).

## Goal

Make the two documents a contributor is told to obey — the one enforced architecture decision and the cross-phase dependency register — describe the code that shipped. These are precedence tiers, not guide pages: a reviewer citing them today would block correct work.

## Problem

**W-41 — the one "Accepted (enforced)" architecture decision contradicts the code twice.**

1. **It names three core APIs that do not exist.** `loadConfig` and two formatter functions — verified by grep, **zero** occurrences across all three packages' `src`. The real exports are `formatLintResultText`, `formatLintResultJson`, and `loadConfiguration`, which [`glossary.md`](../glossary.md) names correctly.
2. **It prohibits the pipeline that shipped.** The ADR states that "`lintFiles` is intentionally **synchronous** (`globSync` + `readFileSync`) … Do not introduce an async variant". The shipped `lintFiles` returns a `Promise`, the corpus loader is built on `node:fs/promises`, `loadConfiguration` is async, and `globSync` appears **nowhere** in core. [`glossary.md`](../glossary.md) `:68` restates the prohibition verbatim and links back to the decision as its authority — so the wrong claim has two mutually-reinforcing homes.

**What must not be swept with it.** Rules themselves **are** synchronous — `check(context): void` — and two shipped behaviors depend on that: `STR-001`'s corpus-only glob satisfaction (recorded as accepted for this reason) and the primitives' purity requirement. The false claim is about the **pipeline entry point**, not about rule execution. A correction that deletes the synchronicity clause wholesale would remove a real constraint.

**Why it is ranked first:** a tier-3 enforced decision is what a reviewer cites to block a change. Today it would block an async change that is already the shipped design — the audit calls it "the most dangerous of the paper findings" for exactly that reason.

**W-47 — two dependency-register entries claim more than shipped.**

- **Entry 4.2** fixes the deterministic-fixable subset as `SEC-*` plus `TBL-002`. `SEC-*` is three rules; only `SEC-001` is fixable. Verified: `fixable: true` appears on `sec.ts:32` (SEC-001) and `tbl.ts:136` (TBL-002) and nowhere else, with SEC-002 and SEC-003 explicitly `fixable: false` — and the code states the true count in place at `tbl.ts:160`: "those two are the only `fixable: true` rules".
- **Entry 4.3** asserts that `query`, `getImpactSet`, and `classifyImpact` are "reused directly by P7.03". **One of the three is.** Verified: `classifyImpact` is called by both hosts; `query` has no host caller; `getImpactSet` has no caller anywhere outside its own unit test.

**Why it matters:** 4.2 is the entry a `--fix` change is measured against, so a contributor would expect SEC-002 to be fixable, or would "restore" fixability the code deliberately withheld with a reason written next to it. And 4.3 is what lifts `getImpactSet` out of [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)'s judgment call and into a documented expectation the code does not meet.

## Deliverables / steps

1. **W-41:** correct the three API names to `loadConfiguration`, `formatLintResultText`, `formatLintResultJson`.
2. **W-41:** replace the synchronicity clause with the **real** constraint — rules and primitives are synchronous; pipeline entry points are async — rather than deleting it. A tier-1 task file and a code comment already say the right thing; reuse their wording so three documents agree instead of two.
3. **W-41:** fix [`glossary.md`](../glossary.md) `:68` in the **same change**. It cites the ADR as its authority, so correcting one and not the other leaves a document quoting a claim its source no longer makes.
4. **W-47:** narrow 4.2 to `SEC-001` + `TBL-002`, and 4.3 to `classifyImpact`, per that log's own honesty rule ("update the entry here and the canonical task file together").
5. **W-47 — or take the other direction deliberately.** If the intent was that all three query APIs become host-facing, record `query` and `getImpactSet` as intended library surface instead, and close them with [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)'s W-40 decision rather than in two places. Whichever direction is taken, P16.05 must not decide it again.
6. **Check the neighbours while there.** 4.1 and 4.4 were traced and **hold**, so the register is not wholesale unreliable — say that, so a reader does not over-correct. The audit also notes that roughly 20 of the log's 29 numbered entries are **unexamined**, and that a 2-of-9 hit rate came out of the sample; sweeping the rest is out of scope here but worth recording as the largest un-swept surface the assessment leaves behind.

## Out of scope

Auditing the remaining ~20 decision-log entries. It is the most likely place for another finding of this shape, and it deserves its own task rather than a widened one — record it, do not attempt it here.

## Exit criteria

- [ ] The ADR names only APIs that exist, verified by grep.
- [ ] Its synchronicity clause states the real constraint (rules/primitives sync, pipeline entry points async) rather than being deleted.
- [ ] `glossary.md:68` is corrected in the same change and no longer prohibits the shipped design.
- [ ] A reviewer citing the ADR would not block an async change to a pipeline entry point.
- [ ] Decision 4.2 names `SEC-001` + `TBL-002`; 4.3 names `classifyImpact` — or the two unconsumed exports are recorded as intended surface, once.
- [ ] The change states that 4.1 and 4.4 hold, and records the ~20 unexamined entries as remaining work.
- [ ] `npm run format` green.
