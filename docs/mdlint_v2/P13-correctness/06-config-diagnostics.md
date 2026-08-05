# P13.06 · Config diagnostics that name the key

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-12](../remediation-backlog-2026-08-05.md) (High). Sources: audit F13 (MEDIUM), field F-09, F-10 (minor). **Scope is wider than audit F13 states** — see the backlog's Corrections table. Depends on [P12](../P12-consistency/index.md).

## Goal

Make the first error a new user meets say what is wrong. Today the single most likely severity typo produces `- config.rules.0: Invalid input` — naming neither the offending key nor the allowed values — and one of the validator's three diagnostic shapes omits the filename.

## Problem

Three defects in one validator, in [`packages/core/src/config/load-config.ts`](../../../packages/core/src/config/load-config.ts).

**1. Union collapse, on every rule family.** A Zod union failure renders through `formatRootIssue` (`:58`) and collapses to `- config.rules.0: Invalid input`. Verified against the built CLI, four shapes:

| Config | Output |
| --- | --- |
| `{"rule":"REF-001","severity":"warn"}` | `Invalid config at wastech-mdlint.config.json:` / `- config.rules.0: Invalid input` |
| `{"rule":"REF-001","bogusKey":1}` | `Invalid config at wastech-mdlint.config.json:` / `- config.rules.0: Invalid input` |
| `{"rule":"SIZE-001","options":{"maxBytes":10}}` | `Invalid config:` / `- rules[0].options: Unrecognized key: "maxBytes"` |
| `{"includ":[...]}` | `Invalid config at wastech-mdlint.config.json:` / `- config: Unrecognized key: "includ"` |

**Audit F13 bounded this class to custom rules and that bound is wrong.** Its reasoning — "the standard branch is permissive on `options`, so the only entries that can fail _during_ union matching are `custom` ones" — covered `options` and stopped there. In [`config/config-schema.ts`](../../../packages/core/src/config/config-schema.ts), `severity` is a strict `error | warning | off` enum on **both** union branches and `ruleEntrySchema` is `.strict()`, so an invalid `severity` or any unknown key on **any** rule entry fails both branches, collapses to `invalid_union`, and renders through the root formatter. The class is every rule family, and the trigger is `warn` for `warning` — the single likeliest severity typo a first-time user makes. The custom-rule `assert` path F13 documents is one member of this class, not its bound; passing `options.assert` as an array (it is a single object) produced the same bare message.

The mechanism is that a `invalid_union` issue carries the per-branch detail in `issue.errors`, and that is being discarded.

**2. Stage 2 drops the filename.** Stage 1 (`lintConfigSchema.safeParse`) throws `Invalid config at wastech-mdlint.config.json:`; `resolveConfiguredRules` throws `Invalid config:` with no `displayPath`. Worst in the case that needs it most: `README.md` documents that an **ancestor directory's** config can govern a run, so "which file?" is a real question, and the shape that omits it is the one a user hits on a rule-options typo.

**3. Two path notations from one validator:** `config.rules.0` versus `rules[1].options`.

**Requirement impact.** The audit grades requirement **C7** "partially unmet — the standard path is covered; the custom-rule path bypasses the renderer". That verdict is itself wrong in the same way: the standard path is covered for `options` (stage 2) and **uncovered** for `severity` and unknown keys (stage 1). C7's verdict changes with this fix.

## Deliverables / steps

1. **Surface the per-branch detail.** Render union-branch failures through the C7 formatter: discriminate the rule-entry union on `rule: "custom"` before validation **and** surface the issue detail from `issue.errors`, which is currently discarded. Discriminating alone — audit F13's proposed remediation — fixes the custom-options path and leaves `severity` and unknown keys still reporting `Invalid input`, i.e. the paths a built-in-rule user actually hits.
2. **Give stage 2 the `displayPath`** so every diagnostic names the file.
3. **Settle on one path notation** across both formatters, and state which in the guide.
4. **Decide whether to aggregate.** The two stages fail fast independently, so a config with both a shape error and an options error reports only the first, and a user fixing config by trial hits one error per run. Either aggregate across stages or record the choice.
5. **Update the C7 verdict** wherever conformance is recorded, per the requirement-impact note above. Do not leave a graded requirement describing the pre-fix behavior.
6. **Guide.** `docs/guide/configuration.md` / `config-reference.md` should show what a diagnostic looks like now, since the shape is part of the contract C7 accepts.

## Out of scope

The did-you-mean machinery for unknown rule ids — it already works (`Unknown rule "TBL-03". Did you mean "TBL-003"?`) and is the model this task brings to the other paths. Also out of scope: the MCP side of input validation, where the wire schema rejects before the handler runs — that is [P14.05](../P14-host-boundary/05-mcp-error-contract.md) (W-20).

## Exit criteria

- [ ] All four shapes below name the offending key and, for an enum, the allowed values; every message names the file; one notation throughout.

  | Config | Required message content |
  | --- | --- |
  | `{"rule":"REF-001","severity":"warn"}` | the path to `severity`, and `error \| warning \| off` |
  | `{"rule":"REF-001","bogusKey":1}` | the unrecognized key |
  | `{"rule":"SIZE-001","options":{"maxBytes":10}}` | already correct — must not regress |
  | a typo'd key inside a custom rule's `assert` | the key and its location |

- [ ] `options.assert` given as an array produces a diagnostic that identifies the shape problem.
- [ ] Whether the two stages aggregate is decided and implemented or recorded.
- [ ] C7's conformance verdict is updated to describe the fixed behavior.
- [ ] Each shape has a test that fails before the fix.
- [ ] Gates green.
