# P13.06 · Config diagnostics that name the key

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-12](../remediation-backlog-2026-08-05.md) (High). Sources: audit F13 (MEDIUM), field F-09, F-10 (minor). **Scope is wider than audit F13 states** — see the backlog's Corrections table. Depends on [P12](../P12-consistency/index.md).

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

- [x] All four shapes below name the offending key and, for an enum, the allowed values; every message names the file; one notation throughout.

  | Config | Required message content |
  | --- | --- |
  | `{"rule":"REF-001","severity":"warn"}` | the path to `severity`, and `error \| warning \| off` |
  | `{"rule":"REF-001","bogusKey":1}` | the unrecognized key |
  | `{"rule":"SIZE-001","options":{"maxBytes":10}}` | already correct — must not regress |
  | a typo'd key inside a custom rule's `assert` | the key and its location |

- [x] `options.assert` given as an array produces a diagnostic that identifies the shape problem.
- [x] Whether the two stages aggregate is decided and implemented or recorded.
- [x] C7's conformance verdict is updated to describe the fixed behavior.
- [x] Each shape has a test that fails before the fix.
- [x] Gates green.

## Implementation notes

- **What ships, verbatim.** `{"rule":"REF-001","severity":"warn"}` → `Invalid config at wastech-mdlint.config.json:` / `- config.rules[0].severity: Invalid option: expected one of "error"|"warning"|"off"`. `bogusKey` → `- config.rules[0]: Unrecognized key: "bogusKey"`. A typo'd key inside a custom `assert` → two lines, `- config.rules[0].options.assert.columns: Invalid input: expected array, received undefined` and `- config.rules[0].options.assert: Unrecognized key: "colums"`. `options.assert` as an array → `- config.rules[0].options.assert: Invalid input: expected object, received array`. An unknown `assert.kind` → `- config.rules[0].options.assert.kind: Invalid discriminator value. Expected 'requiredColumns' | …` with all 13 kinds. The per-rule stage now carries the filename too, and an ancestor config reports `Invalid config at ../wastech-mdlint.config.json:`. Every string here was read off the built product, not derived: the rendered text comes from Zod's `en` locale and is not worth predicting on paper.
- **The union is discriminated at _render_ time, not before validation — a deliberate departure from step 1's literal mechanism.** Pre-validation dispatch is not expressible here. A real `z.discriminatedUnion("rule", …)` throws `Invalid discriminated union option` for any branch whose discriminator has no finite value set (`zod@4.4.3`, `v4/core/schemas.js:1148`), and `standardRuleEntrySchema`'s `rule` is `z.string()` because C3 accepts `ref-001`/`REF001`. Hand-rolling the dispatch would mean replacing `ruleEntryUnionSchema` with a `superRefine`/`transform` construct, changing the exported schema's runtime type and the inferred `LintConfig` — against this task's own constraint that it changes only how a rejection is reported. So the schema is byte-identical and `ruleEntryBranchIndex` (in `config-schema.ts`, beside the union, so branch order and the rule cannot drift) picks which branch's issues render. **The output is the same either way**: both branches produce the same per-branch issues; dispatch would run one, the renderer selects one.
- **Two imprecisions inherited from audit F13, corrected rather than reproduced.** The task text says discriminating alone "leaves `severity` and unknown keys still reporting `Invalid input`". Under a real pre-validation dispatch that is false — discrimination alone would fix them, because the standard branch's own issues are already precise. What is true is that with the union kept intact, expanding `issue.errors` is what turns the selected branch into text, so both halves are implemented and both are load-bearing _in this design_. The second, already flagged by the backlog's Corrections table: the class is every rule family, not custom rules, which is why the fix is in the shared formatter and not in the custom-rule path.
- **Zod skips the collapse for some shapes, which is why three existing custom-rule tests never moved.** `handleUnionResults` (`schemas.js:1006`) returns one branch's issues directly when exactly one branch is non-aborted. `{"rule":"custom"}`, `{"rule":"custom","severity":"warning"}`, and `{"rule":"custom","options":{…}}` all abort on the custom branch (missing `id` is an aborted `invalid_type`) while the standard branch fails only on the refine (non-aborted), so they render the refine prose today and after — `a "custom" rule entry also requires "id" and "options.assert"`, now at `config.rules[0]`. `{"rule":"custom","id":"REQ-1"}` does go through the union, and now reports `config.rules[0].options: Invalid input: expected object, received undefined` — the custom branch — instead of the standard branch's misleading `Unrecognized key: "id"`.
- **The refine stays load-bearing for _acceptance_ even though it no longer decides rendering.** `ruleEntryBranchIndex` chooses which branch to _report_; the refine is what makes `{"rule":"custom"}` fail the standard branch at all (audit M-3). Dropping it would make that entry a valid standard rule named "custom" again. The two are independent, and the comment in `config-schema.ts` now says so.
- **Branch selection outside `rules[]` is by fewest issues, and that is a fallback, not the mechanism.** Selecting by issue count picks the _wrong_ branch for a custom entry — a typo inside `assert` yields two precise issues on the custom branch and one bogus `Unrecognized keys: "id", "description"` on the standard one — so the discriminator is required, not an optimization. It applies only where the issue path is exactly `["rules", n]`. Everywhere else the schema has no discriminator to consult; today no other union in the root schema reaches that code, since `assertionSchema` is a `z.discriminatedUnion` whose no-match issue carries `errors: []` and a message already listing the allowed `kind`s — the case the flattener passes straight through.
- **`issue.input` could not be used.** Zod v4 strips `input` from public issues unless `reportInput` is set (`v4/core/util.js`, `finalizeIssue`), so `ruleEntryBranchIndex` reads the raw JSONC value by path (`valueAt`) instead. Branch issues carry union-relative paths, so the flattener threads an absolute prefix down its recursion — that is what keeps a nested union's discriminator lookup pointing at the right node rather than at the document root.
- **Why the flattener sits in `config/` and not `engine/`.** No built-in rule's options schema contains a union: across `packages/core/src`, `z.union`/`z.discriminatedUnion` appear only in `config/config-schema.ts` and `engine/primitives/assert.ts`. The per-rule stage therefore has nothing to expand, and lifting `flattenConfigIssues` into `engine/` would be an abstraction ahead of its second caller. Both stages do share `formatConfigIssue`, which is the part that had two implementations.
- **Notation: `config` + `.key` + `[n]`.** Chosen because it left every existing substring assertion green (`config.compile`, `rules[0].options.maxBytes`, `rules[0]: Unknown rule`) while unifying the two shapes; only the four `/config\.rules\.0/` matchers in `rules-custom.test.ts` and one line of `guide/rules/custom.md` carried the old spelling. A shared test helper now asserts `/^- config(\.[A-Za-z_$][\w$]*|\[\d+\])*: /` on every line of every case in the new block, so `rules.0` cannot come back on one path only.
- **No aggregation across stages; recorded, not implemented.** The per-rule stage consumes the root stage's _parsed_ output, so running it on a shape the schema rejected would hand `resolveRule`/`resolveCustomRule` inputs they are not typed for — the crash class audit M-3 closed. Each stage does report all of its own issues at once, so the real bound is **two passes, not one error per run**; both halves are pinned by tests. Row in the [accepted behaviors register](../accepted-behaviors.md), sentence for users in [Validation & errors](../../guide/configuration.md#validation--errors).
- **Verified red before the fix.** Restoring the pre-change `load-config.ts` turns all 10 new cases in `config-v2.test.ts` red and leaves the other 24 in that file green. The no-regression case (`options` unknown key) is among the 10 because the shared helper also asserts the filename header and the new notation — its _content_ requirement was already met and still is.
- **`report.md` was not edited.** [P10.01](../P10-consistency/01-governance-docs.md) states the audit report stays frozen as a historical record and findings are closed in the plan, not there; [P17.06](../P17-plan-of-record/06-register-and-roadmap.md) repeats it. The corrected C7 verdict lands in the two living documents instead — [requirements/01-configuration.md](../requirements/01-configuration.md) and W-12 in the [backlog](../remediation-backlog-2026-08-05.md).
- **No public surface moved.** `ruleEntryBranchIndex` and the new `config-issues.ts` are not re-exported from `packages/core/src/index.ts`; no rule metadata, option schema, or config key changed. `packages/cli/schema.json` hand-builds the `rules` branches (`engine/schema.ts`), so it and the generated README tables are byte-identical and the sync tests did not move. No new runtime dependency. Not one of the four process-boundary guard categories, so no `@boundary-guard` tag — but the CLI's stderr is the real contract for this text, so `packages/cli/test/lint.e2e.test.ts` asserts the severity-typo diagnostic at the host boundary as well.
- **Out of scope, untouched:** `packages/mcp-server/src/tools/lint.ts` formats hints for _tool arguments_ with its own `issue.path.join(".")`, not for a config file; unifying it is [P14.05](../P14-host-boundary/05-mcp-error-contract.md) (W-19/W-20).
