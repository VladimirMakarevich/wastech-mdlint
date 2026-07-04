# Phase P3 — The 22 built-in rules + LLM rules + custom rule

> Roadmap: [v2 Index](../index.md) · Phase **P3** · Size **L** · Status **Done** ·
> **Milestone M2 — lint parity+.**
>
> **Goal:** implement all 22 built-in rules as presets over the [P2 primitives](../P2-rule-engine/02-assertion-primitives.md),
> add the preserved **LLM rules** ([D3](../index.md)), expose the **declarative `custom`
> rule** ([R9](../requirements/02-rules-engine.md)), and close out the `scan → lint` cutover.
> After this phase the tool is a complete, usable linter.

## Why this phase exists

P2 built the engine; P3 delivers the actual checks. Built-ins are thin presets over the
shared primitive vocabulary, so the work is mostly metadata + option schemas + fixtures, not
new algorithms. See the [rules requirements](../requirements/02-rules-engine.md).

## Tasks

| # | Task | Rules | Depends on |
| --- | --- | --- | --- |
| [P3.01](01-shared-rule-utils.md) | Shared rule utils | glob-match, find-line-number, extract-section-body, regex-string, site-router | P2 done |
| [P3.02](02-tbl-rules.md) | Table rules | TBL-001…006 | P3.01 |
| [P3.03](03-sec-str-rules.md) | Section + structure rules | SEC-001/002/003, STR-001 | P3.01 |
| [P3.04](04-ref-rules.md) | Reference rules | REF-001…006 | P3.01 |
| [P3.05](05-chk-ctx-rules.md) | Content quality | CTX-001/002/003 | P3.01 |
| [P3.06](06-grp-rules.md) | Graph integrity | GRP-001/002/003 | P3.01 |
| [P3.07](07-llm-rules.md) | LLM rules ([D3](../index.md)) | SIZE-001, LLM-001 | P2.07 |
| [P3.08](08-custom-rule.md) | Declarative `custom` rule | `custom` | P3.02–P3.06 |
| [P3.09](09-rule-tests-and-cutover.md) | Tests, README table, schema sync, `scan→lint` cutover | — | all above |

## Sequence

```
(P2.07) ─► P3.01 ─┬─► P3.02 ─┐
                  ├─► P3.03 ─┤
                  ├─► P3.04 ─┼─► P3.08 ─► P3.09 ─► (Phase P4)
                  ├─► P3.05 ─┤
                  ├─► P3.06 ─┤
                  └─► P3.07 ─┘
```

P3.02–P3.07 are independent once the utils (P3.01) exist and can be done in parallel. P3.08
(`custom`) needs the primitives proven by the built-ins; P3.09 closes the phase.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) built-ins-as-presets + custom rule ·
  [R7](../requirements/02-rules-engine.md) shared scoping · [C5](../requirements/01-configuration.md)
  `settings.siteRouter` · [D3](../index.md) LLM rules · [D4](../index.md) `scan→lint` cutover ·
  [R5](../requirements/02-rules-engine.md) (GRP rules refactor onto the shared graph in [P4](../index.md)).

## Phase exit criteria

- [x] All 22 built-in rules implemented as presets, each with options schema + fixtures + tests.
- [x] LLM rules (SIZE-001, LLM-001) implemented; the [D3](../index.md) LLM features fully preserved.
- [x] `custom` rule works from config over the primitive vocabulary (no rebuild).
- [x] README rule table + `schema.json` are generated and in sync ([R6](../requirements/02-rules-engine.md)).
- [x] `scan` is now a hidden alias of `lint`; the legacy legacy pipeline is removed ([D4](../index.md)).

## What P3 unblocks

- **P4** — graph commands + the shared `ContextGraph` (GRP rules then refactor onto it, R5/G6).
- **P5** — `compile` describes this full rule set via `describeRules`.
- **P7** — MCP `lint`/`lint-files` expose all rules.
