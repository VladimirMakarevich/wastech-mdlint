# P15.01 · Renderers at real scale

> Phase: [P15 — Output contracts](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-26](../remediation-backlog-2026-08-05.md) (High), [W-27](../remediation-backlog-2026-08-05.md) (High), [W-28](../remediation-backlog-2026-08-05.md) (Medium, **decision**). Sources: field F-19 (minor, raised), F-21 (major), F-22 (minor). Depends on [P14](../P14-host-boundary/index.md).

## Goal

Make the two human-facing renderers readable on a corpus of realistic size. Three defects that **no fixture in this repository can currently produce** — the audit's compile output was 1415 bytes, the field test's was 110 789.

## Problem

**W-26 — `graph --format human` emits multi-KB single lines.** On a 139-node graph: 77 lines / 19 790 bytes, of which four are comma-joined blobs — one `clusters` entry at 3904 chars, `reading order (66)` at 3668, `excluded from reading order (73)` at 3561, `entry points (61)` at 3497. `top hubs`, `cycles` and `coverage` are correctly one item per indented line, so the format is **internally inconsistent**: three sections line-oriented, three single-line blobs. The format's own name promises a report readable in a terminal.

Two consequences worth naming. The plan's own command is `graph . --format human | head -60`, which assumes line-oriented output — with these blobs `head` truncates the report but not the unreadable lines. And **it reaches MCP too**: the `context-graph` text block is the human report regardless of `format`, so a host renders the same line.

**W-27 — the generated `SKILL.md` is a graph dump.** On 139 docs: 110 789 bytes / 831 lines / ~27 697 tokens by the tool's own estimate, apportioned `Document Dependencies` **89.7%**, `Document Architecture` 9.3%, `Workflow` **0.4%**, `Document Rules` **0.3%**, `Context Budget` 0.1%, front matter 0.2%. Inside the dependency section sits a **single line of 17 530 characters** — the `- to:` fan-out for one hub with 290 references, comma-joined — plus a 3819-char line and a 3702-char `Excluded from reading order:` line.

Why it matters: the two sections that would tell an agent how to operate are 0.7% of the artifact, while the edge list an agent cannot act on is nine tenths — and a skill file is loaded into context **whole**. The skill is ~8.7% of the 318 912-token corpus it describes. The field test's verdict on the plan's own question ("usable context, or a table of contents?") was: neither — it is a graph dump.

**W-28 — the node-role vocabulary collapses.** Of 139 nodes: `hub` 66, `isolated` 50, `entry` 11, `bridge` 8, `leaf` 4. Two of five roles hold 116 (83%), and in practice read as "has edges" / "has no edges", so the `Role` column of `Document Architecture` teaches a reader almost nothing. `hubMinInDegree` is exposed in `config.compile` and is presumably the knob, but its default puts 66 documents in one bucket.

## Deliverables / steps

1. **Build the large fixture first.** None of these three can be tested without one. A generated fixture is acceptable and probably better than a checked-in 139-file tree: build a graph with a stated node count, a hub with a high in-degree, and a topological tail that forces exclusions. [P16.01](../P16-release-readiness/01-test-debt.md) formalizes this as standing test debt; build it here and let that task adopt it.
2. **W-26:** render `clusters`, `reading order`, `excluded from reading order` and `entry points` one item per indented line, exactly as `top hubs` already is, in [`packages/core/src/graph/graph-render.ts`](../../../packages/core/src/graph/graph-render.ts). This is a consistency fix within one file, not a redesign.
3. **W-26 — protect the machine formats.** `json` (216 KB), `mermaid` (21 KB) and `dot` (29 KB) were all correct and byte-stable across repeated runs. They must stay byte-identical; assert that rather than trusting it.
4. **W-27:** cap or summarize the fan-out in [`packages/core/src/compile/synthesize.ts`](../../../packages/core/src/compile/synthesize.ts) and give the budget back to `Document Rules` and `Workflow`. Note that `hubMinInDegree` exists but governs **role assignment**, not this — do not reach for it as the cap.
5. **W-27 — preserve what works.** `Document Rules` is well-built (grouped by family with human descriptions) and the compile path's determinism and content hash are verified properties: two `--dry-run` runs are byte-identical and the hash is stable. Any capping must be deterministic, or it breaks the property the compile phase was built around.
6. **W-27 — decide what a bounded dependency section says.** A truncated edge list with no marker is worse than a summarized one; state in the output that it is bounded and by what rule, so a reader knows the artifact is a summary rather than a complete graph. The full graph remains available via `graph --format json`.
7. **W-28 — decide:** raise the `hubMinInDegree` default, or subdivide the role vocabulary, in `synthesize.ts`. If neither, state the coarseness where the `Role` column is documented and record it in [`accepted-behaviors.md`](../accepted-behaviors.md).
8. **Glossary.** The compile/`SKILL.md` and node-role entries describe these outputs; update what changes.

## Out of scope

Changing the token heuristic — [P15.03](03-lint-output-contract.md) owns its disclosure and `AGENTS.md` mandates keeping the arithmetic isolated. Redesigning the compile pipeline: the audit traced its determinism property end to end and it holds.

## Exit criteria

- [x] A large-corpus fixture exists, with a stated node count and a high-in-degree hub, and is reused rather than duplicated by [P15.02](02-graph-output-contract.md).
- [x] At that corpus size, no line in `graph --format human` exceeds a stated width; the four named sections are line-oriented like `top hubs`.
- [x] `json`, `mermaid` and `dot` are asserted byte-identical across two runs and unchanged by this task.
- [x] The MCP `context-graph` text block inherits the fix (it is the same report).
- [x] At 139 documents the compiled `SKILL.md` has a bounded dependency section, no line above a stated cap, and the bound is disclosed in the artifact.
- [x] Two `compile --dry-run` runs remain byte-identical and the content hash remains stable.
- [x] No single role holds a near-majority of the fixture corpus, **or** the coarseness is documented and registered.
- [x] Gates green.

## Implementation notes

**The W-26 fix spans two files, not one.** Deliverable 2 above says the four blob sections are "a consistency fix within one file," `graph-render.ts`. They are not: `clusters`, `reading order` and `excluded from reading order` live there, but `entry points` is emitted by `formatContextGraphSummary` in [`graph/graph-algorithms.ts`](../../../packages/core/src/graph/graph-algorithms.ts), which `renderContextGraphText` embeds. That distinction is load-bearing for the MCP criterion: [`context-graph`](../../../packages/mcp-server/src/tools/context-graph.ts) calls `formatContextGraphSummary` **directly** and never calls `renderContextGraphText`, so "the MCP text block inherits the fix" is satisfiable only by fixing `entry points` in the algorithms module. The two-file span is required, not scope creep.

Two further sites the problem statement's own evidence names but its file list omits, both fixed here for the same reason ("_no_ line exceeds a stated width" is unconditional):

- `coverage:` → `files outside corpus (N): a, b, c` was comma-joined too. The backlog called coverage line-oriented because the field corpus had only 12 such files.
- `renderImpactSummary` carries the identical `reading order` / `excluded from reading order` pair, over a subgraph that is the whole corpus when the changed file is a hub. Fixing three of four instances of one defect would have recreated the inconsistency W-26 is about.
- `renderContextSliceSummary` comma-joined `starts` on one line. `starts` looks like a singleton and is not: an `#anchor`, heading, or ID query resolves to _every_ file carrying that slug, so it grows with the corpus exactly as the four named sections do. `matched: <kind>` is now its own line and `starts (N):` is a list, matching `files (N):` directly below it.

Inside `SKILL.md`, W-27 likewise had three line-shape sites, not one: the `- to:`/`- from:` fan-out, the `Excluded from reading order:` line (3702 characters in the field), and a cycle path. The fan-out bullet keeps the count in the same position in both branches — `- to (0): (none)` rather than `- to: (none)` — so one `^- (to|from) \((\d+)` scan over the artifact sees the empty direction too.

**What the cycle elision costs, and where it is recorded.** Eliding the middle of a long cycle path makes it unreadable from any CLI output: `graph --format json` is `summarizeContextGraph`, which has no `cycles` field, and this task's own constraint is to leave the machine formats byte-identical — [P15.02](02-graph-output-contract.md) owns that contract. The MCP `context-graph` tool's `format: "json"` does return `cycles` in full, and the CLI JSON's edge list is complete, so the cycle is re-derivable rather than gone. Registered in [`accepted-behaviors.md`](../accepted-behaviors.md) and stated in [`context-graph.md`](../../guide/context-graph.md#graph).

**Constants that shipped.** A new [`packages/core/src/render-bounds.ts`](../../../packages/core/src/render-bounds.ts) holds `CYCLE_PATH_HOP_LIMIT` (8) and `formatCyclePath`, shared by both renderers — a helper inside either one would make the other import across a layer it never otherwise crosses. `synthesize.ts` holds `REFERENCE_FANOUT_LIMIT` (10) and `REFERENCE_DOCUMENT_LIMIT` (25). All three are **fixed**, never corpus-relative: a corpus-relative cap cannot be stated in the artifact as a rule a reader can apply — "eight hops" means the same thing in every repository, "one tenth of the nodes" does not — and it would make an already-elided line re-render when an unrelated file is added. Two limits of that property, both stated in [`compile.md`](../../guide/compile.md#the-dependency-section-is-bounded-and-says-so) rather than left for a reader to discover from a diff. It is **not** backward byte-compatibility: the `Refs` column, the always-on disclosure and the one-edge-per-line fan-out change every generated `SKILL.md`'s bytes and content hash once, at any corpus size, so a committed artifact must be regenerated. And `REFERENCE_DOCUMENT_LIMIT` is a top-N _selection_, so adding a well-referenced document elsewhere can evict an existing document's whole entry and move the omitted count.

`REFERENCE_FANOUT_LIMIT` counts edges, not distinct referencing documents, and that is left as it stands: the graph builder keeps one edge per source construct (dedup-with-count is still a G7 backlog item), so deduping here would make the bullet's count and its bullets speak about different units, and the cap's job — a fixed ceiling on the block — is met either way. Registered in [`accepted-behaviors.md`](../accepted-behaviors.md) and stated in [`compile.md`](../../guide/compile.md#the-dependency-section-is-bounded-and-says-so), with `impact <file>` named as the per-file view.

`REFERENCE_DOCUMENT_LIMIT` is the dial the section-share bars were tuned against, and 25 rather than the 40 first proposed: `Document Architecture` is ~32% of the artifact at 139 documents and is legitimately the inventory, so References is the only block with slack. Measured on the fixture: **26 123 bytes** (from 110 789), `Document Dependencies` **62.8%** (from 89.7%), `Document Rules` + `Workflow` **4.0%** (from 0.7%), longest line **122** characters (from 17 530).

**W-28 — accepted, with the rounding-off made visible.** Neither lever works. Raising `DEFAULT_HUB_MIN_IN_DEGREE` leaves `isolated` untouched, and that bucket is a true signal about the corpus rather than an artifact of the threshold; an absolute in-degree threshold cannot be scale-free (3 is right at 10 documents, noise at 1000), and a relative one would make a document's role depend on the rest of the corpus, breaking the local deterministic meaning the option advertises and changing every existing user's content hash. What ships instead is a `Refs (in/out)` column on every `Document Architecture` row, so the row carries the degrees the bucket discards. Registered in [`accepted-behaviors.md`](../accepted-behaviors.md) with the fixture's **measured** histogram (`hub` 73, `isolated` 46, `entry` 11, `bridge` 5, `leaf` 4 — 86% in two buckets, against the field's 83%), which [`large-corpus.test.ts`](../../../packages/core/test/large-corpus.test.ts) asserts so the register row cannot go quietly stale.

**The fixture.** [`packages/core/test/support/large-corpus.ts`](../../../packages/core/test/support/large-corpus.ts) generates the 139 documents and materializes them (plus a config with a `compile` section) on demand. It imports nothing from `../../src`, which is what lets `packages/cli` and `packages/mcp-server` import it directly across the workspace — verified to need no `resolve.alias` — with the graph-dependent helpers isolated in `large-corpus-graph.ts`. It is a plain module rather than a `.test.ts` exporting constants (the P14.03 precedent), because importing a test file re-registers its suites inside the importer. [P15.02](02-graph-output-contract.md) and [P16.01](../P16-release-readiness/01-test-debt.md) should adopt it rather than build a second one; `graph-render.test.ts` pins the `json`/`mermaid`/`dot` digests, and P15.02 is the expected next deliberate updater of the `json` one.

No new `@boundary-guard` category: these are rendering bounds, not a process-boundary class.
