# P9.04 · README polish (add MCP/skill channels) + generated docs

> Phase: [P9 — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Ship accurate, mostly-generated user docs covering all three install paths, and point the
repo's sources of truth at v2.

## Sequence

- **Previous:** [P9.01 — Package metadata](01-package-metadata.md).
- **Next:** [P9.05 — Release verification](05-release-verification.md).
- **Depends on:** P9.01 · **Parallel with:** P9.02, P9.03 · **Blocks:** P9.05.

## Deliverables / steps

1. **Extend `README.md` — it is already v2** (the P3.09 cutover removed legacy `.cjs/.mjs`,
   sectioned config, `links/broken-links`, and "Markdown Context Audit", and rewrote the head).
   The real gap is the missing install channels: today only the CLI (`npm i -D
   @wastech-mdlint/cli`) is documented — add **MCP** (`npx @wastech-mdlint/mcp-server` + host
   snippet) and **skills** (`gh skill install VladimirMakarevich/wastech-mdlint <skill> --pin
   vX.Y.Z`, [I7](../requirements/06-installation.md)); refresh quick-start / commands / config.
2. The rule table is **already generated** by `generateRuleDocs` (`generate:docs` script) and
   sync-checked by `packages/core/test/docs-sync.test.ts` — keep that. The **MCP tool list is not
   generated yet**: add a tool-inventory generator to `scripts/generate-docs.mjs` (built on the
   P7 tool registry, M3) and a matching sync check, then embed it so docs can't drift.
3. CHANGELOG; **no migration guide** ([I8 — greenfield](../requirements/06-installation.md)).
4. **Verify** [AGENTS.md](../../../AGENTS.md) "Sources Of Truth" still resolves to `docs/mdlint_v2/`
   (it was already pointed there — roadmap + requirements + decisions + phase folders); only fix
   stale phase-folder links if any.

## Decisions applied

- [I7](../requirements/06-installation.md) skill pinning · generated docs
  ([R6](../requirements/02-rules-engine.md)/[M3](../requirements/05-mcp-server.md)) ·
  [I8 none](../requirements/06-installation.md).

## Exit criteria

- [ ] README covers CLI + MCP + skill install paths with correct names/bins (MCP + skill sections
      added; CLI section already present).
- [ ] Rule table stays generated + sync-checked; a new generated MCP tool list is added and
      sync-checked.
- [ ] AGENTS.md "Sources Of Truth" confirmed pointing at v2 (already done in an earlier phase).

## Hand-off to next

P9.05 verifies the documented flows actually work end-to-end before release.
