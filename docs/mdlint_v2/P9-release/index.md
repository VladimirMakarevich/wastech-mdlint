# Phase P9 — Distribution, CI & release

> Roadmap: [v2 Index](../index.md) · Phase **P9** · Size **M** · Status **Not started** ·
> Depends on **all** prior phases.
>
> **Goal:** make the workspace production-publishable — per-package metadata, single-tag
> release coupling npm + skills, a first-class GitHub Action, rewritten docs, and a launch
> verification. **Milestone M4 — launch.**

## Why this phase exists

P9 turns three working packages + three skills into a shippable release. It applies the
[installation requirements](../requirements/06-installation.md): supply chain
([I5](../requirements/06-installation.md)), single-tag release
([I4](../requirements/06-installation.md)), a first-class GitHub Action
([I6](../requirements/06-installation.md)), and skill pinning
([I7](../requirements/06-installation.md)) — across all three install channels (linter / MCP /
skills, see the [installation requirements](../requirements/06-installation.md)). No migration
is needed
([I8 — greenfield](../requirements/06-installation.md)).

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P9.01](01-package-metadata.md) | Finalize per-package publish metadata + supply chain | M | P7, P8 |
| [P9.02](02-single-tag-release.md) | Single-tag release automation (npm + skills) | M | P9.01 |
| [P9.03](03-github-action.md) | First-class GitHub Action / reusable CI workflow | M | P9.01 |
| [P9.04](04-docs-readme.md) | README rewrite (3 install paths) + generated docs + AGENTS.md | M | P9.01 |
| [P9.05](05-release-verification.md) | Release dry-run & launch verification | M | P9.02–P9.04 |

## Sequence

```
(P7/P8) ─► P9.01 ─┬─► P9.02 ─┐
                  ├─► P9.03 ─┼─► P9.05 ─► (v2 launch)
                  └─► P9.04 ─┘
```

## Decisions applied

- [I4, I5, I6, I7](../requirements/06-installation.md) · [I8 not needed](../requirements/06-installation.md) ·
  generated docs ([R6](../requirements/02-rules-engine.md)/[M3](../requirements/05-mcp-server.md)).

## Phase exit criteria

- [ ] Each package has correct bins/exports/`files`/`engines`/`publishConfig` + provenance (I5).
- [ ] One `vX.Y.Z` tag publishes core+cli+mcp and tags the skills together (I4); skill
      `compatibility` matches the CLI version (I7).
- [ ] A reusable GitHub Action is published; CI runs the full workspace matrix on Node 24 (I6).
- [ ] README documents the three install paths; rule table + MCP tool list are generated.
- [ ] `npm pack --dry-run` clean per package; end-to-end smoke (CLI + MCP + skill) passes.
- [ ] **Milestone M4 (launch) reached.**

## What P9 unblocks

- v2 is released. Backlog items (C6, G7/G8, R9-Tier2 plugins, S9, M5, HTTP transport, LSP,
  docs site) become the next iteration — see the [requirements backlog](../requirements/index.md).
