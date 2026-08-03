# PR.05 · Release dry-run & launch verification

> Phase: [P-release — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Prove the whole release works end-to-end across all three channels before tagging v2.

## Sequence

- **Previous:** [PR.02 — Single-tag release](02-single-tag-release.md), [PR.03 — GitHub Action](03-github-action.md), [PR.04 — Docs](04-docs-readme.md).
- **Next:** **v2 launch** (backlog becomes the next iteration — see [requirements backlog](../requirements/index.md)).
- **Depends on:** PR.02–PR.04 · **Blocks:** the release tag.

## Deliverables / steps

1. Full workspace gate green: run the existing root `release:check` script (`npm run typecheck && npm test && npm run build && npm pack --dry-run`); it currently omits `lint`, `format`, and the schema-sync/skill-frontmatter checks, so either extend the script or also run `npm run lint`, `npm run format`, and those tests explicitly on the pinned Node 24 line. (`publish.yml`'s `publish-readiness` job runs `lint` and `format` as of [P12.06](../P12-consistency/06-process-boundary-tests.md), but `release:check` still does not — so a local pre-tag run has to add them by hand.)
2. **End-to-end smoke** across the three channels:
   - CLI: install the packed `cli`, run `init` → `lint` → `graph`/`slice`/`impact` → `compile`;
   - MCP: boot `wastech-mdlint-mcp`, call each of the 6 tools;
   - Skill: `gh skill install … --pin` resolves and references real commands/tools.
3. Dry-run the single-tag release ([PR.02](02-single-tag-release.md)) without publishing. The existing `.github/workflows/publish.yml` `publish-readiness` job already runs the gate + `npm pack --dry-run --workspaces` on `v*` tags; PR.02 upgrades it to real publishing, so verify against that job rather than reinventing the dry-run.
4. Walk the two registers P12.06 established, since neither is enforced by the gate above: the [process-boundary guard checklist](../../../.agents/rules/testing.md) (confirm each of the four categories still has a guard — `packages/core/test/boundary-guards.test.ts` proves the tags survive, but only a reader can confirm a _new_ subsystem did not ship without one), and the [accepted-behaviors register](../accepted-behaviors.md) (confirm every user-reachable row still has its `README.md` / `docs/guide/` home, and that no row was silently fixed without being removed). Both are launch-facing: they are what a first-time user's surprise gets checked against.
5. Tick the Phase P-release [exit criteria](index.md); confirm **Milestone M4 (launch)**.

## Decisions applied

- [M4](../requirements/05-mcp-server.md) wire-level tests · [I4/I5/I7](../requirements/06-installation.md).

## Exit criteria

- [ ] Full gate green; pack dry-run clean; release dry-run succeeds.
- [ ] End-to-end smoke passes for CLI, MCP, and skills.
- [ ] **Milestone M4 reached — v2 is ready to tag and publish.**

## Hand-off to next

v2 ships. The recorded [backlog](../requirements/index.md) (C6, G7/G8, R9 plugins, S9, M5, HTTP transport, LSP, docs site) seeds the next iteration.
