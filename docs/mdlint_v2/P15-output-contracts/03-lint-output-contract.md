# P15.03 · Lint output shapes and the documented message contract

> Phase: [P15 — Output contracts](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-24](../remediation-backlog-2026-08-05.md) (Medium), [W-34](../remediation-backlog-2026-08-05.md) (Medium), [W-35](../remediation-backlog-2026-08-05.md) (Medium, **decision**), [W-36](../remediation-backlog-2026-08-05.md) (Low, **decision**). Sources: audit F17, F31, F18, F22; field F-15 (major). Depends on [P14](../P14-host-boundary/index.md).

## Goal

Make every documented statement about lint output true: the number of JSON shapes, the set of message keys, what `helpUri` holds, what the token number means, and whether two declared metadata fields do anything.

## Problem

**W-24 — two JSON shapes for one lint capability, with core asserting they share one.** [`packages/core/src/engine/format-lint-result.ts`](../../../packages/core/src/engine/format-lint-result.ts) `:5` claims "the JSON shape is the structured contract MCP reuses (P7)". It is not: core wraps `{summary, messages, files}`; MCP `lint-files` returns the raw `LintResult` with `errorCount`/`warningCount`; the ad-hoc MCP `lint` tool assembles a third, narrower shape. So one finding count is `summary.errors` on one host and `errorCount` on the other. Both shapes are recorded, unremarked, in the field test's Phase 3 and Phase 8 — found on both surfaces without either pass flagging the divergence.

**Second site, same contract:** `docs/guide/output.md:17` describes `summary` as counts "and pass/fail". There is no pass/fail field — the keys are `files`, `errors`, `warnings`, and the `files` count is itself undocumented.

**The divergence is defensible; the assertion is not.** MCP consumers want the typed record. `README.md:220` already states the CLI contract correctly, and the sibling difference in `impact` is documented honestly in a table in the shipped skill — that is the model to match.

**W-34 — the token heuristic is undisclosed where the number is reported.** The code is `Math.ceil(text.length / 4)` ([`packages/core/src/engine/tokens.ts`](../../../packages/core/src/engine/tokens.ts) `:5`) — UTF-16 code units, no language term. Two separate gaps:

- **The audit's half:** `docs/guide/concepts.md:38` states the heuristic as `ceil(bytes / 4)`. One wrong site of seven; the other six are right and one warns explicitly that the units diverge for multi-byte content. For CJK, UTF-8 bytes run about 3× characters, so a budget set from that page is off by that factor. A one-word fix.
- **The field test's half:** nothing states the calibration where a user meets the number. `grep -niE 'token' README.md` returns three lines, none of which says how tokens are estimated, and the finding message — `File exceeds tokens warn budget: 14179 tokens` — carries no calibration either. Measured on real data: bytes-per-token ranged **4.03 to 6.83**, and the largest document is **70.3% Cyrillic** (39 852 of 56 714 chars), so the estimate errs **low** — the wrong direction for a budget whose job is preventing context overflow.

**W-35 — message keys and `helpUri`.** `lint --format json` emits `["ruleId","severity","message","filePath","line","column","data","helpUri"]`; `docs/guide/output.md:18` names five. The omitted `data` is exactly why requirement **R3** was accepted — "Enable SARIF + machine action". Separately, `helpUri` holds a **bare rule ID at 27 report sites** and never a URI, and the word appears nowhere in `docs/guide/` despite crossing the MCP wire schema. R3's SARIF rationale cannot be met by a field whose value is not a link.

**W-36 — R6's `docsUrl` and `messages` are vacuous.** `docsUrl` exists at exactly three lines in all of `packages/*/src` (declared, copied, re-declared) and `messages` at exactly one. No built-in sets either; no generator reads either. R6 is therefore true for six of its eight declared metadata fields.

## Deliverables / steps

1. **W-24:** amend the core comment to describe **both** shapes rather than asserting one, and correct `docs/guide/output.md:17`. Document each host's shape where a consumer looks, matching how the shipped skill already handles `impact`'s sibling difference.
2. **W-34 — fix the honesty, not the math.** Correct `concepts.md:38` to characters; state the calibration in `README.md` and in the finding's message. **Do not change the arithmetic in this task** — `AGENTS.md` mandates keeping the heuristic isolated precisely so it can be swapped, and fixing the honesty does not require fixing the math. Weighting by byte length (which the rule already computes one line above for the `bytes` metric) is a separate decision; if it is taken, it is a separate change with its own justification.
3. **W-35 — extend `output.md:18` to the emitted set**, including `data` and the undocumented `files` count from W-24.
4. **W-35 — decide `helpUri`:** populate it with a real documentation URL (the per-rule guide pages already exist, so the mapping is mechanical) **or** rename the field to what it holds. This is a wire-schema-visible change either way — it crosses the MCP `lint-message-schema` — so state the caller-visible consequence.
5. **W-36 — decide:** populate `docsUrl` from the per-rule guide pages and read it in the docs generator (which pairs naturally with W-35's `helpUri` decision, since both are "a rule's documentation URL" and shipping two of those would be the next drift), **or** drop both fields and amend R6.
6. **Regenerate, do not hand-edit.** `schema.json` and the README generated blocks come from `scripts/generate-docs.mjs` against the **built** core; run the build first or the byte-sync tests will fail on stale input.
7. **Glossary.** The `LintMessage`, token-estimation and R6-metadata entries are the ones this touches.

## Out of scope

Replacing the token heuristic with a real tokenizer. Changing `LintResult`'s shape on either host — the divergence is defensible and this task documents it rather than unifying it.

## Implementation notes

**W-35 and W-36 resolved as one field, not two.** `helpUri` is populated from `RuleMetadata.docsUrl`, which `defineRule` fills from the rule's own id by convention (`https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/<ID>.md`). So `docsUrl` is both populated **and** read — by [`rule-docs.ts`](../../../packages/core/src/engine/rule-docs.ts), which now links the README table's rule cell, and by [`run-rules.ts`](../../../packages/core/src/engine/run-rules.ts), which attaches it to every finding — and the product never ships two fields meaning "a rule's documentation URL", which the deliverable named as the next drift. The URL is built by one leaf module, [`rule-docs-url.ts`](../../../packages/core/src/engine/rule-docs-url.ts): it cannot live in `rule-docs.ts`, which imports `rules/index.ts` and would make `registry.ts → rule-docs.ts → rules/index.ts → registry.ts` a cycle.

**`messages` was dropped rather than populated.** Named message templates have no consumer, and inventing one would mean authoring templates across 24 rules — far past this task. R6 is amended in [`02-rules-engine.md`](../requirements/02-rules-engine.md) in the same change, so the requirement now describes seven metadata fields that all do something.

**The rename was rejected on evidence.** `helpUri`'s value was _identical to `ruleId`_ at all 27 sites, so renaming it to `ruleId`-by-another-name ships a field that duplicates one already there — and SARIF's own field is spelled `helpUri`, which is R3's stated rationale for having it. Making it resolve is the change that lets R3 be true.

**Wire-visible consequence.** The MCP [`lint-message-schema`](../../../packages/mcp-server/src/shared/lint-message-schema.ts) **key set is unchanged**; only the value changes (`"REF-001"` → a URL). A caller that read `helpUri` as a rule id silently gets a link. Acceptable to take now — every package is `version: "0.0.0"` and unpublished, and `ruleId` was always the field for the id — and stated for callers in [`output.md`](../../guide/output.md#message-keys) and [`mcp-server.md`](../../guide/mcp-server.md#the-6-tools). The `blob/main` base means a pinned install links to current docs; that is a [register](../accepted-behaviors.md) row, not a silent trade.

**`helpUri` is attached in the runner, not per rule.** The old literals were not merely wrong-valued but inconsistently present: `SEC-003` and `STR-001` set none at all, so five report sites emitted findings with no `helpUri` whatever. Sourcing it from `rule.docsUrl` in one place fixes value and coverage together, and `helpUri` was **removed from `ReportInput`** so a rule structurally cannot re-introduce either defect.

**The task says eight emitted keys; `LintMessage` has ten.** Eight is what one fixture serialized: `endLine` is set by no rule and `fixable` only by TBL-002/SEC-001, so both were absent from that finding. The [message-key table](../../guide/output.md#message-keys) documents all ten with an always-present column, which is a superset of what the exit criterion asks for and the only honest form — a consumer reading the eight-key list would not know `fixable` can appear. `endLine`'s vacancy is a [register](../accepted-behaviors.md) residual.

**W-24 is four payloads, not three.** [`commands.ts`](../../../packages/cli/src/commands.ts) embeds the raw `LintResult` under `impact --format json`'s `lint` key, so the **CLI itself** ships two shapes. That strengthens the finding and is in the guide's host table. Both MCP tools' top-level key sets are now pinned by test ([`lint.test.ts`](../../../packages/mcp-server/test/lint.test.ts), [`lint-files.test.ts`](../../../packages/mcp-server/test/lint-files.test.ts)) and the CLI's by [`lint.e2e.test.ts`](../../../packages/cli/test/lint.e2e.test.ts), so the divergence is a documented decision rather than something a third reader re-discovers.

**W-34: a constant is not arithmetic.** `estimateTokens` is byte-for-byte unchanged. What was added beside it is `TOKEN_ESTIMATE_NOTE`, appended by SIZE-001's `tokens` metric and LLM-001's over-budget finding — the two messages that quote a token count. It lives in `tokens.ts` so a future tokenizer swap moves the disclosure with the math. `bytes`/`lines` findings and LLM-001's missing-import/cycle findings are unchanged: an exact count needs no calibration, and appending one everywhere trains readers to skip the sentence that matters.

**The third surface that quotes a token number was left uncalibrated on purpose.** `compile`'s `Context Budget` block reports a corpus total and each entrypoint's breach, and `synthesize.ts` deliberately mirrors LLM-001's phrasing — so appending the note only in the rule makes that parity approximate. It stays that way: a `SKILL.md` is loaded into an agent's context whole, so a sentence repeated per entrypoint spends the context the block protects, and the note would re-render the bytes and content hash of every committed artifact for a disclosure prose can carry once. The [compile guide](../../guide/compile.md#the-context-budget-numbers-are-estimates) states it instead, and it is a [register](../accepted-behaviors.md) row rather than a latent inconsistency.

**Digest and artifact movement.** `packages/cli/schema.json` came back **byte-identical** (`engine/schema.ts` never reads `docsUrl`), which is the check that the metadata change is confined to documentation surfaces. The README rules block moved for all 24 rows — the id cell is now a link — and [`docs-sync.test.ts`](../../../packages/core/test/docs-sync.test.ts)'s row filter and id extraction were updated to match, plus a new assertion that every row's link is that rule's own page. Those links are **absolute**, not repository-relative, because they come from the same constant `helpUri` does and `helpUri` is consumed outside the repository. A relative spelling for the README alone would be a second string meaning the same page — the drift this task's own constraint forbids — and the README's audience reads it on GitHub, where absolute and relative resolve alike. No `Docs` column was added: the column set is what [`docs-sync.test.ts`](../../../packages/core/test/docs-sync.test.ts) and the shipped fix skill key on.

## Exit criteria

- [x] No source comment claims the two hosts share one lint JSON shape; each host's shape is documented where a consumer looks.
- [x] `docs/guide/output.md:17` no longer promises a `pass/fail` field, and the `files` count is documented.
- [x] Every statement of the token heuristic in the tree agrees with the code (characters, not bytes).
- [x] A reader of a `tokens` finding can learn the calibration without reading source — from `README.md` and from the message itself.
- [x] `output.md:18` names the emitted eight keys.
- [x] `helpUri` either resolves to a real page or is renamed, with the wire-visible consequence stated.
- [x] `docsUrl` and `messages` are populated and read, or dropped with R6 amended.
- [x] Generated `schema.json` and README blocks regenerated from a fresh build; byte-sync tests green.
- [x] Gates green.
