# P11.13 · Retire dead `GRP` options; collapse duplicate `SIZE-001`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Findings **SC-1** and **SC-2**
> ([`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md), Low, confirmed).

## Goal

Stop the schema from advertising options that do nothing, and stop `SIZE-001` from emitting two
same-severity findings for one condition.

## Problem (from the audit)

**SC-1 — `GRP-001`/`GRP-002` accept options that are silently ignored.** `GRP-001`'s schema declares
`siteRouter` plus the shared `files`/`exclude` shape (`rules/grp.ts:34-35`), but its `check` takes no
options — `check: () => (context) => {…}` (`grp.ts:38`) — and reads only the shared corpus-wide graph.
So `files`/`exclude`/`siteRouter` validate but do nothing. `GRP-002` likewise declares an unused
`siteRouter` (`grp.ts:74`). The code even admits it (`grp.ts:21`: "accepted for forward-compat but do
not re-scope the shared corpus-wide graph in P3"). A key that passes strict validation yet has no
effect is a footgun — strict validation actively signals the option is supported.

**SC-2 — `SIZE-001` can emit duplicate same-severity findings.** `SIZE-001` fires the warn-budget and
error-budget findings independently for one metric (`rules/size.ts:94` + the two `context.report`
blocks). Severity resolution lets a config override win — `severity: severityOverride ?? … `
(`run-rules.ts:42`) — so a file over both thresholds with a `severity:"error"` override renders **both**
findings as `error`: two near-duplicate messages for one metric on one file.

## Deliverables / steps

1. **SC-1:** prefer **removing** the dead options from the `GRP-001`/`GRP-002` schemas (YAGNI until a
   phase needs per-rule graph scoping) so validation stops advertising a no-op. If a maintainer wants
   them wired instead, that is a larger graph-scoping task — record the decision either way and update
   the code comment at `grp.ts:21`.
2. **SC-2:** suppress the redundant lower-threshold `SIZE-001` finding when a `severity` override
   collapses the two severities to the same value (emit one), or, if the independent firing is kept,
   document the interaction in the [`SIZE-001` guide](../../guide/rules/SIZE-001.md).
3. Tests: a `GRP-001` config with a now-removed option is a `CONFIG_INVALID` (or, if kept, is
   honored); a `SIZE-001` file over both thresholds with a `severity:"error"` override reports one
   finding for the metric.

## Out of scope

`LLM-001`'s cross-entrypoint duplicates (L-3) — that is [P11.11](11-llm-dedup.md). Building real
per-rule graph re-scoping for `GRP` — out of scope unless a maintainer chooses to wire the options.

## Exit criteria

- [ ] `GRP-001`/`GRP-002` no longer accept options they ignore (removed), or the options are honored (wired) — decided and recorded.
- [ ] `SIZE-001` does not emit two same-severity findings for one metric under a `severity` override.
- [ ] Regression tests cover the chosen `GRP` behavior and the `SIZE-001` override case.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
