# Phase P13 — Corpus & correctness remediation

> Roadmap: [v2 Index](../index.md) · Phase **P13** · Size **M–L** · Status **Done** · Depends on [P12](../P12-consistency/index.md) (post-P9 consistency landed).
>
> **Goal:** close every defect where the product gives a **wrong answer about the repository with no signal that it did** — which files entered the corpus, which rules actually ran, and what the first config error says. Sourced from the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), batches **B1–B5**.

## Why this phase exists

The [2026-08-05 assessments](../remediation-backlog-2026-08-05.md) — a deep plan-conformance audit, its QA pass, and a field test of the packed CLI against an external Angular/.NET monorepo — agree on where the product is weakest, and it is not the architecture. It is the boundary between what a user writes in config and what the tool decides to read. Two items are blockers: a `!` in any glob list silently widens or empties scope, and there is no lint-time default `exclude`, so the zero-config first run lints every `node_modules` tree. Around them sit four rules that can be enabled into inertness or into 55% noise, three resolvers that disagree about what a Markdown file is, `.gitignore` precedence that drops a file real `git` keeps, and a config validator whose most likely first error says only `Invalid input`.

What these share is the failure direction: **silence**. Exit `0`, no diagnostic, a plausible number. That is why they lead the remediation rather than the release work, and why every task here carries a test that fails before its fix.

## Tasks

| # | Task | Backlog | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P13.01](01-glob-semantics.md) | Glob semantics: negation, anchoring, and both documented | W-01, W-03 | **Blocker** | M | P12 |
| [P13.02](02-default-exclude.md) | A lint-time default `exclude` | W-02 | **Blocker** | S–M | P13.01 |
| [P13.03](03-gitignore-precedence.md) | `.gitignore` layer precedence is root-first-wins | W-11 | Medium | S–M | P12 |
| [P13.04](04-rule-option-defaults.md) | Rule options that disable or misfire | W-04, W-05, W-06, W-07 | High | M | P13.01 |
| [P13.05](05-reference-resolution.md) | Reference and extension resolution | W-08, W-09, W-10 | High | M | P12 |
| [P13.06](06-config-diagnostics.md) | Config diagnostics that name the key | W-12 | High | M | P12 |

> **Backlog key.** `W-NN` are the work items in the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), which names each item's source finding IDs (`F1–F41` from the audit, `F-01–F-26` from the field test) so the original evidence stays reachable. Severity is the backlog's triage rank, not a source grade — see its Master index preamble.

## Sequence

```
(P12) ─► P13.01 (glob list form + anchoring docs)
             ├─► P13.02 (default exclude — its meaning depends on P13.01)
             │      ▲
             │      └── its `respectGitignore` default decision also needs P13.03
             └─► P13.04 (rule option defaults are globs)
        P13.03  P13.05  P13.06   (independent)
                                   └─► (P14)
```

> **P13.01 goes first and alone.** It changes what every glob in every config means, so landing a default `exclude` (P13.02) or default `entryPoints` (P13.04) before it would pin those defaults against semantics that are about to change. P13.05 and P13.06 touch disjoint subsystems and can run in parallel with any of the above.
>
> **One ordering constraint inside the parallel set.** P13.03 is otherwise independent, but [P13.02](02-default-exclude.md) also decides whether `respectGitignore` should default to `true`. Turning that default on before P13.03 lands would put the root-first-wins precedence bug (W-11) on the zero-config path — a default that silently drops a file real `git` keeps, which is the exact failure class this phase exists to close. So P13.02 may ship its `exclude` default at any time, but a `respectGitignore: true` default lands only after P13.03.

## Phase exit criteria

- [x] A `!` entry in `include`, `exclude`, or any rule's `files`/`exclude` either subtracts or is rejected at config validation — never widens or empties scope silently (W-01).
- [x] `npx wastech-mdlint lint .` with no config prunes `node_modules` at every depth, and the schema declares the default so an editor shows it (W-02).
- [x] The glob anchoring rule is stated where a user writes config, and `README.md`'s own example prunes a nested `node_modules` (W-03).
- [x] No rule can be enabled into a silent no-op; `SIZE-001` and `GRP-002` either require their threshold or ship a default (W-04, W-05).
- [x] `TBL-003.caseSensitive` has one source of truth that the generated schema, the skill renderer, and every guide page read (W-06).
- [x] `GRP-001`'s two-node-cycle behavior is configurable or recorded in [`accepted-behaviors.md`](../accepted-behaviors.md) (W-07).
- [x] `REF-001.exclude` applies on the router branch; one extension constant governs coverage, the `init` scan, and the default `include` (W-08, W-09).
- [x] One image-target resolution model is claimed and implemented, or the exclusion is stated where the graph builder's invariant comment makes the claim (W-10).
- [x] Nested `.gitignore` negation agrees with `git check-ignore` in both directions (W-11).
- [x] An invalid `severity` or an unknown key on **any** rule family names the key and, for an enum, the allowed values; every config diagnostic names the file; one path notation throughout (W-12).
- [x] `npm run typecheck && npm test && npm run build && npm run lint && npm run format` green.

## What P13 unblocks

- [P14](../P14-host-boundary/index.md). Once the corpus and the rule set are trustworthy, the host boundary's silent successes and dropped diagnostics are the next thing a user or an agent meets.
- [P17.02](../P17-plan-of-record/02-self-linting-config.md) depends on this phase indirectly: a self-linting configuration cannot be written until `include`/`exclude` mean what they say.
