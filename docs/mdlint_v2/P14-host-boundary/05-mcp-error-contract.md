# P14.05 · MCP error-contract parity and the operational code

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-19](../remediation-backlog-2026-08-05.md) (Medium), [W-20](../remediation-backlog-2026-08-05.md) (Medium, **decision**), [W-21](../remediation-backlog-2026-08-05.md) (Medium, **decision**). Sources: field F-24, F-26; audit F19. Depends on [P14.01](01-mcp-cwd-validation.md).

## Goal

Make the MCP error surface carry, on every path, what the CLI already tells a user: the actionable sentence, a machine-readable code, and enough detail to act. Three defects, one contract — and two of them are decisions the taxonomy's own closed-set rule cannot resolve locally.

## Problem

**W-19 — the text block drops the `hint`.** On an unknown rule id, `structuredContent` carries the full contract (`code: "INVALID_INPUT"`, `message: 'Unknown rule "REF-01".'`, `hint: 'Did you mean "REF-001"?'`) but `content[].text` is only `Unknown rule "REF-01".` The CLI on the same typo prints `- rules[0]: Unknown rule "REF-01". Did you mean "REF-001"?` The text block is what a host renders and what a model reads, and the dropped sentence is the actionable half.

**It is an asymmetry, not a global rule** — verified by asserting `text.includes(structuredContent.hint)` across the error paths: `compile-context`/`COMPILE_CONFIG_MISSING` **yes**, `impact-analysis`/`TARGET_NOT_FOUND` **yes**, `lint`/`INVALID_INPUT` **no**. So the fix is local, in [`packages/mcp-server/src/tools/lint.ts`](../../../packages/mcp-server/src/tools/lint.ts) or the shared error wrapper. The `hint` is legitimately conditional: an unknown rule with no near-miss (`NOPE-999`) returns `{code, message}` only.

**W-20 — schema-level rejections bypass the contract entirely.** Any argument the tool's own `inputSchema` rejects returns `isError: true`, **no `structuredContent` at all**, and raw transport text: `MCP error -32602: Input validation error: Invalid arguments for tool context-slice: Too small: expected number to be >=0 at depth`. No `code`, no `hint`, and the `-32602` prefix leaks transport detail into user-facing text.

The field test's verdict: **acceptable to a human, useless to a program.** The message names the offending field (`at depth`, `at format`) and the constraint or valid set (`>=0`, `expected one of "json"|"summary"`), which is better than most validation errors — a human or a model reading the text can fix the call. But a host that branches on `code`, or surfaces `hint`, sees nothing.

**The mechanism is already written down in the tree**, at [`packages/core/src/config/config-schema.ts`](../../../packages/core/src/config/config-schema.ts) `:77-79`, three lines above the `ruleEntrySchema` declaration: the SDK validates tool input before the handler runs, so a rejected entry "would come back as raw InvalidParams text with no structuredContent instead of the M6 `{ code, message, hint }` payload". The [`glossary.md`](../glossary.md) **Error contract** entry states the same bound. So this is a known, recorded gap that has never been decided.

**W-21 — no operational error code.** Against one fixture (a directory `chmod`'d `000`): the CLI prints `Operational error: EACCES on docs/locked` and exits `2` — errno plus a normalized path. MCP `lint-files` returns `INTERNAL_ERROR` and "An unexpected internal error occurred." — no path, no errno, which is the whole actionable content.

**The conformant part:** `INTERNAL_ERROR` is what the taxonomy specifies for an unexpected throwable. What no document records is that the closed set has **no operational-error code at all**, so nothing will ever flag the asymmetry. `docs/guide/output.md:35` describes operational failures in CLI terms only. Widening `isStructuredError` to duck-type errno errors is explicitly the **wrong** fix and [`packages/core/src/errors.ts`](../../../packages/core/src/errors.ts) `:32` says why.

## Deliverables / steps

1. **W-19:** concatenate the `hint` into the text on the `lint`/`INVALID_INPUT` path, preferably in the shared error wrapper so a future path cannot regress. Assert `text.includes(hint)` for **every** error path that carries one — conditionally, since the `hint` is optional by design.
2. **W-19 — cover the rejections [P14.01](01-mcp-cwd-validation.md) adds.** Those are new `INVALID_INPUT` paths; they must satisfy this assertion from the day they land, which is why P14.01 comes first.
3. **W-20 — decide:** pre-validate inside the handler so the contract owns every path (the tool's wire schema then has to accept every shape it wants to reject with a proper payload — the glossary already states this consequence), **or** document that schema rejections are contract-exempt, with a register row plus a line in the guide where the contract is documented. Note that direction one is a real design change: loosening `inputSchema` to permit a shape only so the handler can reject it better is a trade, not a free win.
4. **W-21 — decide, and it cannot be closed locally:** add an operational code to `TOOL_ERROR_CODES` **and amend the decision entry** at `docs/mdlint_v2/decisions/pre-implementation-decisions.md:57` in the same change, as that log's own honesty rule requires; **or** keep the closed set and register the asymmetry. Either way `docs/guide/output.md:35` stops describing operational failures in CLI terms only.
5. **State the caller-visible consequence.** A host matching on `INTERNAL_ERROR` breaks if a new code is introduced. Say so in the change, as [P14.01](01-mcp-cwd-validation.md) does for its own.
6. **Glossary.** The **Error contract** entry lists the closed code set and states the pre-handler-validation bound. Whatever these three decisions produce, that entry is where it lands.

## Out of scope

Duck-typing errno errors into `isStructuredError` — ruled out with the reason in code. Adding mutating MCP tools or a non-stdio transport: outside the v2 security boundary.

## Exit criteria

- [ ] A test asserts `text.includes(hint)` for every MCP error path that carries a `hint`, including the paths P14.01 added.
- [ ] `lint` with an unknown rule id renders the did-you-mean in `content[].text`.
- [ ] Either every failure path carries `{code, message}`, or the schema-rejection exemption is stated in [`accepted-behaviors.md`](../accepted-behaviors.md) **and** where the contract is documented.
- [ ] The operational-error asymmetry is closed in `TOOL_ERROR_CODES` — with the decision entry amended in the same change — or registered.
- [ ] `docs/guide/output.md` describes operational failures on both hosts.
- [ ] The glossary's **Error contract** entry matches what shipped.
- [ ] The change states which callers break.
- [ ] Gates green.
