# 05 · Release gate and end-to-end launch verification

> Part of the [release checklist](index.md).

## Goal

Prove the release works across all three install channels before the tag is cut.

## Steps

1. **Run the full gate.** `npm run release:check` is `npm run typecheck && npm test && npm run build && npm pack --dry-run --workspaces`; it omits `lint`, `format` and `lint:docs`, so a pre-tag run adds those explicitly. (`publish.yml`'s readiness job does run `lint` and `format`, which is why the omission has never turned CI red — it only affects a local run.) Two ordering facts are load-bearing and should survive any later edit to that chain: `--workspaces` is what makes the pack step exercise the three packages' allowlists rather than the root, which is `private: true` and has none; and `npm run build` must stay ahead of the pack, because the cross-workspace pack path runs no lifecycle script and nothing else re-emits `dist` for it.

2. **Smoke the three channels against packed artifacts, not the workspace.**
   - CLI: install the packed `cli` into a clean directory, then `init` → `lint` → `graph` / `slice` / `impact` → `compile`.
   - MCP: boot `wastech-mdlint-mcp` over stdio and confirm it advertises and answers all six tools.
   - Skills: confirm each skill installs and that the commands and tool names it references exist in the published surface.

   Run the corpus half against a repository we did not author. Our own fixtures are shaped by the assumptions the code already makes, so they cannot reveal the assumption itself — every defect this smoke has ever caught came from a tree with an unfamiliar shape: documentation under dot-directories, a nested dependency tree, a gitignored build output.

3. **Dry-run the publish.** The `publish.yml` readiness job already runs the gate and `npm pack --dry-run --workspaces` on `v*` tags. Verify against that job rather than building a second dry-run beside it.

4. **Walk the process-boundary guard categories.** `packages/core/test/boundary-guards.test.ts` proves each category still has a tagged guard, but only a reader can confirm that a newly added subsystem did not ship without one. That check has no automated form and is worth one pass before a release.

## Dependency advisories: which number to take

`npm audit` over the workspace and `npm audit` over what actually ships answer different questions, and mixing them is how a real advisory hides inside dev-chain noise.

The production half is continuously gated: `ci.yml` runs `npm audit --omit=dev --audit-level=high`. The workspace half is not, and this step is the only place it gets taken. The last measurement — one date, not a baseline — reported 9 workspace vulnerabilities (1 low, 3 moderate, 5 high) while installing the three packed tarballs into a bare sandbox reported 0 across 196 packages. Every advisory was therefore in the tooling that builds and tests the packages, none of which ships.

**No dependency was bumped on that evidence, deliberately.** A bump justified by an advisory no consumer can reach buys nothing and moves the lockfile the CI matrix is pinned to. Re-take both numbers at release time; the conclusion to re-establish is "the shipped tree installs clean", not "the counts still match".

## Done when

- [ ] The full gate is green and the publish dry-run succeeds.
- [ ] The end-to-end smoke passes for CLI, MCP and skills against packed artifacts.
- [ ] The bare-sandbox install of the three tarballs reports no vulnerabilities.
