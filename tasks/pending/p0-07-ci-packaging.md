---
id: p0-07-ci-packaging
title: "P0.07 — CI matrix & packaging/publish baseline"
priority: mid
depends_on:
  - p0-05-cli-commander
  - p0-06-mcp-skeleton
---

## Description

Make the workspace continuously verified and publish-ready in shape (not yet auto-publishing). Depends on BOTH host packages (cli + mcp-server). Follow `docs/mdlint_v2/P0-foundations/07-ci-packaging-baseline.md`.

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` runs across the workspace on Node 24: `typecheck`, `test`, `build`, `lint`, plus `npm pack --dry-run` per package.
- [ ] Per-package packaging: `engines.node` `>=24.17.0` (no upper bound), `files` allowlists, `publishConfig.access: "public"`, and npm provenance on all three packages.
- [ ] `publish.yml` is kept as a placeholder (single-tag release is wired in P9); CI uses lockfile-based install for reproducibility.
- [ ] Workspace-wide typecheck/test/build/lint are green; `npm pack --dry-run` is clean per package (only intended files); provenance/engines/files are set on every package.

## Constraints

- No actual publishing or release automation here — that is P9.
