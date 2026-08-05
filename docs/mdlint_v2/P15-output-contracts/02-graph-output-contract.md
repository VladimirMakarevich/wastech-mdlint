# P15.02 · Graph output: coverage, format parity, one vocabulary

> Phase: [P15 — Output contracts](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-22](../remediation-backlog-2026-08-05.md) (Medium), [W-23](../remediation-backlog-2026-08-05.md) (Medium), [W-25](../remediation-backlog-2026-08-05.md) (Low). Sources: audit F11 (MEDIUM) and field F-25 (minor) — reproduced identically and independently on both hosts; field F-20, F-12. Depends on [P14](../P14-host-boundary/index.md).

## Goal

Make `--format json` denote one document, make the graph's best diagnostic reachable from both hosts and documented on the surfaces that describe it, and settle whether one product needs three words for "plain text".

## Problem

**W-22 — three problems in one output.**

1. **`coverage` is a shipped fifth key documented on none of five surfaces**, all of which say four: `README.md:73`, `docs/guide/cli.md:67`, `docs/guide/context-graph.md:39`, the **`graph`** entry in [`glossary.md`](../glossary.md) (which assigns coverage to the human format only — the backlog cites it as `:204`, correct at the audited commit and since shifted, so find it by entry name), and the authoritative task file `P4-graph/07-cli-graph-slice-impact.md:17`. Under the stated precedence the task file outranks the rest, so it is the primary site.
2. **It is unreachable from MCP in either format**, though the CLI states in place that JSON consumers "must see `filesOutsideCorpus` too" ([`packages/cli/src/commands.ts`](../../../packages/cli/src/commands.ts) around `:228`). The field test called `coverage.filesOutsideCorpus` the single best diagnostic in the graph report — and it is exactly [P14.03](../P14-host-boundary/03-init-disclosure.md)'s evidence, listing 12 linked-but-unlinted files.
3. **`format: "json"` denotes different documents on the two hosts.** Reproduced byte-identically by both assessments:

| Surface | Accepted values | `json` returns |
| --- | --- | --- |
| CLI `graph` | `human`, `json`, `mermaid`, `dot` | `nodes, edges, components, readingOrder, coverage` |
| MCP `context-graph` | `json`, `summary` | `nodes, edges, cycles` |
| MCP `context-graph` `summary` | — | `nodes, edges, components, readingOrder` (the CLI's `json` minus `coverage`) |

`format: "mermaid"` and `"human"` — both valid on the CLI's `graph` — are rejected by the MCP tool.

**The split is deliberate and honestly explained in place.** [`tools/context-graph.ts`](../../../packages/mcp-server/src/tools/context-graph.ts) `:50-54` documents the two shapes and the constraint: `registerTool` takes a single `outputSchema`, so the format-specific fields are individually optional — a superset schema rather than a discriminated union, which would require echoing a `format` field neither core type carries. **What is not defensible is reusing the word `json` for a different document than the CLI's.**

**W-23 — `excluded from reading order` exists only in the human format.** The human report prints `excluded from reading order (73): …`; the JSON has top-level keys `nodes, edges, components, readingOrder, coverage`, and `coverage` holds only `nodeCount, edgeCount, filesOutsideCorpus`. There is no `excluded` field, so a machine consumer must derive it as `nodes` minus `readingOrder`. 73 of 139 nodes — including all of the substantive documentation directories — is a large enough share that a reader will ask why, and neither format answers. Note that MCP `impact-analysis` **already exposes** `excluded` in its structured output, so the field name and shape exist in the product.

**W-25 — `--format` vocabulary differs across CLI commands.** `graph` accepts `human | json | mermaid | dot` (default `human`) and rejects `text`; `lint`/`slice`/`impact` accept `text | json` (default `text`) and reject `human`. Both rejections exit `2` and name the valid choices, and `README.md:62-65` documents the split faithfully — so this is **loud, not silent**, hence Low. It is still a paper cut: one flag name meaning different things on sibling commands. W-22 supersedes it in scope — the problem is three vocabularies, not two.

## Deliverables / steps

1. **W-22 — pass coverage in the MCP tool** ([`tools/context-graph.ts`](../../../packages/mcp-server/src/tools/context-graph.ts)) and add it to that tool's output schema, honoring the superset-schema constraint the comment explains.
2. **W-22 — settle the `json` collision.** Either rename MCP's raw shape (`raw`?) or make MCP `json` mean what CLI `json` means. Renaming is the smaller change and the honest one, since the raw graph is a genuinely different document; either way the source comment at `:50-54` must end up describing what ships.
3. **W-22 — document the fifth key on all five surfaces**, starting with the authoritative task file, and fix the glossary's claim that coverage belongs to the human format only.
4. **W-23 — expose the excluded set in JSON**, matching `impact-analysis`'s existing `excluded` field name and shape rather than inventing a second one. Ideally state **why** a node is excluded; if that is more than a small change, expose the set now and record the "why" as follow-up rather than shipping neither.
5. **W-23 — assert parity by test**, not by inspection: a test that reads both formats from one graph and compares the sets is what stops the next divergence.
6. **W-25 — decide:** accept both words on both commands, or rename one, in [`packages/cli/src/program.ts`](../../../packages/cli/src/program.ts). If the split stays, say in the guide that it is deliberate — `README.md` already documents it faithfully, so only the intent is missing.
7. **Reuse [P15.01](01-renderers-at-scale.md)'s large fixture** rather than building a second one. The parity assertions in steps 4–5 want a graph big enough to have an excluded set, which is the same fixture P15.01 generates and [P16.01](../P16-release-readiness/01-test-debt.md) adopts; whichever of the two tasks lands first owns building it.
8. **Glossary.** The graph-summary and coverage entries are the ones to update, in this change.

## Out of scope

The human format's line shape — that is [P15.01](01-renderers-at-scale.md), which touches the same renderer file. Coordinate the two rather than merging them.

## Exit criteria

- [ ] `coverage` is reachable from MCP in the documented format(s) and appears in that tool's output schema.
- [ ] One format name denotes one shape across CLI and MCP; the source comment at `context-graph.ts:50-54` describes what ships.
- [ ] All five surfaces document the fifth key, including the authoritative `P4-graph/07-cli-graph-slice-impact.md` and the glossary.
- [ ] Both graph formats carry the excluded set, using `impact-analysis`'s existing field name, with parity asserted by a test — on [P15.01](01-renderers-at-scale.md)'s fixture, not a duplicate of it.
- [ ] One word means "plain text for a human" across the CLI, or the split is documented as deliberate.
- [ ] Gates green.
