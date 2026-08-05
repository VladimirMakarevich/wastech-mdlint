# P15.03 · Lint output shapes and the documented message contract

> Phase: [P15 — Output contracts](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-24](../remediation-backlog-2026-08-05.md) (Medium), [W-34](../remediation-backlog-2026-08-05.md) (Medium), [W-35](../remediation-backlog-2026-08-05.md) (Medium, **decision**), [W-36](../remediation-backlog-2026-08-05.md) (Low, **decision**). Sources: audit F17, F31, F18, F22; field F-15 (major). Depends on [P14](../P14-host-boundary/index.md).

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

## Exit criteria

- [ ] No source comment claims the two hosts share one lint JSON shape; each host's shape is documented where a consumer looks.
- [ ] `docs/guide/output.md:17` no longer promises a `pass/fail` field, and the `files` count is documented.
- [ ] Every statement of the token heuristic in the tree agrees with the code (characters, not bytes).
- [ ] A reader of a `tokens` finding can learn the calibration without reading source — from `README.md` and from the message itself.
- [ ] `output.md:18` names the emitted eight keys.
- [ ] `helpUri` either resolves to a real page or is renamed, with the wire-visible consequence stated.
- [ ] `docsUrl` and `messages` are populated and read, or dropped with R6 amended.
- [ ] Generated `schema.json` and README blocks regenerated from a fresh build; byte-sync tests green.
- [ ] Gates green.
