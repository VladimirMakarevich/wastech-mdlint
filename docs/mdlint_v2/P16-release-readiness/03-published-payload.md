# P16.03 · The published payload: maps, `release:check`, engines

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Backlog: [W-31](../remediation-backlog-2026-08-05.md) (Medium), [W-30](../remediation-backlog-2026-08-05.md) (Medium), [W-32](../remediation-backlog-2026-08-05.md) (Low, **decision**), [W-33](../remediation-backlog-2026-08-05.md) (Note). Sources: field F-05, F-01, F-03; audit F23, F21. Depends on [P16.02](02-package-metadata.md). Feeds [PR.01](../P-release/01-package-metadata.md), [PR.05](../P-release/05-release-verification.md).

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

- [x] Every shipped source map resolves at the consumer, **or** no maps ship; the choice is recorded with its reason.
- [x] `release:check` and the CI pack step check the same thing, with `npm run build` still ahead of the pack.
- [x] The glossary's `release:check` entry describes actual behavior.
- [x] No packed-file **count** is used as a regression baseline; any assertion is a property.
- [x] The `engines` question is decided in one place, jointly with the WSL wrapper's `--engine-strict=false`.
- [x] The dev-chain advisory evidence is recorded at `PR.05` as a note.
- [x] Gates green.

## Implementation notes

**W-31 — maps off.** `tsconfig.base.json` sets `declarationMap: false, sourceMap: false`, the third of the three options and the only one that does not grow the payload. Every map already pointed at a `../src` no tarball ships (`"sources":["../src/index.ts"]`, no `sourcesContent`), so removing them removes cost without removing a benefit — and `cli`/`mcp-server` are bin-only apps that could not use `inlineSources` either way. `repository.directory` (P16.02) already gives a consumer who wants source a link to the exact subtree. No `files` allowlist edit was needed under this choice. One-time measurement, not a baseline: `npm pack --dry-run --workspaces` on 2026-08-07 packed core 337 → 159, cli 26 → 16, mcp-server 49 → 31. Local DX cost, stated rather than left implicit: cross-package go-to-definition still lands in source for a file inside a referencing project's `include` (`cli`/`mcp-server` reference `core` via `tsconfig.json`, so the project-reference redirect still resolves those), but a file in **no** tsconfig — any test file, per `.agents/rules/testing.md` — now resolves `@wastech-mdlint/core` to `dist/index.d.ts` instead of source. That is the accepted cost.

**Stale-`dist` trap.** Flipping the flags does not delete already-emitted `.map` files, and neither `tsc -b` (content-aware up-to-dateness) nor `assertBuilt()` (mtime comparison against `src/index.ts`) can see leftover maps. The fix required `rm -rf packages/*/dist && npx tsc -b --force` before the payload suite could pass; the map assertion's failure message names that remedy directly rather than pointing at `npm run build`, which does not clear it.

**W-30 — `--workspaces`.** `release:check` gained the flag; `npm run build` stays ahead of the pack because `--workspaces` runs no lifecycle script. `lint`/`format` stay out of the script deliberately — `PR.05` deliverable 1 owns that omission — and the glossary entry now names it. The **Single-tag release** entry, the deliverable's other named neighbour, was checked and needs no change: it describes I4 tag mechanics, which this task does not touch.

**W-32 — `engine-strict=true`.** Decided and delivered here: root `.npmrc` sets `engine-strict=true`; `engines.node` stays at `>=24.17.0`; no runtime guard. Lowering the pin would contradict I5 plus `.node-version`/`.nvmrc`/README/getting-started; a runtime guard would reject a Node the field test showed works (`v24.8.0`) and duplicate the floor in a second, driftable place. `engine-strict` is the only lever that binds **our own** installs — it cannot bind a consumer's, since that is the installer's config, not the package's, which is why the consumer-side half is accepted rather than fixed (one row in `docs/mdlint_v2/accepted-behaviors.md`, stated for users in `docs/guide/getting-started.md` and `README.md`). Joint with [P16.04](04-dev-tooling-safety.md): that task drops `scripts/run-npm-windows.sh`'s `--engine-strict=false` and defers to this decision rather than re-deciding it.

**W-33 — evidence, not a bump.** Recorded at [`PR.05`](../P-release/05-release-verification.md): 9 workspace vulnerabilities, 0 in the sandbox install of the three tarballs, dev-chain-only, no dependency bumped.

**Sixth `@boundary-guard` category declined.** P16.02 deferred the question of whether this task's payload-shape guards need a sixth process-boundary category to this task. They don't: the five categories in `.agents/rules/testing.md` answer one systemic cause (nothing tested the process boundary), and this task's guards are in-process assertions over a tarball the same test process created — no new boundary is crossed. Adding one would mean editing both that file and `packages/core/test/boundary-guards.test.ts` for a distinction the existing categories don't need.
