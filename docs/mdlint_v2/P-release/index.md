# Release — distribution, CI & publishing

> Status **In progress**. This folder is the working checklist for the first public release. It is task documentation: it is deleted once the release has shipped, and nothing outside it may depend on it.

## Why this folder exists

The workspace builds three packages and three agent skills that have never been published. Nothing here is a design document — the design lives in the code and in the user guide under [`docs/guide/`](../../guide/README.md). What this folder holds is the set of things that must be true before a `vX.Y.Z` tag can be cut, in the order they have to become true.

## Tasks

| # | Task |
| --- | --- |
| [01](01-package-metadata.md) | Publish metadata, version coupling, and payload shape |
| [02](02-single-tag-release.md) | Single-tag release automation (npm + skills) |
| [03](03-github-action.md) | Reusable GitHub Action for consumers |
| [04](04-docs-readme.md) | README install channels, generated docs, CHANGELOG |
| [05](05-release-verification.md) | Release gate and end-to-end launch verification |

Task 01 comes first because everything else publishes what it defines. Tasks 02, 03 and 04 are independent of each other. Task 05 is last because it verifies the result of all four.

## What "released" means

- [ ] Every package declares correct bins, exports, `files`, `engines` and `publishConfig`, and carries its own README and LICENSE text in the tarball.
- [ ] One `vX.Y.Z` tag publishes `core`, `cli` and `mcp-server` at the same version, with every internal dependency pin bumped in the same change, and tags the skills alongside them.
- [ ] Each skill's `compatibility` field names the published CLI version, and a test proves it rather than a convention asserting it.
- [ ] A reusable GitHub Action exists so a consumer can run the linter in CI in one step.
- [ ] The README documents all three install channels: CLI, MCP server, and skills.
- [ ] The full gate is green and an end-to-end smoke — install the packed tarballs into a clean directory, run the CLI, boot the MCP server — passes.

## Deliberately not tracked here

The CI verification gate and the per-package pack check already exist: `.github/workflows/ci.yml` runs the full gate on the pinned Node line and matrixes `npm pack --dry-run` over the three packages, and `npm run release:check` ends in `npm pack --dry-run --workspaces`. Those are measured by running the gate, not by a checkbox here.
