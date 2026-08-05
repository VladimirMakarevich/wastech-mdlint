# P15.01 · Renderers at real scale

> Phase: [P15 — Output contracts](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-26](../remediation-backlog-2026-08-05.md) (High), [W-27](../remediation-backlog-2026-08-05.md) (High), [W-28](../remediation-backlog-2026-08-05.md) (Medium, **decision**). Sources: field F-19 (minor, raised), F-21 (major), F-22 (minor). Depends on [P14](../P14-host-boundary/index.md).

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

- [ ] A large-corpus fixture exists, with a stated node count and a high-in-degree hub, and is reused rather than duplicated by [P15.02](02-graph-output-contract.md).
- [ ] At that corpus size, no line in `graph --format human` exceeds a stated width; the four named sections are line-oriented like `top hubs`.
- [ ] `json`, `mermaid` and `dot` are asserted byte-identical across two runs and unchanged by this task.
- [ ] The MCP `context-graph` text block inherits the fix (it is the same report).
- [ ] At 139 documents the compiled `SKILL.md` has a bounded dependency section, no line above a stated cap, and the bound is disclosed in the artifact.
- [ ] Two `compile --dry-run` runs remain byte-identical and the content hash remains stable.
- [ ] No single role holds a near-majority of the fixture corpus, **or** the coarseness is documented and registered.
- [ ] Gates green.
