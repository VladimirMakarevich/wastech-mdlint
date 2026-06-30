# P9.04 · README rewrite + generated docs + AGENTS.md

> Phase: [P9 — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Ship accurate, mostly-generated user docs covering all three install paths, and point the
repo's sources of truth at v2.

## Sequence

- **Previous:** [P9.01 — Package metadata](01-package-metadata.md).
- **Next:** [P9.05 — Release verification](05-release-verification.md).
- **Depends on:** P9.01 · **Parallel with:** P9.02, P9.03 · **Blocks:** P9.05.

## Deliverables / steps

1. Rewrite `README.md`: the three install channels — CLI (`npm i -D @wastech-ctxlint/cli`),
   MCP (`npx @wastech-ctxlint/mcp-server` + host snippet), skills
   (`gh skill install VladimirMakarevich/wastech-ctxlint <skill> --pin vX.Y.Z`,
   [I7](../requirements/06-installation.md)); quick-start; commands; config.
2. Embed the **generated** rule table ([R6](../requirements/02-rules-engine.md)) and MCP tool
   list ([M3](../requirements/05-mcp-server.md)) so docs can't drift.
3. CHANGELOG; **no migration guide** ([I8 — greenfield](../requirements/06-installation.md)).
4. Update [AGENTS.md](../../../AGENTS.md) "Sources Of Truth" to point at `docs/ctxlint_v2/`
   (roadmap + requirements + phase folders).

## Decisions applied

- [I7](../requirements/06-installation.md) skill pinning · generated docs
  ([R6](../requirements/02-rules-engine.md)/[M3](../requirements/05-mcp-server.md)) ·
  [I8 none](../requirements/06-installation.md).

## Exit criteria

- [ ] README covers CLI + MCP + skill install paths with correct names/bins.
- [ ] Rule table + tool list are generated and current.
- [ ] AGENTS.md sources of truth updated to v2.

## Hand-off to next

P9.05 verifies the documented flows actually work end-to-end before release.
