# P11.07 · `custom` without `id` → structured C7 diagnostic, not a crash

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **M-3** ([post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

The most likely custom-rule typo — forgetting `id` — must surface as a clear `CONFIG_INVALID` (C7)
diagnostic, not a bare `TypeError` stacktrace.

## Problem (from the audit)

The union in `packages/core/src/config/config-schema.ts:104-107` is ordered custom-first, but a
`{"rule":"custom"}` entry **without `id`** fails `customRuleEntrySchema` and is then accepted by the
permissive `ruleEntrySchema` (a `custom`-looking rule name is legal). `load-config.ts:122` branches on
`entry.rule === "custom"`, casts, and calls `resolveCustomRule`, which reaches
`canonicalizeRuleId(undefined)` → `rule-id.ts:22` `raw.trim()`:

```
{"rules":[{"rule":"custom"}]}                       → TypeError: Cannot read properties of undefined (reading 'trim')
{"rules":[{"rule":"custom","options":{…}}]}         → same
{"rules":[{"rule":"custom","severity":"warning"}]}  → same
{"rules":[{"rule":"custom","id":"REQ-1"}]}          → correct: ConfigError / CONFIG_INVALID
```

The two-stage validation described at `load-config.ts:150-157` exists precisely so config errors exit
as C7 diagnostics; the likeliest author mistake bypasses it and exits a stacktrace.

## Deliverables / steps

1. Prefer narrowing the union so a `rule:"custom"` entry is **always** routed to
   `customRuleEntrySchema` (e.g. a discriminated union on `rule`, or a `customRuleEntrySchema` that
   is the only member matching `rule:"custom"`), so a missing `id` is a validation error, not a fall
   through to `ruleEntrySchema`. If a discriminator is impractical, validate `id` presence before the
   `resolveCustomRule` cast in `load-config.ts:122`.
2. Ensure the resulting diagnostic is a `ConfigError` / `CONFIG_INVALID` that names the offending
   config path (the C7 contract), consistent with the `{"rule":"custom","id":"REQ-1"}` path today.
3. Tests: each of the three crashing shapes above now yields a `CONFIG_INVALID` with a helpful
   message; the valid `id` case is unchanged.

## Out of scope

Changing what a valid `custom` entry accepts, or the `target` optionality question — that is
[P12.02](../P12-consistency/02-glossary-custom-target.md). This task only closes the crash path.

## Exit criteria

- [ ] `{"rule":"custom"}` (and the `options`/`severity`-only variants) exit as `CONFIG_INVALID`, not `TypeError`.
- [ ] The diagnostic identifies the failing config entry.
- [ ] `{"rule":"custom","id":"REQ-1"}` still loads correctly.
- [ ] Regression tests cover the three previously-crashing shapes.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
