# P11.11 · `LLM-001` deduplicates cross-entrypoint findings

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit finding **L-3** ([post-P9 audit](../audit-2026-07-25-post-p9.md)); the exact-duplicate instance of `p9-09`'s SC-2 class.

## Goal

`LLM-001` must report a given missing-import or cycle diagnostic once, not once per entrypoint that reaches it.

## Problem (from the audit)

`packages/core/src/engine/rules/llm.ts:128` calls `traverse()` on each entrypoint, and `:156-175` reports `missing`/`cycles` from **each** traversal independently. Two entrypoints sharing a subtree emit byte-identical duplicate findings for the same underlying condition, and there is no dedup in `lint-files.ts`. The audit's [§4](../audit-2026-07-25-post-p9.md) pairs this with `p9-09`'s SC-2 (duplicate `SIZE-001` findings, handled in [P11.13](13-grp-size-hygiene.md)) as the "duplicate findings" class.

## Deliverables / steps

1. Deduplicate `LLM-001` findings before reporting — key on the stable finding identity (rule + normalized path + line + message/kind), so a diagnostic reached via multiple entrypoints is emitted once. Keep the traversal itself per-entrypoint; only the reporting is deduped.
2. Preserve determinism: the retained finding and its ordering must not depend on entrypoint iteration order.
3. Test: a fixture with two entrypoints over a shared subtree containing one missing import / one cycle reports exactly one finding for it.

## Out of scope

`SIZE-001`'s severity-override duplication (SC-2) — that is [P11.13](13-grp-size-hygiene.md). No change to what `LLM-001` considers a violation, only to duplicate suppression.

## Exit criteria

- [x] A diagnostic reachable from multiple entrypoints is reported exactly once.
- [x] Finding order is deterministic regardless of entrypoint order.
- [x] A two-entrypoint shared-subtree regression fixture asserts single emission.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **The dedup lives in the rule, not in `lint-files.ts`.** An engine-level identity dedup would change behavior for every rule at once and would collide with [P11.13](13-grp-size-hygiene.md), whose `SIZE-001` duplication is a _severity-collapse_ problem (two thresholds, two findings, same metric) rather than identity duplication — a shared helper would have to serve both and serves neither. `run-rules.ts` and `lint-files.ts` still only sort; nothing about the pipeline contract moved.
- **Identity is `filePath` + `line` + `column` + rendered `message`** — what the task specifies ("rule + normalized path + line + message/kind"), with `ruleId` implicit since the key is scoped to one rule's own findings. Including the full message is safe by construction for the two shapes that can actually collide across entrypoints: the missing-import and cycle findings derive their `data` 1:1 from their message (raw/resolved target; cycle path), so equal keys carry equal payloads and a suppressed duplicate never held information the survivor lacks. The over-budget finding is the exception — its `data.importedFiles` appears nowhere in its message — but it is exempt rather than at risk, because its key is unique per entrypoint by construction and no duplicate of it can ever be suppressed. A fourth finding shape would need one of those two properties to be safe under this key. A looser key (file + line) would silently drop a genuinely different diagnostic at the same position — a missing import and a cycle can share a line. The key parts are NUL-joined because paths and messages both contain spaces.
- **Cycle rotation is deliberately not canonicalized.** `traverse` reports a cycle at the import edge that closes it, so entering the same loop at a different node yields a different `sourcePath`, `line`, and path rendering. Under the identity above those are two findings, which is correct: collapsing them would delete a report on a file the user still has to fix. `build-context-graph.ts` canonicalizes rotation for _graph_ cycle output, a location-free contract that does not transfer here. The required shared-subtree fixture dedupes to one finding because both entrypoints enter the subtree at the same node — the realistic case.
- **Budget findings stay per entrypoint.** They route through the same map, but their identity already differs per entrypoint (`filePath` is the entrypoint, the message names it), so it is a no-op. A dedicated over-dedup guard test pins that, since a too-coarse key is exactly the failure mode that would silence a real budget breach.
- **The rule sorts its own output** even though both `run-rules.ts` and `lint-files.ts` sort downstream. Belt-and-braces: it keeps emission order a property of the rule rather than of `Map` insertion (i.e. entrypoint iteration) order, so the guarantee does not depend on a caller.
- **`reportEntrypoint` became `collectEntrypointFindings`** — it returns findings and takes the `siteRouter` setting instead of the whole `RuleContext`, so the collector is pure and cannot report behind the dedup boundary. `traverse()` is untouched; no parallel traversal was introduced.
- **No message, `data`, `helpUri`, severity, or violation-definition change**, so no generated artifact moves: rule metadata and the options schema are identical, leaving `README.md`'s rule table and `packages/cli/schema.json` byte-identical (no `npm run generate:docs`).
- **Tests** are rule-level in `packages/core/test/rules-llm.test.ts` (four cases: shared-subtree single emission; identical output when the sorted entrypoint order flips around a shared node; budget-per-entrypoint preserved; a cycle closed at a different edge kept distinct). No CLI fixture — no CLI surface changed and the behavior is fully observable from `lintFiles`. Each assertion compares the whole `path:line message` list, so a regression shows up as a count _and_ an order failure rather than a substring still matching. The expected line numbers and cycle renderings were read off the pre-change (duplicated) output first, so this is a genuine red→green regression.
- **`docs/guide/rules/LLM-001.md`** gained one Notes bullet stating the dedup, the identity, and both of its edges (budget stays per entrypoint; different closing edges stay separate findings).
