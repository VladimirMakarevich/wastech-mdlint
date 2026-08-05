# P16.03 · The published payload: maps, `release:check`, engines

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-31](../remediation-backlog-2026-08-05.md) (Medium), [W-30](../remediation-backlog-2026-08-05.md) (Medium), [W-32](../remediation-backlog-2026-08-05.md) (Low, **decision**), [W-33](../remediation-backlog-2026-08-05.md) (Note). Sources: field F-05, F-01, F-03; audit F23, F21. Depends on [P16.02](02-package-metadata.md). Feeds [PR.01](../P-release/01-package-metadata.md), [PR.05](../P-release/05-release-verification.md).

## Goal

Make the published payload cost what it is worth, make the local release check actually check something, and settle whether the Node floor the packages declare means anything.

## Problem

**W-31 — 204 dangling source maps.** `tsconfig.base.json:9-10` enable `declarationMap` and `sourceMap` for every package, and each package's `files` ships `dist` only. Measured rather than sampled: core packs 337 entries including **168** maps, cli 26 including **12**, mcp-server 49 including **24** — **204** maps, with **zero** `src/` entries in any of the three. `dist/index.js.map` has `"sourceRoot":""`, `"sources":["../src/index.ts"]` and **no `sourcesContent`**, and `node_modules/@wastech-mdlint/core/src` does not exist after install. So every map is unresolvable at the consumer, and they are roughly **half** core's 205.8 KB packed size. Today's payload carries the cost of maps with none of the benefit.

**W-30 — `release:check` validates nothing.** `package.json:38` defines it as `npm run typecheck && npm test && npm run build && npm pack --dry-run` — **no workspace flag** — run from a root that is `"private": true` with no `files` field. So it exercises none of the three allowlists. CI does it correctly (`.github/workflows/ci.yml:63`, `npm pack --dry-run -w ${{ matrix.package }}`). Measured: `npm pack --dry-run` at the root packs **445 files** today (442 at the audited commit — tree drift, **not** a regression baseline), including `.github/workflows/ci.yml` and `docs/guide/cli.md`; `-w @wastech-mdlint/cli` packs 26.

The **`release:check` / `npm pack --dry-run`** entry in [`glossary.md`](../glossary.md) is the **only** document describing this script, and it states the inverse: that it "validates each package's published `files` set". A maintainer trusting it believes a gate exists that does not. (The backlog cites it as `glossary.md:275` — correct at the audited commit, shifted since; find it by entry name.)

**W-32 — the `engines` pin is advisory.** `npm ci` prints `EBADENGINE` for the root and all three packages and exits `0`; no `.npmrc` sets `engine-strict`; nothing reads `process.version` at runtime. The whole field test then ran on **`v24.8.0` against a `>=24.17.0` floor** — so the floor is untested in practice, which is the actual finding.

**W-33 — dev-chain advisories (note only).** The workspace reports `9 vulnerabilities (1 low, 3 moderate, 5 high)`; installing the three published tarballs into a bare sandbox reports **`found 0 vulnerabilities`** across 196 packages. The advisories are entirely in the dev chain, so no dependency bump is warranted on this evidence — the correct output is a recorded note.

## Deliverables / steps

1. **W-31 — pick one, all one line:** add `src` to each package's `files`; set `inlineSources` so each map carries its own content; or turn off `declarationMap`/`sourceMap` for published output. This is a release-shape decision that belongs with the `P-release` pack criterion, so record which was chosen and why rather than just changing a flag.
2. **W-31 — note the interaction with [P16.02](02-package-metadata.md):** both edit the same `files` allowlists. Land P16.02 first (as the phase sequence has it) so the allowlist is edited once with both sets of requirements known.
3. **W-30 — add `--workspaces` to the script, or correct the glossary entry.** Prefer the first: the local command and the CI step checking the same thing is the point of having a local command. Note that `--workspaces` packs the path that runs **no lifecycle script** (see the backlog's Parked table), so the script's existing `npm run build` step must stay ahead of the pack — do not reorder it.
4. **W-30 — do not treat 442 as a baseline.** The number moved to 445 through ordinary tree growth. If a count is asserted anywhere, assert a property (no `docs/`, no `.github/`) rather than a total.
5. **W-32 — decide, and decide it jointly with [P16.04](04-dev-tooling-safety.md).** Options: `engine-strict=true` in a root `.npmrc`; a startup guard in `packages/cli/src/index.ts`; or lower the pin to what is actually tested. The WSL wrapper passes `--engine-strict=false` on the one platform combination those scripts exist to cover, so resolving one without the other leaves the contradiction in place.
6. **W-33 — record the evidence** at the release-verification step ([`PR.05`](../P-release/05-release-verification.md)): the workspace count, the sandbox count, and the conclusion that the shipped tree installs clean. Evidence, not a bump.
7. **Glossary.** The `release:check` entry must end up describing what the script does. The single-tag-release and supply-chain entries are the neighbours to check while there.

## Out of scope

Automating publish — `PR.02` owns that, and the publish workflow deliberately runs no publish step today. Changing what CI packs: it is already correct.

## Exit criteria

- [ ] Every shipped source map resolves at the consumer, **or** no maps ship; the choice is recorded with its reason.
- [ ] `release:check` and the CI pack step check the same thing, with `npm run build` still ahead of the pack.
- [ ] The glossary's `release:check` entry describes actual behavior.
- [ ] No packed-file **count** is used as a regression baseline; any assertion is a property.
- [ ] The `engines` question is decided in one place, jointly with the WSL wrapper's `--engine-strict=false`.
- [ ] The dev-chain advisory evidence is recorded at `PR.05` as a note.
- [ ] Gates green.
