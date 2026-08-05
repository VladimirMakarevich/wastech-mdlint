# P13.05 · Reference and extension resolution

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-08](../remediation-backlog-2026-08-05.md) (High), [W-09](../remediation-backlog-2026-08-05.md) (Medium), [W-10](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F4 (MED-HIGH, reproduced twice), F8 (MEDIUM, reproduced), F15 (MEDIUM there, downgraded to Low per the QA pass). Depends on [P12](../P12-consistency/index.md).

## Goal

Make reference resolution answer one question one way: a documented `exclude` must apply on every branch, and "a Markdown file" must mean the same thing to the coverage signal, the `init` scanner, and the default `include`.

## Problem

**W-08 — `REF-001.exclude` goes inert whenever any `siteRouter` is set.** [`packages/core/src/engine/primitives/reference.ts`](../../../packages/core/src/engine/primitives/reference.ts) splits resolution into two branches at `:70` and applies `options.exclude` on only one of them (`:88`). The image sibling has no split and always applies it — so one broken primitive, not two.

**The trigger is cheaper than it looks.** Every `siteRouter` field is optional and the object is strict, so a bare `{}` validates; with no preset the router returns the stripped path, behaviorally identical to the no-router branch **except** that `exclude` stops applying. Reproduced twice, identically: same fixture, `exclude: ["generated/**"]` and no router exits `0`; adding `"settings": {"siteRouter": {}}` and changing nothing else reports the link and exits `1`.

**Second caller, and the guide pairs the two options itself.** The declarative-custom-rule dispatcher passes a user's `assert.exclude` straight into `linkResolves` ([`primitives/assert.ts`](../../../packages/core/src/engine/primitives/assert.ts) `:233`), so a `custom` rule inherits the hole — the family where the option is most likely hand-written. And `docs/guide/config-reference.md` sets a whole-config `starlight` router, notes most projects set it exactly once there, and then shows a `REF-001` entry combining `exclude` with a per-rule router: a reader gets the inert combination by following the guide, not by misusing it.

**W-09 — three incompatible definitions of "a Markdown file".** Coverage uses `.md` + `.markdown` ([`graph/coverage.ts`](../../../packages/core/src/graph/coverage.ts) `:32`); `init`'s scanner uses `.md` + `.mdx` ([`discovery/repo-scan.ts`](../../../packages/core/src/discovery/repo-scan.ts) `:55`); the default `include` is the `.md` glob alone ([`engine/lint-files.ts`](../../../packages/core/src/engine/lint-files.ts) `:75`). `.markdown` appears nowhere else in core and on no guide page. So the coverage signal — whose entire job is naming on-disk Markdown that is linked-to but outside the corpus — checks for an extension no default configuration can admit, and is blind to the one `init` exists to find. Reproduced: `filesOutsideCorpus` listed `docs/legacy.markdown` and never mentioned `docs/page.mdx`.

**W-10 — two disagreeing image-target resolvers.** Router-aware in [`graph/build-context-graph.ts`](../../../packages/core/src/graph/build-context-graph.ts) `:20` and `coverage.ts:86`; router-blind in `reference.ts:129` and in `init`'s REF-003 tally at [`discovery/rule-inference.ts`](../../../packages/core/src/discovery/rule-inference.ts) `:114`, whose comment claims it mirrors the rule. The graph builder's invariant comment says resolution mirrors the REF rules "so graph edges never disagree with the REF rules"; it names REF-001 and REF-002, so it is literally accurate, but the same helper carries images. **The behavioral effect was never measured** — the QA pass confirmed the structure and noted this, which is why it is Low: a router-routed candidate ends in a Markdown extension and an image rarely does.

## Deliverables / steps

1. **W-08:** apply `options.exclude` on the router branch before the candidate loop, exactly as the non-router branch does. One change closes both callers, since the custom dispatcher goes through the same primitive.
2. **W-08 tests:** cover the router-plus-`exclude` combination for **both** `REF-001` and a `custom` rule asserting `linkResolves`. The custom half is the one no test reaches today.
3. **W-08 docs:** `docs/guide/rules/REF-001.md:22` states the option unconditionally and documents the router separately, with nothing saying the two interact. After the fix that is true; verify it rather than assuming, and check whether `config-reference.md`'s combined example now behaves as written.
4. **W-09:** share **one** extension constant between the three sites, as [`discovery/gitignore-layers.ts`](../../../packages/core/src/discovery/gitignore-layers.ts) `:6` already does for the sibling problem. Decide what the set is — adding `.mdx` to the corpus is a scope change, so the cheap and defensible move is one constant whose membership is stated once and referenced everywhere. Whatever is chosen, `docs/guide/context-graph.md:31` advertises coverage with no extension caveat and must end up true.
5. **W-10 — either direction is acceptable, but pick one:** route images through the shared candidate helper, **or** narrow the graph builder's invariant comment to say images are deliberately excluded. Do not leave one model claimed and two implemented.
6. **Glossary.** The **REF** family entry and the coverage/`filesOutsideCorpus` entries describe these behaviors; update what changes.

## Out of scope

Making `.mdx` a first-class linted extension — that is a product decision with parser implications, and nothing in the backlog asks for it. This task's obligation is that the three sites agree and that the guide describes the agreement.

## Exit criteria

- [ ] The W-08 reproduction exits `0` in **both** configurations (with and without `"settings": {"siteRouter": {}}`).
- [ ] A test covers router-plus-`exclude` for `REF-001` and for a `custom` `linkResolves` rule; both fail before the fix.
- [ ] One extension constant governs coverage, the `init` scan, and the default `include`, asserted by a test rather than by inspection.
- [ ] The `.mdx` fixture from the W-09 reproduction is reported by the coverage signal, or its exclusion is documented on the coverage guide page.
- [ ] One image-resolution model is claimed and implemented, or the exclusion is stated where the invariant is.
- [ ] Gates green.
