# P11.07 · `custom` without `id` → structured C7 diagnostic, not a crash

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit finding **M-3** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

The most likely custom-rule typo — forgetting `id` — must surface as a clear `CONFIG_INVALID` (C7) diagnostic, not a bare `TypeError` stacktrace.

## Problem (from the audit)

The union in `packages/core/src/config/config-schema.ts:104-107` is ordered custom-first, but a `{"rule":"custom"}` entry **without `id`** fails `customRuleEntrySchema` and is then accepted by the permissive `ruleEntrySchema` (a `custom`-looking rule name is legal). `load-config.ts:122` branches on `entry.rule === "custom"`, casts, and calls `resolveCustomRule`, which reaches `canonicalizeRuleId(undefined)` → `rule-id.ts:22` `raw.trim()`:

```
{"rules":[{"rule":"custom"}]}                       → TypeError: Cannot read properties of undefined (reading 'trim')
{"rules":[{"rule":"custom","options":{…}}]}         → same
{"rules":[{"rule":"custom","severity":"warning"}]}  → same
{"rules":[{"rule":"custom","id":"REQ-1"}]}          → correct: ConfigError / CONFIG_INVALID
```

The two-stage validation described at `load-config.ts:150-157` exists precisely so config errors exit as C7 diagnostics; the likeliest author mistake bypasses it and exits a stacktrace.

## Deliverables / steps

1. Prefer narrowing the union so a `rule:"custom"` entry is **always** routed to `customRuleEntrySchema` (e.g. a discriminated union on `rule`, or a `customRuleEntrySchema` that is the only member matching `rule:"custom"`), so a missing `id` is a validation error, not a fall through to `ruleEntrySchema`. If a discriminator is impractical, validate `id` presence before the `resolveCustomRule` cast in `load-config.ts:122`.
2. Ensure the resulting diagnostic is a `ConfigError` / `CONFIG_INVALID` that names the offending config path (the C7 contract), consistent with the `{"rule":"custom","id":"REQ-1"}` path today.
3. Tests: each of the three crashing shapes above now yields a `CONFIG_INVALID` with a helpful message; the valid `id` case is unchanged.

## Out of scope

Changing what a valid `custom` entry accepts, or the `target` optionality question — that is [P12.02](../P12-consistency/02-glossary-custom-target.md). This task only closes the crash path.

## Exit criteria

- [x] `{"rule":"custom"}` (and the `options`/`severity`-only variants) exit as `CONFIG_INVALID`, not `TypeError`.
- [x] The diagnostic identifies the failing config entry.
- [x] `{"rule":"custom","id":"REQ-1"}` is unchanged — same generic `CONFIG_INVALID` as before; fully valid custom entries (`id` + `options.assert`) still load, per the existing tests.
- [x] Regression tests cover the three previously-crashing shapes.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **Fix**: a new config-only `standardRuleEntrySchema` (`config-schema.ts`) wraps `ruleEntrySchema` with `.refine((entry) => entry.rule !== "custom", ...)`, and `ruleEntryUnionSchema` uses that wrapper instead of `ruleEntrySchema` directly. No entry with `rule:"custom"` can ever fully match the permissive standard branch — it must satisfy `customRuleEntrySchema` or the union fails as a whole. The refine is **not** on the exported `ruleEntrySchema` itself: that schema is also the MCP `lint` tool's public wire schema (`packages/mcp-server/src/tools/lint.ts`, `z.array(ruleEntrySchema)`), which deliberately still accepts a `custom`-looking `rule` there and rejects it later via `resolveRule` as a structured `INVALID_INPUT` tool error — a different, already MCP-tested contract that [P12.04](../P12-consistency/04-mcp-custom-rules.md) decides whether to change. Narrowing `ruleEntrySchema` itself would have silently turned that MCP path into an SDK-level input-validation failure instead. **Superseded in part by [P12.04](../P12-consistency/04-mcp-custom-rules.md)**: the tool's wire schema is now `z.union([customRuleEntrySchema, ruleEntrySchema])` and a valid custom entry runs there, but this reasoning stands unchanged — `ruleEntrySchema` stays permissive as that union's built-in branch so a malformed custom entry still reaches the handler as `INVALID_INPUT`. A `z.discriminatedUnion` was considered and rejected for the union: `ruleEntrySchema.rule` is an open `z.string()` standing in for dozens of runtime-registered built-in IDs, not a compile-time literal enum, so zod's discriminated-union constructor would reject it.
- **No `load-config.ts` change needed**: once stage-1 `lintConfigSchema.safeParse` rejects all three malformed shapes, `resolveRules`/`resolveCustomRule`'s `canonicalizeRuleId(undefined)` crash path becomes unreachable, not just handled.
- **Message quality**: for `{"rule":"custom"}` (and the `options`/`severity`-only variants), `customRuleEntrySchema` has a hard `id`-required issue (aborted) while `standardRuleEntrySchema` has exactly one soft refine issue (not aborted per zod's `continue: true` semantics for `.refine()`), so zod's union resolution surfaces the refine's own message directly — tests assert on that substring plus the `config.rules.0` path, and on `ConfigError`/`CONFIG_INVALID`, not a bare message regex. The pre-existing `{"rule":"custom","id":"REQ-1"}` (no `options`) shape aborts on both union members (`customRuleEntrySchema`'s missing-`options`, and `standardRuleEntrySchema`'s hard `unrecognized_keys` on `id`, which also short-circuits the refine — zod skips checks once the base parse has aborted), so it falls back to the same generic wrapped message as before — unchanged, and now covered by an explicit regression test.
- Four new tests added to `packages/core/test/rules-custom.test.ts`; no changes needed in `load-config.ts`, `rule-id.ts`, `engine/schema.ts`, or the generated `packages/cli/schema.json` (the JSON-Schema generator builds the `rules[]` branches by hand and never calls `z.toJSONSchema` on `ruleEntrySchema`/`ruleEntryUnionSchema`).
