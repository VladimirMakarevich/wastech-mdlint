# PR.04 · README polish (add MCP/skill channels) + generated docs

> Phase: [P-release — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Ship accurate, mostly-generated user docs covering all three install paths, and point the
repo's sources of truth at v2.

## Sequence

- **Previous:** [PR.01 — Package metadata](01-package-metadata.md).
- **Next:** [PR.05 — Release verification](05-release-verification.md).
- **Depends on:** PR.01 · **Parallel with:** PR.02, PR.03 · **Blocks:** PR.05.

## Deliverables / steps

1. **Extend `README.md` — it is already v2** (the P3.09 cutover removed legacy `.cjs/.mjs`,
   sectioned config, `links/broken-links`, and "Markdown Context Audit", and rewrote the head).
   The **MCP** install channel already landed in [P7.05](../P7-mcp-server/05-integration-tests-docs.md)
   (`## MCP server` section: `npx @wastech-mdlint/mcp-server` + host-config snippet). The remaining
   gap is the **skills** channel (`gh skill install VladimirMakarevich/wastech-mdlint <skill> --pin
   vX.Y.Z`, [I7](../requirements/06-installation.md)); refresh quick-start / commands / config.
2. The rule table is **already generated** by `generateRuleDocs` (`generate:docs` script) and
   sync-checked by `packages/core/test/docs-sync.test.ts` — keep that. The **MCP tool inventory is
   also already generated** (P7.05: `generateToolInventory` in `packages/mcp-server/src/tool-docs.ts`,
   wired into `scripts/generate-docs.mjs`, sync-checked by `packages/mcp-server/test/docs-sync.test.ts`)
   — keep that too; nothing new to add here.
3. CHANGELOG; **no migration guide** ([I8 — greenfield](../requirements/06-installation.md)).
4. **Verify** [AGENTS.md](../../../AGENTS.md) "Sources Of Truth" still resolves to `docs/mdlint_v2/`
   (it was already pointed there — roadmap + requirements + decisions + phase folders); only fix
   stale phase-folder links if any.

## Decisions applied

- [I7](../requirements/06-installation.md) skill pinning · generated docs
  ([R6](../requirements/02-rules-engine.md)/[M3](../requirements/05-mcp-server.md)) ·
  [I8 none](../requirements/06-installation.md).

## Exit criteria

- [ ] README covers CLI + MCP + skill install paths with correct names/bins (CLI + MCP sections
      already present; add the skill section).
- [ ] Rule table and MCP tool list both stay generated + sync-checked (both landed in P7.05).
- [ ] AGENTS.md "Sources Of Truth" confirmed pointing at v2 (already done in an earlier phase).

## Hand-off to next

PR.05 verifies the documented flows actually work end-to-end before release.
