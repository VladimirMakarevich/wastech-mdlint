# P14.01 · A nonexistent `cwd` silently succeeds on five MCP tools

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-18](../remediation-backlog-2026-08-05.md) (High). Sources: audit F3 (MED-HIGH, reproduced over real stdio across all five tools). Depends on [P13](../P13-correctness/index.md). Blocks [P14.05](05-mcp-error-contract.md).

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

- [x] All five file-based tools reject a nonexistent `cwd` with `INVALID_INPUT` over real stdio, asserted per tool. — `stdio-integration.test.ts`, one `it` looping the five tools with the minimum arguments each `inputSchema` requires, through `expectToolError` (which also pins `message` and a non-empty `hint`). Confirmed red against the pre-fix `dist/`.
- [x] `cwd ?? process.cwd()` appears in one place, or each remaining site carries the reason it is not the resolver's. — one place: `resolveToolCwd` in `shared/tool-context.ts`. The other three sites are gone; `resolveToolConfiguration` returns the resolved `cwd` and the two tool modules read it back. `resolveToolContext` pins the de-duplication with its own test.
- [x] A `cwd` that exists but is a **file** rather than a directory is rejected the same way. — second stdio `it` over the same five tools, plus the resolver's own unit case.
- [x] The existing `configPath` guard still works — no regression from the refactor. — the two `resolveConfigPath` tests are untouched and green; `resolveConfigPath` itself is unchanged (P14.04 depends on it).
- [x] The change states the caller-visible consequence. — first implementation note below, and the [MCP guide](../../guide/mcp-server.md)'s error-contract section for users.
- [x] Gates green. — `build`, `typecheck`, `test` (946 → 958 passing), `lint`, `format`.

## Implementation notes

- **Caller-visible consequence, stated plainly: previously-successful calls now fail.** A `cwd` that does not exist or is not a directory used to return `No problems found.` (`lint-files`), an empty graph (`context-graph`), `No match for query "…"` (`context-slice`), `File not found in the context graph` (`impact-analysis`), or a `COMPILE_CONFIG_MISSING` error (`compile-context`). All five now return `INVALID_INPUT`. An agent relying on any of those shapes breaks — and that is the correct direction, because four of the five were plausible answers to a different question and the fifth named the wrong cause.
- **The resolver took all four sites (deliverable 1), so deliverable 2's per-site comments were not needed.** `resolveToolCwd` computes the fallback, resolves, stats and rejects; `resolveToolConfiguration` returns `LoadedConfiguration & { cwd }`; `resolveToolContext` reuses that instead of recomputing; `lint-files` and `compile-context` read `loaded.cwd`. Neither core type carries a `cwd` key, so the widening collided with nothing. `tools/lint.ts`'s `rootDir: process.cwd()` is deliberately **out of scope and left alone**: that tool has no `cwd` input, so there is nothing caller-supplied to validate — its comment now says that rather than citing the old duplicated default.
- **A bad `cwd` pre-empts `CONFIG_NOT_FOUND`.** `resolveToolCwd` runs before `loadConfiguration`, so a `configPath` under a nonexistent root reports the root, not the config. Checking second would have named the wrong cause; a test pins the ordering.
- **Non-`ENOENT`/`ENOTDIR` errnos still reach `INTERNAL_ERROR`, deliberately.** The errno split mirrors the CLI's `resolveDirectoryArgument` exactly, including its stated rationale: `EACCES`, `ELOOP` and friends are a _different_ operational failure and must not be misreported as bad input. Making that path actionable is [P14.05](05-mcp-error-contract.md)/W-21's operational-code question, not this task's — no code was invented here.
- **The message names the resolved absolute path, not the caller's string.** The CLI renders repo-relative because it has a known-good `cwd` to anchor against; here the `cwd` _is_ the anchor and it is the broken thing, so a relative form would have nothing to mean. The value is derived from caller input and is exactly what was `stat`ed, so it leaks no unrelated host state. The `hint` is always supplied (omit `cwd`, or pass an absolute path), which is also what the stdio harness's non-empty-`hint` assertion requires.
- **`ToolInputError` moved to `shared/tool-input-error.ts`.** It was local to `tools/lint.ts` with a comment saying so because there was one call site; the guard is the second. Still a host-boundary class, still not promoted to core — the comment says exactly that now.
- **The guard runs even when `cwd` is omitted.** One code path, no `input.cwd !== undefined` branch: one `stat` against a full corpus walk is not worth the branch, and a server whose own working directory has gone away is a real failure worth naming.
- **Equivalence checked, not assumed.** Passing the _resolved_ absolute `cwd` into core changes nothing downstream: `loadConfiguration` resolves `explicitConfigPath` with `path.resolve`, and `loadContext`, `loadDocuments` and `compileContext` each `path.resolve(cwd)` themselves.
- **Tagged `installed-bin-spawn`.** `stdio-integration.test.ts` joins the [process-boundary guard](../../../.agents/rules/testing.md) inventory for that category, per the backlog's standing rule. It proves the boundary — what a client actually receives — not the `argv[1]`-vs-symlink half, which `bin-entrypoint.test.ts` keeps; the tag comment says so. The in-process cases in `lint-files.test.ts` / `compile-context.test.ts` are fast feedback on the two refactored modules, not the acceptance evidence.
