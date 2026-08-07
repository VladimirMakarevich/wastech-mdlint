# P0.08 · Phase exit verification & layout docs

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Prove P0 is complete and behavior-neutral, and document the new layout so P1+ contributors start from a clear map.

## Sequence

- **Previous:** [P0.07 — CI & packaging baseline](07-ci-packaging-baseline.md) made the workspace continuously verified and publish-shaped.
- **Next:** **Phase P1 — `ParsedDocument` & parser upgrade** (see the [roadmap](../index.md)); it extends the parser now living in `@wastech-mdlint/core`.
- **Depends on:** all of P0 · **Blocks:** start of P1.

## Inputs (from previous work)

- The full workspace (`core` + `cli` + `mcp-server`), migrated current modules, and CI from P0.01–P0.07.

## Deliverables / steps

1. Run the full gate: `npm run typecheck && npm test && npm run build` across the workspace — all green.
2. **Parity check:** run `wastech-mdlint scan` and `graph` on a fixture (and on this repo) and diff against pre-migration output — must be identical.
3. Confirm the current `postinstall` is gone and install writes no config ([I1](../requirements/06-installation.md)).
4. Add a short "Workspace layout" section to the repo `README.md` (packages, bins, how to build/test) and, with the owner's approval, update [AGENTS.md](../../../AGENTS.md) "Sources Of Truth" to point at `docs/mdlint_v2/`.
5. Mark P0 tasks done in the [phase index](index.md).

## Decisions applied

- All P0 decisions; verifies [D1](../index.md), [D5](../index.md), [I1](../requirements/06-installation.md), [I5](../requirements/06-installation.md).

## Exit criteria

Recorded rather than tracked: this task predates the convention that the landing change ticks its own criteria, so the lines below are the bar it was written against, not a live checklist. Phase completion is carried by the [phase index](index.md); the reasoning is in the [completion surface](../completion-surface.md).

- Workspace-wide typecheck/test/build green.
- **Retired — permanently unverifiable.** `scan`/`graph` output parity with the current implementation confirmed. The implementation this compares against was removed at the P3.09 cutover and no test stands in for it, so the diff can no longer be produced by anyone; retired at all three of its phase-/verification-level sites rather than ticked ([P0.05](05-cli-package-commander.md) states the same check as a delivery criterion and is stripped with the rest of P0–P3 instead — see the [completion surface](../completion-surface.md)).
- Layout documented; AGENTS.md pointer updated (with approval).
- [Phase index](index.md) exit checklist fully ticked.

## Hand-off to next

Phase P1 begins from a clean, verified monorepo: the parser, graph, discovery, config, and token estimator all live in `@wastech-mdlint/core`, ready to be extended into the richer `ParsedDocument` without touching package structure.
