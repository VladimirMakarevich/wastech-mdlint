# P18.01 — Compile renderers: cycles block and token-note parity

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
>
> Two items in `packages/core/src/compile/synthesize.ts`, recorded by [P15.01](../P15-output-contracts/01-renderers-at-scale.md) and [P15.03](../P15-output-contracts/03-lint-output-contract.md). A third, FU-02, turned out to be a decision already taken — see below.

## Problem

**FU-03 — `renderCyclesBlock`'s empty branch dropped the count.** It emitted `Excluded from reading order: (none)` where the populated branch emits `Excluded from reading order (N):`, so a `^Excluded from reading order \((\d+)\)` scan over a generated `SKILL.md` missed the zero case. The same argument had already produced `- to (0): (none)` in `renderEdgeBullets` two functions below, so the inconsistency was between two branches of one artifact rather than a debatable shape.

**FU-04 — a comment asserted a parity the change that wrote it had removed.** Above the over-budget loop: "Phrasing mirrors LLM-001's own report (`engine/rules/llm.ts`) so the same budget breach reads identically whether seen as a lint finding or in the compiled skill." [P15.03](../P15-output-contracts/03-lint-output-contract.md) appended `TOKEN_ESTIMATE_NOTE` to `llm.ts`'s message and deliberately not to this line, so the two no longer read identically. The register row for the uncalibrated artifact numbers already existed; only the comment was false.

## What was done

- [x] **FU-03:** the empty branch emits `Excluded from reading order (0): (none)`, with a why-comment pointing at the same reasoning `renderEdgeBullets` states. The assertion in `packages/core/test/compile-synthesize.test.ts` was updated and its title now names the count, so the pin is about the shape rather than about the word `(none)`.
- [x] **FU-04:** the comment now states the divergence and the trade behind it — the calibration belongs with the number a reader can act on, and appending it in the artifact would move the bytes and content hash of every generated `SKILL.md` — and says outright not to close the gap by appending the note. The register row it points at was already in [accepted behaviors](../accepted-behaviors.md).

## FU-02 was already decided, not unfixed

`renderEdgeBullets` caps **edges**, not distinct referencing documents, so one source contributing a `link` plus two `anchor` edges takes three of the ten slots and renders byte-identical adjacent bullets. The follow-up recorded this as a defect with two remedies: dedupe, or state that the unit is edges. **The second was already taken, at all three sites the follow-up named** — [P15.01](../P15-output-contracts/01-renderers-at-scale.md)'s implementation notes state the decision and its reason (the graph keeps one edge per source construct, and dedup-with-count is a `G7` backlog item, so deduping here would make the bullet's count and its bullets speak about different units), it is a row in [accepted behaviors](../accepted-behaviors.md), and `docs/guide/compile.md` says "The unit is **edges, not distinct documents**" and names `impact <file>` as the per-file view.

So no code changed. It is recorded here because the triage that produced this phase read the source and not the register, and a future reader of the follow-up queue would repeat that mistake: **a live-looking item can be a documented decision.** Deduping now would reverse an accepted behavior, which is a P-release-scale call about `G7`, not a burn-down item.

## Exit criteria

- [x] `^Excluded from reading order \((\d+)\)` matches a generated `SKILL.md` in both the empty and the populated case.
- [x] No comment in `synthesize.ts` claims phrasing parity with `llm.ts` that the shipped strings do not have.
- [x] The generated-artifact token-number disclosure is a register row, not only a source comment — it already was, and the comment now points at it.
- [x] The fan-out unit is stated once as a decision, and this phase does not silently reverse it.
