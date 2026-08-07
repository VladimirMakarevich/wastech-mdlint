# P18.08 — Per-node reason for the graph's excluded set

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M–L** · Status **Not started**.
>
> Spun out of [P15.02](../P15-output-contracts/02-graph-output-contract.md), which shipped the excluded set in both formats and recorded the missing attribution in [accepted behaviors](../accepted-behaviors.md) as its own task rather than a rider.

## Problem

The graph's excluded set names the nodes a topological sort could not place, but not **why** each one is unplaceable — whether it sits in a cycle, or is reachable only through one. On the field-test corpus that is a reading order 43 of 139 nodes short, and the set alone does not tell a reader which of the two causes to act on. The guide states the two reasons as a closed pair, so a reader knows the causes exist; nothing says which applies to a given document.

Why this is a task and not a field: the reason has to come from running SCC over the excluded subgraph inside `topologicalSort`, whose `{ order, excluded }` result also feeds `ImpactClassification`, both human renderers, and the generated skill's `Reading Order` block. Four surfaces consume it, and the generated skill's bytes are a content-hash contract, so widening the result shape is a change with a blast radius rather than an addition.

## Deliverables / steps

- [ ] Decide the shape first: whether `topologicalSort` returns a per-node reason alongside `excluded`, or a separate classification the callers ask for. Record the choice and the rejected alternative, since four consumers make this the load-bearing decision of the task.
- [ ] Run SCC over the excluded subgraph and attribute each node to one of the two documented causes. Keep the pair closed — if a third cause turns out to exist, that is a finding, not a silent third value.
- [ ] Thread the reason to the surfaces that can carry it without breaking a byte contract: the human `graph` renderer and the graph JSON. Decide deliberately whether the generated `SKILL.md`'s `Reading Order` block changes, and if it does not, say why in the notes.
- [ ] Check `ImpactClassification` for a case where the reason changes an answer rather than only annotating it.
- [ ] Update [the context-graph guide](../../guide/context-graph.md), the graph output contract, and the register row that recorded this as deferred.
- [ ] Pin the attribution in `packages/core/test/graph-render.test.ts` over a fixture holding one node of each cause.

## Exit criteria

- [ ] Every excluded node carries exactly one of the two documented reasons, in both the human and the structured format.
- [ ] The generated skill's byte contract is either unchanged or its change is deliberate and recorded.
- [ ] The register row that deferred this is removed rather than left describing a shipped behavior as absent.
- [ ] A fixture with one cycle-excluded and one cycle-reachable node pins both reasons.
