# P12.04 · MCP `lint`: accept custom rules or document the limit

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Finding **OG-1**
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

- [ ] The MCP `lint` custom-rule behavior is decided and consistent across schema, description, and M8.
- [ ] A `custom` entry to `lint` either runs or fails with a clear, documented message.
- [ ] A regression test covers the chosen behavior.
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` green.
