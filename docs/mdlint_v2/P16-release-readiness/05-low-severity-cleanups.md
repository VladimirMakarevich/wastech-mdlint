# P16.05 · Low-severity code and decision cleanups

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-37](../remediation-backlog-2026-08-05.md) (Low), [W-38](../remediation-backlog-2026-08-05.md) (Low), [W-39](../remediation-backlog-2026-08-05.md) (Low, **decision**), [W-40](../remediation-backlog-2026-08-05.md) (Low, **decision**). Sources: audit F30, F26, F24; field F-18. Depends on [P15](../P15-output-contracts/index.md).

## Goal

Clear the four smallest code and scope items, two of which are one-line fixes and two of which are decisions that only need to be **made** — a scope choice left unstated is what turns into a finding a second time.

## Problem

**W-37 — the generated schema hardcodes the custom `target` vocabulary twice.** [`packages/core/src/engine/schema.ts`](../../../packages/core/src/engine/schema.ts) `:88` and `:104` each spell the enum as a literal (`["checklist", "content", "link", "section", "table"]`) while the typed authority is `ASSERTION_TARGETS`. **Correct today** — the values were compared and match. The finding is that a new assert kind with a new target needs two hand edits in a function whose own framing is metadata-driven, and that the config loader is **looser** than the schema (`config-schema.ts:98` accepts any string), so drift would present as "the editor rejects a config the linter accepts" — a confusing shape to debug.

**W-38 — a stale rationale comment.** [`packages/core/src/graph/coverage.ts`](../../../packages/core/src/graph/coverage.ts) `:73-74` still says the coverage signal is "Core-only for P4.06 — there is no CLI/lint-output consumer yet". There is: [`packages/cli/src/commands.ts`](../../../packages/cli/src/commands.ts) `:232` calls it. The QA pass added a detail the audit omitted: the comment **continues** "(P4.07 surfaces this in the `graph` command)", so it points at the consumer that arrived. The fix is to delete the stale half, not the whole comment.

**W-39 — `init` can only ever infer 8 of the 24 built-in rules.** The inference vocabulary is `CTX-001 CTX-002 GRP-001 REF-001 REF-002 REF-003 SEC-001 TBL-002`. The other 16 — including `SIZE-001` and `LLM-001`, the two LLM-context rules the README **leads with** — are never proposed, so a user reaches them only by reading the rule table and hand-writing config. Concretely reachable for a real target: the scan already samples file sizes, so a derived `SIZE-001` budget is inferrable; `CLAUDE.md`/`AGENTS.md` with `@` imports are detectable, so `LLM-001` is too. Recorded as a scope choice rather than a defect — but combined with [P13.04](../P13-correctness/04-rule-option-defaults.md) it means **nothing guides a user to a working size budget from either direction**, and P13.04 fixes only the config-authoring half.

**W-40 — four uncalled barrel exports.** `slice`, the single-document `extractDocProfile`, the `fileMatches` hook on assertion options, and the retained `files` option on the column-unique primitive have no host caller, against a barrel whose own comment frames hosts as the audience and a coding rule against extension points built ahead of need.

**Genuinely a judgment call:** `core` is a published package, so "no internal caller" is not automatically a defect, and no document names an expected consumer for these four. `getImpactSet` and `query` are **not** in this item — a tier-3 decision names both as consumed, which makes them a documented expectation the code does not meet rather than an open call, and they live in [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md).

## Deliverables / steps

1. **W-37:** derive both enums from `ASSERTION_TARGETS`. While there, decide whether the loader's `z.string().optional()` should tighten to the same authority — the schema/loader asymmetry is the half that makes drift confusing, and leaving it is a choice worth stating.
2. **W-38:** delete the stale clause, keep the P4.07 pointer or drop the whole comment — either is fine, as long as no sentence claims an open seam that closed.
3. **W-39 — decide:** widen [`packages/core/src/discovery/rule-inference.ts`](../../../packages/core/src/discovery/rule-inference.ts) (the two concretely reachable candidates are `SIZE-001` from the sampled file sizes and `LLM-001` from detected `@` imports), **or** record the scope choice with its reason. If it is recorded rather than widened, say where a user is expected to learn about `SIZE-001`/`LLM-001` instead, since the README leading with them and `init` never proposing them is the actual gap.
4. **W-40 — decide:** keep the four as library surface and say so (a sentence in the barrel comment naming the intended audience is enough), or remove them. Do not leave the barrel's own framing contradicting its contents.
5. **W-40 — `query` and `getImpactSet` are not this task's to decide.** Both are named by decision entry 4.3 as "reused directly by P7.03", so they are a documented expectation rather than an open judgment call, and [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) owns them — including the option of recording them as intended library surface. P16 runs **before** P17, so this task cannot wait on that outcome and must not pre-empt it: scope the decision to the four exports above, and state in the change that the two register-named exports are settled in P17.03. If P17.03 later adopts them as surface, it extends whatever sentence this task writes in the barrel rather than reopening it.
6. **Glossary.** The **Target** entry already states that `target` is optional and derived; W-37 does not change that contract, only its derivation. If W-39 widens inference, the `init`/`scanRepository` entries change.

## Out of scope

`getImpactSet` and `query` — both settled by a decision record, so they belong to [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md). Adding new assert kinds or new inferable rules beyond the two named candidates.

## Exit criteria

- [ ] Both `target` enums derive from `ASSERTION_TARGETS`; the loader/schema asymmetry is tightened or the choice is stated.
- [ ] No comment in `coverage.ts` claims the P4.06 seam is open.
- [ ] `init`'s inference vocabulary is widened, or the scope choice is recorded together with where a user is expected to learn about `SIZE-001`/`LLM-001`.
- [ ] The four uncalled exports are removed, or the barrel states that they are intended library surface.
- [ ] The change states that `query`/`getImpactSet` are deliberately left to [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) — decided there once, not here as well.
- [ ] Gates green.
