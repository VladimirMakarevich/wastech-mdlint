# Per-node reason for the graph's excluded set

> [Backlog](index.md) · Roadmap: [v2 Index](../index.md) · Size **M–L** · Deferred 2026-08-08 by [P18.08](../P18-followup-burndown/index.md).
>
> Originally recorded by [P15.02](../P15-output-contracts/02-graph-output-contract.md) as a register row, then scoped as a task. The cheap half shipped; this is the half that has a blast radius.

## The problem, measured

A node is excluded from the reading order for one of exactly two reasons: it sits in a cycle, or it is reachable only through one. Neither format says which applies to a given node.

Measured on this repository, 2026-08-08:

|  |  |
| --- | --- |
| Nodes / edges | 231 / 3013 |
| Cycles | **1**, of two documents: `README.md` ↔ `docs/guide/README.md` |
| Reading order | **1** document |
| Excluded | **230** documents |
| — of those, in the cycle | **2** |
| — of those, only downstream of it | **228** |

One ordinary mutual link — a root README pointing at a guide index that points back — costs the reading order 230 of 231 documents. That is correct Kahn behaviour, not a defect: the only in-degree-zero node left is `docs/mdlint_v2/decisions/index.md`, and everything else is reachable from the cycle. It is also invisible to the linter, because `GRP-001`'s `minCycleLength` defaults to 3 and this cycle has two nodes — a [registered decision](../accepted-behaviors.md). So `graph` is the only surface that can report it at all.

**The ratio is the finding.** The excluded set is ~1% cause and ~99% consequence, and the two are printed as one flat list.

## What already shipped, and what it leaves

[P18.08](../P18-followup-burndown/index.md) took the cheap half: the human `graph` report now prints one line above the list —

```text
2 of the 230 documents below sit in a cycle; the other 228 are reachable only through one, so breaking the cycles places them all.
```

Counts, from the Tarjan pass the graph already ran. It changes no result shape and no other surface. A reader who sees that line, plus the `cycles:` section right above it, has what they need to act.

Three gaps remain, in descending order of how much they cost a real consumer:

1. **A machine consumer cannot make the attribution at all.** `graph --format json` carries no `cycles` field — [deliberately](../accepted-behaviors.md), because the corpus-wide cycle list is a different signal from the per-node "why" — so a JSON consumer holds 230 names and no way to rank them short of re-running SCC over 3013 edges itself. The MCP `context-graph` tool's `format: "raw"` does return cycles; its `summary` branch is the same document as the CLI's JSON and does not. Note that adding **any** key here touches the six-key list stated on eight surfaces, which [P15.02](../P15-output-contracts/02-graph-output-contract.md) unified on purpose.
2. **`impact` has the same list and did not get the same line.** `renderImpactSummary` takes an `ImpactClassification`, which carries `excluded` but not the graph, so the split cannot be computed where it is rendered. Threading it is the first step of the work below rather than a separate fix — and leaving one of the renderers without it is exactly the inconsistency [P15.01](../P15-output-contracts/01-renderers-at-scale.md) warned against, so this is a real debt and not a shrug.
3. **The generated `SKILL.md` prints one bullet per excluded document, uncapped.** On this corpus that is a 230-bullet block inside an artifact whose whole purpose is to fit in an agent's context. `synthesize.ts` already handles the fully-empty reading order with an honest sentence; the partial case — 1 of 231 — has nothing.

## Why it is not a field

The reason has to come from running SCC over the excluded subgraph inside `topologicalSort`, whose `{ order, excluded }` result feeds four consumers: `ImpactClassification`, both human renderers, and the generated skill's `Reading Order` block. The skill's bytes are a content-hash contract, so widening the result shape re-renders every committed `SKILL.md`.

## Deliverables / steps

- [ ] **Decide the shape first**, and record the rejected alternative: does `topologicalSort` return a per-node reason alongside `excluded`, or do callers ask a separate classifier for it? Four consumers make this the load-bearing decision — a widened result reaches all four whether they want it or not, a separate call reaches only the ones that ask.
- [ ] Run SCC over the excluded subgraph and attribute each node to one of the two documented causes. Keep the pair closed — a third cause is a finding, not a silent third value.
- [ ] Thread the reason to the surfaces that can carry it without breaking a byte contract: the human `graph` renderer (replacing the count line with the attribution, or keeping both), `impact`'s renderer, and the graph JSON.
- [ ] For the JSON, price the key first: the `{ nodes, edges, components, readingOrder, excluded, coverage }` list is restated on eight surfaces (`cli.md`, `context-graph.md`, the glossary twice, the register, `P4-graph/07`, two source comments, `README.md`) plus a CLI test title. Adding a key is a documentation sweep, not a one-line change.
- [ ] Decide deliberately whether the generated `SKILL.md`'s `Reading Order` / `Cycles` blocks change, and if they do not, say why in the notes. If they do, the content hash of every committed artifact moves.
- [ ] Check `ImpactClassification` for a case where the reason changes an answer rather than only annotating it.
- [ ] Update [the context-graph guide](../../guide/context-graph.md), the graph output contract, and the register rows this closes.
- [ ] Pin the attribution in `packages/core/test/graph-render.test.ts` over a fixture holding one node of each cause — the `a↔b, b→c→d` shape used by the count pin is already that fixture.

## Exit criteria

- [ ] Every excluded node carries exactly one of the two documented reasons, in both the human and the structured format.
- [ ] `impact` and `graph` describe an excluded set the same way.
- [ ] The generated skill's byte contract is either unchanged or its change is deliberate and recorded.
- [ ] The register rows that recorded this as absent are removed rather than left describing a shipped behavior as missing.
- [ ] A fixture with one cycle-excluded and one cycle-reachable node pins both reasons.
