# Phase P-release — Distribution, CI & release

> Roadmap: [v2 Index](../index.md) · Phase **P-release** · Size **M** · Status **Not started** · Depends on **all** prior phases.
>
> **Goal:** make the workspace production-publishable — per-package metadata, single-tag release coupling npm + skills, a first-class GitHub Action, rewritten docs, and a launch verification. **Milestone M4 — launch.**

## Why this phase exists

P-release turns three working packages + three skills into a shippable release. It applies the [installation requirements](../requirements/06-installation.md): supply chain ([I5](../requirements/06-installation.md)), single-tag release ([I4](../requirements/06-installation.md)), a first-class GitHub Action ([I6](../requirements/06-installation.md)), and skill pinning ([I7](../requirements/06-installation.md)) — across all three install channels (linter / MCP / skills, see the [installation requirements](../requirements/06-installation.md)). No migration is needed ([I8 — greenfield](../requirements/06-installation.md)).

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [PR.01](01-package-metadata.md) | Finalize per-package publish metadata + supply chain | M | P7, P8 |
| [PR.02](02-single-tag-release.md) | Single-tag release automation (npm + skills) | M | PR.01 |
| [PR.03](03-github-action.md) | First-class GitHub Action / reusable CI workflow | M | PR.01 |
| [PR.04](04-docs-readme.md) | README rewrite (3 install paths) + generated docs + AGENTS.md | M | PR.01 |
| [PR.05](05-release-verification.md) | Release dry-run & launch verification | M | PR.02–PR.04 |

## Sequence

```
(P10) ─► PR.01 ─┬─► PR.02 ─┐
                  ├─► PR.03 ─┼─► PR.05 ─► (v2 launch)
                  └─► PR.04 ─┘
```

## Decisions applied

- [I4, I5, I6, I7](../requirements/06-installation.md) · [I8 not needed](../requirements/06-installation.md) · generated docs ([R6](../requirements/02-rules-engine.md)/[M3](../requirements/05-mcp-server.md)).

## Phase exit criteria

- [ ] Each package has correct bins/exports/`files`/`engines`/`publishConfig` + provenance (I5).
- [ ] One `vX.Y.Z` tag publishes core+cli+mcp and tags the skills together (I4); skill `compatibility` matches the CLI version (I7).
- [ ] A reusable GitHub Action is published on top of the existing `ci.yml`/`publish.yml` baseline (I6). **The workspace gate half is already delivered and not re-tracked here** — `ci.yml`'s `verify` job runs the full gate on the pinned Node 24 line via `.node-version`, and its `pack` job matrixes `npm pack --dry-run` over the three packages; that half sits ticked at [P0](../P0-foundations/index.md) and is measured by running the gate. Only the composite Action itself ([P-release/03](03-github-action.md)) is open.
- [ ] README documents the three install paths; the rule table is generated (already) and a new generated MCP tool list is added.
- [ ] End-to-end smoke (CLI + MCP + skill) passes. **Pack-clean per package is no longer asserted here** — [P16.03](../P16-release-readiness/03-published-payload.md) put `npm pack --dry-run --workspaces` at the end of `release:check` and gave `ci.yml` a `pack` job that matrixes `npm pack --dry-run -w <package>` over all three, so it is measured by running the gate. Leaving it in this row kept it reading as open work while the same subject sat ticked at [P0](../P0-foundations/index.md), which is exactly the two-levels-disagreeing failure the [completion surface](../completion-surface.md) exists to stop.
- [ ] **Milestone M4 (launch) reached.**

## What P-release unblocks

- v2 is released. Backlog items (C6, G7/G8, R9-Tier2 plugins, S9, M5, HTTP transport, LSP, docs site) become the next iteration — see the [requirements backlog](../requirements/index.md).
