# Phase P10 — Post-Audit Consistency (docs, contracts, tests)

> Roadmap: [v2 Index](../index.md) · Phase **P10** · Size **S–M** · Status **Not started** ·
> Depends on [P9](../P9-remediation/index.md) (code remediation landed).
>
> **Goal:** close the **documentation drift**, **contract-text**, and **test-guard** findings
> from the [P0–P8 audit](../audit-2026-07-23-p0-p8.md), so governance docs, the glossary,
> requirements, and the test suite describe the *current* product — before release.

## Why this phase exists

The audit found no HIGH defects, but several docs and rule-docs describe an earlier project state
(pre-P6 and pre-P3.09 cutover), a few requirement texts contradict the shipped surface, and some
test guards are thinner than the behavior they protect. These are low-risk individually but
together they erode the "docs are a contract" invariant the repo relies on. [P9](../P9-remediation/index.md)
fixed the code; this phase brings the words and the guards back in line.

## Tasks

| # | Task | Findings | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P10.01](01-governance-docs.md) | Fix governance docs (root `src/`/`test/`, post-P3.09 wording, typo) | M-7, L-4 | MEDIUM | S | P9 |
| [P10.02](02-glossary-status.md) | Refresh glossary phase-status markers (P6–P8 shipped) | M-8 | MEDIUM | S | P9 |
| [P10.03](03-stale-comments.md) | Clean stale source comments/notes | L-1, L-2 | LOW | S | P9 |
| [P10.04](04-registry-inventory-guard.md) | Add a registry inventory guard test (24 IDs / 8 categories) | L-12 | LOW | S | P9 |
| [P10.05](05-test-depth.md) | Deepen parser & per-rule tests | L-13, L-14 | LOW | M | P9 |
| [P10.06](06-requirement-reconciliation.md) | Reconcile requirement/plan text | L-8, L-9, L-10 | LOW | S | P9 |
| [P10.07](07-frontmatter-import-direction.md) | Decouple frontmatter-schema import direction | L-5 | LOW | S | P9 |
| [P10.08](08-accepted-behaviors.md) | Document accepted behaviors & release-coupled checks | L-15, L-11 | LOW | S | P9 |

## Sequence

```
(P9) ─► P10.01 ┐
       P10.02 ┤
       P10.03 ┤
       P10.04 ┼─► (P-release)
       P10.05 ┤
       P10.06 ┤
       P10.07 ┤
       P10.08 ┘
```

> All tasks are independent and parallelizable. They are documentation/test-only except P10.07
> (a small, low-risk code refactor) and P10.03 (comment-only edits) — none change runtime behavior.

## Phase exit criteria

- [ ] `AGENTS.md` / `.agents/rules/architecture.md` describe the post-P3.09 layout (no root `src/`/`test/`); typo fixed.
- [ ] `glossary.md` phase-status markers reflect that P6/P7/P8 shipped.
- [ ] No stale `CHK-*` reference or "not yet config-driven — P2 wires" comment remains in source.
- [ ] A single test pins the shipped registry to the documented 24 rule IDs / 8 categories.
- [ ] Parser (P1.06) and thin per-rule test gaps are filled.
- [ ] Requirement texts (R7, M1 table, P5.04 schema-location) agree with the shipped code.
- [ ] Accepted behaviors (dangling reference links; skill `compatibility` coupling) are documented, with the version check tracked for P-release.

## What P10 unblocks

- [P-release](../P-release/index.md) — with code (P9) and docs/tests (P10) reconciled, the product is release-ready.
