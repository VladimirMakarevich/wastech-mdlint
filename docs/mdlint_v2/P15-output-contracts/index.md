# Phase P15 — Output contracts & rendering at real scale

> Roadmap: [v2 Index](../index.md) · Phase **P15** · Size **M** · Status **Done** · Depends on [P14](../P14-host-boundary/index.md) (host boundary landed).
>
> **Goal:** make one format name denote one shape, make every documented output contract match what ships, and make the two human-facing renderers usable on a corpus nobody designed for. Sourced from the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), batches **B8–B9** plus the documentation half of **B11**.

## Why this phase exists

Two distinct problems land here, and they are separated by what could see them.

**The contract problems** are visible by reading, and the audit found them by reading: a shipped fifth key in the graph JSON documented on none of five surfaces that all say four; `format: "json"` meaning different documents on the CLI and on MCP; a source comment asserting that two hosts share one lint shape when they ship three; a guide naming five message fields where eight are emitted, and a `pass/fail` field that does not exist.

**The scale problems could not be found by reading, and were not.** The audit's own compile output was 1415 bytes; the field test's was **110 789**. Below a few dozen documents there is no 3.9 KB comma-joined line, no `SKILL.md` that is 90% edge list, no role vocabulary where two of five buckets hold 83% of nodes. These three defects are the clearest evidence for the fixture gap [P16.01](../P16-release-readiness/01-test-debt.md) closes — and the reason this phase's exit criteria are stated as **bounds at a stated corpus size** rather than as "looks fine".

## Tasks

| # | Task | Backlog | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P15.01](01-renderers-at-scale.md) | Renderers at real scale: multi-KB lines, a skill that is a graph dump | W-26, W-27, W-28 | High | M | P14 |
| [P15.02](02-graph-output-contract.md) | Graph output: coverage, format parity, one vocabulary | W-22, W-23, W-25 | Medium | M | P14 |
| [P15.03](03-lint-output-contract.md) | Lint output shapes and the documented message contract | W-24, W-34, W-35, W-36 | Medium | M | P14 |

> **Backlog key.** `W-NN` are the work items in the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), which names each item's source finding IDs so the original evidence stays reachable.

## Sequence

```
(P14) ─► P15.01  (rendering bounds — needs a large fixture)
        P15.02  (graph JSON/MCP parity; touches the same renderer file)
        P15.03  (lint shapes + message docs)
                                   └─► (P16)
```

> **P15.01 and P15.02 both touch [`graph-render.ts`](../../../packages/core/src/graph/graph-render.ts)** — P15.01 the human format's line shape, P15.02 the JSON key set — so run them in either order but not concurrently on the same branch. P15.03 is independent. All three want the large fixture [P16.01](../P16-release-readiness/01-test-debt.md) formalizes; whichever lands first should build it and the others reuse it.

## Phase exit criteria

- [x] At 139 nodes, no line in `graph --format human` exceeds a stated width, and `json`/`mermaid`/`dot` stay byte-stable (W-26).
- [x] A 139-document corpus produces a `SKILL.md` whose dependency section is bounded and whose longest line is under a stated cap, with determinism and the content hash preserved (W-27).
- [x] No single node role holds a near-majority of a realistic corpus, or the coarseness is stated where the `Role` column is documented (W-28).
- [x] `coverage` is documented on all five surfaces and reachable from both hosts; one format name denotes one shape (W-22).
- [x] The `excluded from reading order` set exists in both formats, with parity asserted by a test (W-23).
- [x] One word means "plain text for a human" across the CLI, or the split is deliberate and stated (W-25).
- [x] Each host's lint JSON shape is documented where a consumer looks, and no source comment claims they are one (W-24).
- [x] The documented message-key set matches the emitted set; `helpUri` either resolves or is renamed (W-35).
- [x] Every statement of the token heuristic in the tree agrees with the code, and a reader of a `tokens` finding can learn the calibration without reading source (W-34).
- [x] R6's `docsUrl`/`messages` are populated and read, or dropped with the requirement amended (W-36).
- [x] Gates green.

## What P15 unblocks

- [P16](../P16-release-readiness/index.md). The generated `SKILL.md` and the graph JSON are what an agent consumes and what a published package advertises, so their shape is a release precondition rather than polish.
