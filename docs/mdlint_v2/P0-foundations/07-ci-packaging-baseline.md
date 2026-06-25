# P0.07 · CI matrix & packaging/publish baseline

> Phase: [P0 — Workspace & Foundations](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Make the workspace continuously verified and publish-ready in shape (not yet
auto-publishing). Establishes the supply-chain baseline ([I5](../requirements/06-installation.md));
full single-tag release automation is [P9](../index.md).

## Sequence

- **Previous:** [P0.05 — cli](05-cli-package-commander.md) and
  [P0.06 — mcp-server](06-mcp-server-skeleton.md) produced the two host packages on top of
  core; all three now build.
- **Next:** [P0.08 — Phase exit verification](08-exit-verification.md) runs the full green
  check and documents the layout.
- **Depends on:** P0.05, P0.06 · **Blocks:** P0.08.

## Inputs (from previous work)

- Three buildable packages (`core`, `cli`, `mcp-server`) and the root workspace scripts
  from P0.02.
- The MVP CI workflows in `.github/workflows/` (`ci.yml`, `publish.yml`) as a starting point.

## Deliverables / steps

1. Update `.github/workflows/ci.yml` to run **across the workspace** on Node 24:
   `typecheck`, `test`, `build`, `lint`, plus `npm pack --dry-run` per package.
2. Per-package packaging baseline: `engines.node` (`>=24.17.0 <25`), `files` allowlists,
   `publishConfig.access: "public"`, and **npm provenance** on all three (I5).
3. Keep `publish.yml` as a placeholder; note that **single-tag release** publishing
   core+cli+mcp and tagging skills together is wired in [P9](../index.md) ([I4](../requirements/06-installation.md)).
4. Ensure lockfile-based install in CI for reproducibility.

## Decisions applied

- [I5](../requirements/06-installation.md) supply chain · [I4](../requirements/06-installation.md)
  release coupling (deferred to P9) · [D1](../index.md) workspace CI.

## Exit criteria

- [ ] CI runs typecheck/test/build/lint over the whole workspace on Node 24 and is green.
- [ ] `npm pack --dry-run` is clean for each package and includes only intended files.
- [ ] Provenance/engines/files set on every package.

## Hand-off to next

P0.08 can assert the green workspace-wide check as the phase gate, and P9 inherits a
publish-ready package set needing only the release automation.
