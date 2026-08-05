# Phase P17 — Plan of record & self-linting

> Roadmap: [v2 Index](../index.md) · Phase **P17** · Size **S–M** · Status **Not started** · Depends on [P16](../P16-release-readiness/index.md) (release readiness landed).
>
> **Goal:** make the plan of record describe the product that shipped, and make this repository run its own linter on its own documentation so the next round of drift is a build failure instead of an audit finding. Sourced from the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), batches **B12–B13**.

## Why this phase exists

This is the largest class in the assessment and the least dangerous per item — and it has one cause. A rename, a deletion, or a scope change was applied in one place and never swept: a report deleted while 11 citations still point at it, `PLAN.md` deleted while the governance file says it remains, a release phase renamed while three locked requirements still assign work to the old name, an enforced architecture decision that names three APIs which do not exist and forbids the async pipeline that shipped.

Two of these sit in the **precedence tiers a contributor is told to obey** rather than in user-facing pages, so they are the ones most likely to make a future change wrong rather than merely confuse a reader. That is why [P17.03](03-adr-and-dependency-register.md) leads on ranking despite being smaller than [P17.04](04-completion-surface.md).

**And one item is worth more than the rest combined.** This repository ships the rule that catches dead links and has no configuration to run it on. The 17 dead links in [P17.01](01-dead-links.md) were all found by `REF-001` in a single run, once a configuration was supplied **from outside the repository** — a run this repository cannot perform on itself. Adding one narrow config and a CI step converts most of this phase from an audit finding into a build failure, and it **closes a plan expectation rather than reversing a decision**: requirement I8 and the glossary both already state that the repo's own config exists in the v2 shape.

## Tasks

| # | Task | Backlog | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P17.01](01-dead-links.md) | Dead links and absent documents | W-43, W-44 | Medium | S | P16 |
| [P17.02](02-self-linting-config.md) | Self-linting configuration and CI | W-53 | High | S–M | P17.01, P13 |
| [P17.03](03-adr-and-dependency-register.md) | The enforced ADR and the dependency register | W-41, W-47 | High | S | P16 |
| [P17.04](04-completion-surface.md) | The completion surface | W-42, W-50 | High | M | P17.03 |
| [P17.05](05-p-release-rename-sweep.md) | The `P-release` rename sweep | W-45, W-46 | Medium | S–M | P16 |
| [P17.06](06-register-and-roadmap.md) | Register contract and roadmap accuracy | W-48, W-49, W-51, W-52, W-51a, W-52a | Low | S–M | P17.04 |

> **Backlog key.** `W-NN` are the work items in the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), which names each item's source finding IDs so the original evidence stays reachable. `W-51a` and `W-52a` come from that document's [pre-implementation addendum](../remediation-backlog-2026-08-05.md#addendum--pre-implementation-audit-of-p13p17): drift that landed after the backlog was written, in the same class as items this phase already owns.

## Sequence

```
(P16) ─► P17.01 (clear the 17 links) ─► P17.02 (self-lint config + CI — red on arrival otherwise)
        P17.03 (ADR + register — highest ranked)
             └─► P17.04 (completion surface) ─► P17.06 (register + roadmap)
        P17.05 (rename sweep)
                                   └─► (P-release)
```

> **P17.01 strictly before P17.02.** A CI step that lints `docs/` is red on arrival if the existing 17 dead links are still there, and a gate that is red the day it lands gets disabled. **P17.02 also depends on [P13](../P13-correctness/index.md)**: `include`/`exclude` had to start meaning what they say before a config could be written against them. **P17.03 before P17.04** is the one ranking change the QA pass asked for — a stale enforced ADR makes the next contributor write wrong code, while unchecked boxes only mislead. **P17.06 after P17.04**, because the register work overlaps what the completion decision produces.

## Phase exit criteria

- [ ] The 11 citations of the deleted report are repointed and the four `tasks/pending/` links dropped or re-targeted; `PLAN.md`/`docs/plan/` references are gone (W-43, W-44).
- [ ] CI fails on a dead link inside `docs/`, run by the product's own `REF-001` against a repository configuration that exists (W-53).
- [ ] The enforced ADR's three nonexistent API names are corrected and its synchronicity clause replaced with the real constraint; the glossary's **`lintFiles`**, **LSP server** and **Async rules** entries are fixed in the same change (W-41).
- [ ] Decision entries 4.2 and 4.3 are narrowed to what shipped, or the two unconsumed exports are recorded as intended surface (W-47).
- [ ] No phase index reads `Not started` above task files that are all Done; the permanently unverifiable P0 parity criterion is retired or registered; the per-task checkbox question is **decided**, not just actioned (W-42).
- [ ] The orchestrator task file is listed in its index or moved out of the phase directory (W-50).
- [ ] Every stale release-sense `P9` is swept from the requirements, the phase indexes, and the shipped artifacts — **without** touching the correct `P9.04/06/07` references (W-45, W-46).
- [ ] The accepted-behaviors register satisfies its own three rules, including the row it flags against itself (W-48).
- [ ] The live Prettier corruption is retyped; the roadmap lists seven CLI commands and diagrams `schema.json` where it lives; the frozen audits' language is stated (W-49, W-51, W-52).
- [ ] The glossary's **Milestone** entry names P13–P17, its `Status` header and **Maintenance rule** are back, and `CLAUDE.md`'s pointer to that rule resolves (W-51a, W-52a).
- [ ] `npm run format` green — this phase is almost entirely Markdown, so the format gate is the gate that matters.

## What P17 unblocks

- [P-release](../P-release/index.md). With the product correct (P13–P15), guarded and publishable (P16), and the plan describing it accurately with CI enforcing the description (P17), the release phase has nothing left blocking it.
