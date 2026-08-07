# P17.03 · The enforced ADR and the dependency register

> Phase: [P17 — Plan of record](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**. Backlog: [W-41](../remediation-backlog-2026-08-05.md) (High), [W-47](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F32 (MEDIUM), F39 (MED-LOW). **Do this first in P17** — the QA pass's one ranking change, on the grounds that this is the finding that will actively make the next contributor write wrong code. Depends on [P16](../P16-release-readiness/index.md). Blocks [P17.04](04-completion-surface.md).

## Goal

Make the two documents a contributor is told to obey — the one enforced architecture decision and the cross-phase dependency register — describe the code that shipped. These are precedence tiers, not guide pages: a reviewer citing them today would block correct work.

## Problem

**W-41 — the one "Accepted (enforced)" architecture decision contradicts the code twice.**

1. **It names three core APIs that do not exist.** `loadConfig` and two formatter functions (`formatFileResults`, `formatContentResults`) — re-verified after P13–P16: still **zero** occurrences across all three packages' `src`. The real exports are `formatLintResultText`, `formatLintResultJson` (`engine/format-lint-result.ts`), and `loadConfiguration` (`config/load-config.ts`), which [`glossary.md`](../glossary.md) names correctly. The fourth name the ADR uses, `findConfig`, **does** exist (`config/find-config.ts`, exported from the barrel) — do not "correct" it.
2. **It prohibits the pipeline that shipped.** The ADR states that "`lintFiles` is intentionally **synchronous** (`globSync` + `readFileSync`) … Do not introduce an async variant". The shipped `lintFiles` returns a `Promise`, the corpus loader is built on `node:fs/promises`, `loadConfiguration` is async, and `globSync` appears **nowhere** in core (`readFileSync` survives only inside `SEC-003`'s template read, which is rule code, not the pipeline).

**The glossary half of this is already fixed; the ADR is now the only site.** [P16.01](../P16-release-readiness/01-test-debt.md) corrected the **`lintFiles`** entry — it now reads "and **`async`**", drops the ADR-as-authority link, and states in place that the ADR still carries the old claim. That divergence is recorded as a residual in [`accepted-behaviors.md`](../accepted-behaviors.md) naming this task as its closer, so **landing this task means deleting that residual row**, per the register's own "Removing a row" rule. What the glossary correction did _not_ do is settle the two entries that restate the same framing, and they must be classified in the same pass rather than left to contradict the corrected ADR: the **LSP server** entry ("Core stays LSP-friendly (synchronous, no `process.exit` in library code)") and the **Async rules / external HTTP checks** entry ("Conflict with the synchronous core-hosts-the-pipeline design and with determinism"). The second is partly true — rules genuinely are synchronous — so the fix is to say which layer each sentence is about, not to delete either. (Locate every glossary entry by **entry name**; the backlog's line citations were correct at the audited commit and the glossary has been edited repeatedly since.)

**What must not be swept with it.** Rules themselves **are** synchronous — `check(context): void` — and two shipped behaviors depend on that: `STR-001`'s corpus-only glob satisfaction (recorded as accepted for this reason) and the primitives' purity requirement. The false claim is about the **pipeline entry point**, not about rule execution. A correction that deletes the synchronicity clause wholesale would remove a real constraint.

**Why it is ranked first:** a tier-3 enforced decision is what a reviewer cites to block a change. Today it would block an async change that is already the shipped design — the audit calls it "the most dangerous of the paper findings" for exactly that reason.

**W-47 — two dependency-register entries claim more than shipped.**

- **Entry 4.2** fixes the deterministic-fixable subset as `SEC-*` plus `TBL-002`. `SEC-*` is three rules; only `SEC-001` is fixable. Re-verified in the current tree: `fixable: true` appears on `sec.ts:31` (SEC-001) and `tbl.ts:138` (TBL-002) and nowhere else, with SEC-002/SEC-003 and the other five `TBL-*` rules explicitly `fixable: false` — and the code states the true count in place at `tbl.ts:162`: "two are the only `fixable: true` rules".
- **Entry 4.3** asserts that `query`, `getImpactSet`, and `classifyImpact` are "reused directly by P7.03". **One of the three is.** Re-verified: `classifyImpact` is called by both hosts (`cli/src/commands.ts`, `mcp-server/src/tools/impact-analysis.ts`); `query` has no host caller (its only in-tree callers are core's own `search-index.ts` and `compile-context.ts`); `getImpactSet` has no caller anywhere outside `core/test/graph-impact.test.ts`.

**Why it matters:** 4.2 is the entry a `--fix` change is measured against, so a contributor would expect SEC-002 to be fixable, or would "restore" fixability the code deliberately withheld with a reason written next to it. And 4.3 is what lifts `getImpactSet` out of [P16.05](../P16-release-readiness/05-low-severity-cleanups.md)'s judgment call and into a documented expectation the code does not meet.

**P16.05 has since made 4.3 circular, and that is now the sharp end of this item.** It removed four unused barrel exports and kept these two, with a comment at `core/src/index.ts` justifying them: "this one and `getImpactSet` below stay because the MCP graph tools are documented as reusing them, which makes them a stated expectation rather than dead API." The document that "documents" it is entry 4.3 — the entry this task is told to narrow. So narrowing 4.3 to `classifyImpact` invalidates the barrel comment's stated reason, and the two must move together: either 4.3 keeps a form that genuinely covers them (recorded as intended library surface) or the barrel comment is rewritten to stand on its own. Leaving 4.3 narrowed and the comment citing it is the one outcome to avoid.

## Deliverables / steps

1. **W-41:** correct the three API names to `loadConfiguration`, `formatLintResultText`, `formatLintResultJson`, and leave `findConfig` alone — it exists.
2. **W-41:** replace the synchronicity clause with the **real** constraint — rules and primitives are synchronous; pipeline entry points are async — rather than deleting it. The wording already exists in three places to reuse: a tier-1 task file, a code comment, and the glossary's own **`lintCorpus`**/**`lintContent`** entries, which say "synchronous" about exactly the layer where it is true.
3. **W-41:** settle the **LSP server** and **Async rules** entries in the **same change**, and delete the `accepted-behaviors.md` residual that records the ADR-versus-glossary divergence — with the ADR corrected there is nothing left for it to record, and the register's rule is to delete a row rather than mark it stale. The **`lintFiles`** entry itself needs no correction (P16.01 did it) beyond dropping its now-obsolete aside about the ADR still disagreeing.
4. **W-47:** narrow 4.2 to `SEC-001` + `TBL-002`, and decide 4.3 together with the barrel comment that cites it, per that log's own honesty rule ("update the entry here and the canonical task file together").
5. **W-47 — the two directions for 4.3, and P16.05 has already shipped one half of it.** Either narrow 4.3 to `classifyImpact` **and** rewrite the barrel comment so its justification no longer rests on the entry that just stopped saying it, or record `query` and `getImpactSet` as intended library surface and let 4.3 say that instead of claiming P7.03 reuses them. **This task owns that choice**, precisely because entry 4.3 names them: [P16.05](../P16-release-readiness/05-low-severity-cleanups.md) ran a phase earlier, was scoped to the four exports no document mentions, and was instructed to leave these two here. Extend or restate what it wrote in the barrel — do not reopen the W-40 decision to remove the other four.
6. **Check the neighbours while there.** 4.1 and 4.4 were traced and **hold**, so the register is not wholesale unreliable — say that, so a reader does not over-correct. The audit also notes that roughly 20 of the log's 29 numbered entries are **unexamined**, and that a 2-of-9 hit rate came out of the sample; sweeping the rest is out of scope here but worth recording as the largest un-swept surface the assessment leaves behind.

## Out of scope

Auditing the remaining ~20 decision-log entries. It is the most likely place for another finding of this shape, and it deserves its own task rather than a widened one — record it, do not attempt it here.

## Exit criteria

- [ ] The ADR names only APIs that exist, verified by grep — and still names `findConfig`, which does.
- [ ] Its synchronicity clause states the real constraint (rules/primitives sync, pipeline entry points async) rather than being deleted.
- [ ] The **LSP server** and **Async rules** entries say which layer they mean, and the **`lintFiles`** entry no longer carries its aside about the ADR disagreeing.
- [ ] The `accepted-behaviors.md` residual recording the ADR-versus-glossary divergence is **deleted**, not marked stale.
- [ ] `grep -n synchronous docs/mdlint_v2/glossary.md` returns no sentence that is false of the shipped pipeline.
- [ ] A reviewer citing the ADR would not block an async change to a pipeline entry point.
- [ ] Decision 4.2 names `SEC-001` + `TBL-002`; 4.3 and the barrel comment that cites it agree — either 4.3 narrowed to `classifyImpact` with the comment restated on its own terms, or the two exports recorded as intended library surface once.
- [ ] The change states that 4.1 and 4.4 hold, and records the ~20 unexamined entries as remaining work.
- [ ] `npm run format` green.
