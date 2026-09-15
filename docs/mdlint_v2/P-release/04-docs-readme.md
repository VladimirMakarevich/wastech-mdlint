# 04 · README install channels, generated docs, CHANGELOG

> Part of the [release checklist](index.md).

## Goal

Make the README describe every way the product can be installed, and add the changelog a first release needs.

## Steps

1. **Add the skills install channel to the README.** The CLI and MCP sections are already there — the MCP one documents `npx @wastech-mdlint/mcp-server` plus a host-config snippet. The gap is skills: how to install one and how to pin it to a matching CLI version.

2. **Leave the generated blocks alone.** The rule table is produced by `generateRuleDocs` and the MCP tool inventory by `generateToolInventory`, both wired into `scripts/generate-docs.mjs` and byte-compared by sync tests (`packages/core/test/docs-sync.test.ts`, `packages/mcp-server/test/docs-sync.test.ts`). Hand-editing either makes the gate red at the next run. Regenerate with `npm run generate:docs`.

3. **Write `CHANGELOG.md`.** No migration guide is needed: nothing has been published, so there is no version anyone can be migrating from.

## Done when

- [ ] The README covers CLI, MCP and skills install paths with correct package and bin names.
- [ ] The rule table and the MCP tool list are still generated and still sync-checked.
- [ ] `CHANGELOG.md` exists and describes the first release.
