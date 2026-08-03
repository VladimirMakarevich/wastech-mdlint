# Phase P12 — Post-P9 Consistency & Coverage (tests, docs, accepted behaviors)

> Roadmap: [v2 Index](../index.md) · Phase **P12** · Size **S–M** · Status **Not started** · Depends on [P11](../P11-remediation/index.md) (code remediation landed).
>
> **Goal:** close the **test-boundary**, **performance**, **docs-vs-code**, and **decision** findings from the [post-P9 audit](../audit-2026-07-25-post-p9.md) and the [`p9-09` deep audit](../../research/p9-09-full-solution-deep-audit/report.md), so the coverage and the words describe the _current_ product — and so the class of defect that let P11's findings ship cannot recur silently. [P11](../P11-remediation/index.md) fixed the behavior; this phase hardens the tests and reconciles the contracts.

## Why this phase exists

The post-P9 audit's [§4](../audit-2026-07-25-post-p9.md) traces the missed defects to one systemic gap: **no tests at the process boundary.** `src/index.ts` had 0% coverage (H-1), the shared `exclude` option has zero end-to-end coverage across ~15 rules (L-4, the root of M-2), no `init` test exercises a write failure (M-5), and nothing spawns the binary. Alongside that sit two performance notes (L-5), one glossary-vs-code contradiction (L-2), and two `p9-09` items that are **decisions**, not code bugs: whether the MCP `lint` tool should run declarative custom rules (OG-1) and whether the recursive graph traversals need a depth bound (SC-3). This phase turns those into standing test guards, honest docs, and recorded decisions.

## Tasks

| # | Task | Finding(s) | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P12.01](01-exclude-coverage.md) | End-to-end `exclude` coverage across the rule families | L-4 | LOW | M | P11.05, P11.08 |
| [P12.02](02-glossary-custom-target.md) | Fix glossary: `custom.target` is optional | L-2 | LOW | S | P11 |
| [P12.03](03-quadratic-hotpaths.md) | Quadratic hot paths in compile / text-position | L-5 | LOW | S–M | P11 |
| [P12.04](04-mcp-custom-rules.md) | MCP `lint`: accept custom rules or document the limit | OG-1 | LOW | S | P11 |
| [P12.05](05-recursion-depth.md) | Recursive DFS depth — document the bound or guard it | SC-3 | LOW | S | P11 |
| [P12.06](06-process-boundary-tests.md) | Process-boundary test guards + format-gate publish process | §4, §1 | LOW | S–M | P11.01 |

> **Finding key.** `L-*` are from the [post-P9 audit](../audit-2026-07-25-post-p9.md); `OG-1`/`SC-3` are the two "needs-confirmation" items from the [`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md) (Open questions) — recorded here as maintainer decisions, not asserted defects.

## Sequence

```
(P11) ─► P12.01  (exclude e2e — assert P11.05/P11.08's corrected behavior)
        P12.02  P12.03  P12.04  P12.05
        P12.06  (process-boundary guards; references P11.01's bin-spawn test)
                                   └─► (P-release)
```

> All tasks are independent and parallelizable. **P12.01** must land after [P11.05](../P11-remediation/05-table-primitive-scope.md) / [P11.08](../P11-remediation/08-init-exclude-anchoring.md) so its new tests assert the _fixed_ `exclude` behavior, not the buggy one. **P12.06** references the bin-spawn test delivered in [P11.01](../P11-remediation/01-cli-bin-noop.md) and generalizes it into a standing boundary-test checklist. Except P12.03 (a small performance refactor), these are test- and docs-only.

## Phase exit criteria

- [ ] The shared `exclude` option has end-to-end coverage on every rule family that accepts it — the root-cause backstop for M-2 (L-4).
- [ ] `glossary.md` states `custom.target` is optional, agreeing with code, schema, and the guide (L-2).
- [ ] The quadratic hot paths are fixed or the corpus-size assumption is documented (L-5).
- [ ] The MCP `lint` custom-rule boundary is decided and reflected in both the requirement and the tool description (OG-1).
- [ ] The recursive-DFS corpus bound is documented (or the hottest traversal is made iterative) (SC-3).
- [ ] A standing "tests at the process boundary" checklist exists (bin spawn, write-failure, exclude, determinism), and the format gate runs before publishing docs deliverables (§4, §1).

## What P12 unblocks

- [P-release](../P-release/index.md). With the post-P9 code (P11) and coverage/docs (P12) reconciled, the two release-blockers closed, and the boundary-test guards in place, the product is release-ready.
