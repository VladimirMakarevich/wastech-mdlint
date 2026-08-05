# P14.01 · A nonexistent `cwd` silently succeeds on five MCP tools

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-18](../remediation-backlog-2026-08-05.md) (High). Sources: audit F3 (MED-HIGH, reproduced over real stdio across all five tools). Depends on [P13](../P13-correctness/index.md). Blocks [P14.05](05-mcp-error-contract.md).

## Goal

Give the MCP server the input guard the CLI already has: a `cwd` that does not exist as a directory must be rejected with `INVALID_INPUT`, not answered with an empty success.

## Problem

Five MCP tools accept `cwd` as a raw optional string and hand it to core unvalidated. The terminating behavior in core is a **silent empty map** for a root that does not stat as a directory ([`packages/core/src/markdown/load-documents.ts`](../../../packages/core/src/markdown/load-documents.ts) around `:134`), and core pins that as intentional in its own test — which is precisely why the guard belongs at each host boundary rather than in core.

**The CLI has the guard and names this exact defect class in its rationale:** "indistinguishable from a clean repository (M-7)" ([`packages/cli/src/program.ts`](../../../packages/cli/src/program.ts) `:103`), exit `2`. Inside the same MCP helper a bad `configPath` **is** caught; only the root is unchecked.

**How each tool fails, reproduced over real stdio:**

| Tool | Response to a nonexistent `cwd` |
| --- | --- |
| `lint-files` | `No problems found.` |
| `context-graph` | an empty success |
| `context-slice` | `No match for query "x"` — indistinguishable from a real miss |
| `impact-analysis` | `File not found in the context graph` — misattributes the cause |
| `compile-context` | a missing-compile-config error |

The third and fourth are the worst shapes: they are plausible answers to a different question.

**Four sites, not one.** `cwd ?? process.cwd()` is recomputed outside the shared resolver. Verified in the tree, the default appears at [`shared/tool-context.ts`](../../../packages/mcp-server/src/shared/tool-context.ts) `:27` and `:52`, [`tools/lint-files.ts`](../../../packages/mcp-server/src/tools/lint-files.ts) `:61`, and [`tools/compile-context.ts`](../../../packages/mcp-server/src/tools/compile-context.ts) `:38`. Both tool modules document the duplication in place, and `tool-context.ts:20` states that owning the fallback centrally "is the whole point of the shared helper" — which the line's four occurrences contradict. **Guarding only the resolver leaves `lint-files` and `compile-context` still returning silent success.**

## Deliverables / steps

1. **Prefer making the resolver the single entry point first.** Have it return the resolved `cwd` so the two tool modules stop recomputing the default, then land one stat-and-reject inside it. This closes the finding and the duplication the invariant-2 review named, in one change.
2. **If the resolver cannot own all four**, land the stat-and-reject at each of the four sites above rather than only in the helper — and say why in place, so the next reader does not remove three of them as redundant.
3. **Surface `INVALID_INPUT`**, the code already in the closed `TOOL_ERROR_CODES` set for exactly this, with a message naming the path and a `hint` where one helps. Do **not** invent a new code here; the operational-code question is [P14.05](05-mcp-error-contract.md)'s.
4. **Test over real stdio, all five tools.** An in-process test that calls the handler directly can pass with the defect present, because the shape being fixed is what a spawned server returns to a client. Reuse the existing stdio integration harness.
5. **Note the caller-visible consequence in the change:** previously-successful calls now fail. That is the correct direction and it is a behavior change an agent may be relying on.
6. **Glossary.** The **six tools** and **Error contract** entries describe the MCP surface; extend whichever this changes.

## Out of scope

Validating `cwd` inside core. Core's silent-empty behavior is pinned as intentional and two other callers depend on it; re-litigating that is not this task. Also out of scope: the text-vs-`structuredContent` rendering of the new rejections — [P14.05](05-mcp-error-contract.md) owns that, and this task should simply not make it worse.

## Exit criteria

- [ ] All five file-based tools reject a nonexistent `cwd` with `INVALID_INPUT` over real stdio, asserted per tool.
- [ ] `cwd ?? process.cwd()` appears in one place, or each remaining site carries the reason it is not the resolver's.
- [ ] A `cwd` that exists but is a **file** rather than a directory is rejected the same way.
- [ ] The existing `configPath` guard still works — no regression from the refactor.
- [ ] The change states the caller-visible consequence.
- [ ] Gates green.
