# P11.11 · `LLM-001` deduplicates cross-entrypoint findings

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **L-3** ([post-P9 audit](../audit-2026-07-25-post-p9.md));
> the exact-duplicate instance of `p9-09`'s SC-2 class.

## Goal

`LLM-001` must report a given missing-import or cycle diagnostic once, not once per entrypoint that
reaches it.

## Problem (from the audit)

`packages/core/src/engine/rules/llm.ts:128` calls `traverse()` on each entrypoint, and `:156-175`
reports `missing`/`cycles` from **each** traversal independently. Two entrypoints sharing a subtree
emit byte-identical duplicate findings for the same underlying condition, and there is no dedup in
`lint-files.ts`. The audit's [§4](../audit-2026-07-25-post-p9.md) pairs this with `p9-09`'s SC-2
(duplicate `SIZE-001` findings, handled in [P11.13](13-grp-size-hygiene.md)) as the "duplicate
findings" class.

## Deliverables / steps

1. Deduplicate `LLM-001` findings before reporting — key on the stable finding identity
   (rule + normalized path + line + message/kind), so a diagnostic reached via multiple entrypoints
   is emitted once. Keep the traversal itself per-entrypoint; only the reporting is deduped.
2. Preserve determinism: the retained finding and its ordering must not depend on entrypoint
   iteration order.
3. Test: a fixture with two entrypoints over a shared subtree containing one missing import / one
   cycle reports exactly one finding for it.

## Out of scope

`SIZE-001`'s severity-override duplication (SC-2) — that is [P11.13](13-grp-size-hygiene.md). No
change to what `LLM-001` considers a violation, only to duplicate suppression.

## Exit criteria

- [ ] A diagnostic reachable from multiple entrypoints is reported exactly once.
- [ ] Finding order is deterministic regardless of entrypoint order.
- [ ] A two-entrypoint shared-subtree regression fixture asserts single emission.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
