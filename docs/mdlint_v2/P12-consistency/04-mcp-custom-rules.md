# P12.04 · MCP `lint`: accept custom rules or document the limit

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Finding **OG-1**
> ([`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md), Low, needs
> confirmation → maintainer decision).

## Goal

The MCP `lint` tool's custom-rule behavior must match requirement **M8**. Today the ad-hoc `lint` tool
rejects declarative `custom` rules with an unexplained schema error, and its description is silent
about it.

## Problem (from the audit)

The ad-hoc `lint` tool validates `rules` as `z.array(ruleEntrySchema)`
(`packages/mcp-server/src/tools/lint.ts:44`) — the **built-in-only** entry — so a
`{ "rule":"custom", … }` entry is rejected, and the description (`lint.ts:194`) does not disclose the
limitation. Requirement M8 states the MCP server "executes **declarative custom rules** (pure data)
but never loads Tier-2 code-plugins"
([`requirements/05-mcp-server.md:55`](../requirements/05-mcp-server.md), table row `:20`). The full
`lint-files` path honors custom rules via loaded config; only the ad-hoc `lint` tool narrows them out
— a thin-adapter surface diverging from the requirement. Likely an intentional narrowing (ad-hoc lint
takes an explicit built-in set), but it is undocumented, so `p9-09` recorded it as _needs
confirmation_.

## Deliverables / steps

Decide the intent (maintainer call), then make the requirement, the schema, and the description agree:

- **(A) Widen** the `lint` input schema to accept the custom-rule union (`ruleEntryUnionSchema`), so
  an agent can run a one-off declarative `custom` assertion through `lint` — matching M8's letter.
- **(B) Document the limit** — state in the tool description that ad-hoc `lint` is built-in-rules-only
  and that declarative `custom` rules run through `lint-files`; then reconcile M8's wording so "the
  server executes custom rules" is scoped to the `lint-files` path.

Whichever is chosen, add a test: a `custom` entry to `lint` either runs (A) or returns a clear,
documented "use `lint-files`" error (B) — not an opaque schema-validation failure.

## Out of scope

The `SEC-003` containment / description-honesty work — that is
[P11.02](../P11-remediation/02-sec003-path-escape.md). No change to `lint-files`, which already honors
custom rules.

## Exit criteria

- [x] The MCP `lint` custom-rule behavior is decided and consistent across schema, description, and M8.
- [x] A `custom` entry to `lint` either runs or fails with a clear, documented message.
- [x] A regression test covers the chosen behavior.
- [x] `npm run typecheck && npm run lint && npm test && npm run build` green.

## Implementation notes

- **Direction (A), widen — and (B) was dominated, not merely less attractive.** The MCP SDK
  `safeParseAsync`s a tool's `inputSchema` **before** the handler runs and raises
  `McpError(ErrorCode.InvalidParams, "Input validation error: …")`. Verified at the wire: the caller
  gets an `isError` result whose only content is that raw text and whose `structuredContent` is
  `undefined` — the M6 `{ code, message, hint }` payload never happens. `ruleEntrySchema` is
  `.strict()`, so a real custom entry's `id`/`target` keys died at the wire; (B) could not have
  produced its own required "clear, documented message" without widening the schema anyway. The
  general lesson: **an MCP tool's wire schema must accept every shape it wants to reject with a good
  message.**
- **Composed union, not `ruleEntryUnionSchema`.** The deliverable named `ruleEntryUnionSchema`;
  using it would have been a regression. Its standard branch is `standardRuleEntrySchema`, which
  `.refine()`-rejects `rule: "custom"`, so a malformed `{ "rule": "custom" }` would fail the whole
  union at the wire — exactly what
  [P11.07](../P11-remediation/07-custom-missing-id.md)'s note warned about. The tool composes
  `z.union([customRuleEntrySchema, ruleEntrySchema])` from two exported core schemas instead
  (custom-first, so the strict built-in branch does not reject a custom entry's extra keys). This is
  schema composition, not a forked pipeline: core still owns custom-rule semantics via
  `resolveCustomRule`.
- **Deliberate asymmetry: config fails closed, the tool fails in the handler.** Config load must
  reject a typo'd custom rule outright (it must never lint as something else); the tool must let it
  through the wire so the failure carries the M6 contract. `handleLint` therefore re-validates with
  `customRuleEntrySchema.safeParse` rather than casting — `entry.rule === "custom"` does not narrow
  `RuleConfigEntry` away, since its `rule` is an open `z.string()`. That re-validation also closes
  P11.07's `canonicalizeRuleId(undefined)` crash at this boundary independently of the wire schema,
  which matters because `handleLint` is exported and called directly by tests.
- **Two different error shapes for two different mistakes.** A built-in rule's `options` is
  `z.unknown()` at the wire, so bad options are a _semantic_ failure resolved inside the handler and
  reported as M6 `INVALID_INPUT`. A custom entry's `options.assert` is a strict discriminated union
  at the wire, so a misspelled `kind` is a _shape_ failure rejected as `InvalidParams` like any other
  malformed argument (that message does name the valid discriminator values, so it is not opaque).
  Only the `{ rule: "custom" }`-shaped mistakes that the permissive branch still accepts reach the
  handler — which is the set that needed the guided message.
- **`content.md` file-scope caveat.** Ad-hoc lint parses one synthetic document at `content.md`, so
  an `options.files`/`exclude` glob that does not match that path selects nothing, and the one
  project-scope assert (`columnUnique`) over a corpus of one can only see duplicates _within_ the
  submitted content. Both are now stated in the tool description and the MCP guide, and pinned by
  tests.
- **P11.02 containment untouched.** The only filesystem-touching assertion primitives are
  `linkResolves`/`imageResolves`, which `REF-001`/`REF-003` already expose through this tool and
  which are already guarded by `candidateEscapesRoot`; they probe paths derived from caller
  `content`, not from rule options. Caller-supplied regex was already reachable via built-in pattern
  options. Widening the schema adds no new attack surface.
- **Tests.** `test/lint.test.ts` replaces the old "rejects a `custom` rule request" pin with six
  cases (document-scope run, `severity` override, project-scope `columnUnique`, malformed entry →
  guided `INVALID_INPUT`, reserved-prefix id, `files`-glob miss). `test/smoke.test.ts` asserts the
  advertised `inputSchema` actually carries the custom branch — the standing guard that
  `assertionSchema` still converts to JSON Schema at `listTools` (it does; `.refine()` checks are
  dropped and nothing unrepresentable is in the vocabulary), at the cost of ~4 KB of inline schema
  per handshake. `test/stdio-integration.test.ts` proves both directions at the wire, including that
  the malformed entry returns the M6 payload rather than an `McpError`.
- **No `lint-files`, core-schema, or `schema.json` change.** Only `ruleEntrySchema`'s explanatory
  comment changed in core; the generated `packages/cli/schema.json` is byte-identical, and the
  README MCP tool inventory was regenerated (never hand-edited) for the new description.
