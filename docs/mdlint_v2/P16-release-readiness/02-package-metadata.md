# P16.02 · Package publish metadata: README, LICENSE, `repository`

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-29](../remediation-backlog-2026-08-05.md) (High). Sources: field F-04 (major). Depends on [P15](../P15-output-contracts/index.md). Feeds [PR.01](../P-release/01-package-metadata.md).

## Goal

Make each published package a page a stranger can read: its own README, the license text it already claims, and a link back to the source.

## Problem

Every tarball contains only `package.json` + `dist/` (`cli` additionally `schema.json`). Verified: `find packages -maxdepth 2 \( -iname 'README*' -o -iname 'LICENSE*' \)` returns **empty** — no `README*` or `LICENSE*` exists anywhere under `packages/`. Both live at the repository root only, so npm's automatic README/LICENSE inclusion has nothing local to pick up. All three packages declare `"license": "MIT"` with **no license text in the payload**, and all three omit `repository`, which the root manifest does set.

**Why it stayed invisible.** Nothing asserts on tarball contents, and `PR.02`'s `npm pack --dry-run --workspaces` prints the payload without judging it. The defect becomes visible only **after** publishing — three blank npm pages with no source link — which is the worst moment to find it and the one moment it cannot be undone.

**Relationship to `PR.01`.** [`PR.01`](../P-release/01-package-metadata.md) owns "Finalize per-package publish metadata + supply chain" and its exit criterion covers bins/exports/`files`/`engines`/`publishConfig` + provenance. It does **not** mention README, LICENSE, or `repository` — which is precisely how these three were missed. This task closes that gap and its result should be folded into `PR.01`'s criterion rather than tracked separately at release time.

## Deliverables / steps

1. **A per-package `README.md`** for each of `core`, `cli`, `mcp-server`. Not a copy of the root README: each has a different audience — a library consumer, a CLI user, an MCP host operator. Keep them short and let each link to the root docs rather than duplicating the rule table, which is generated and would become a second thing to keep in sync.
2. **A LICENSE in each payload.** A copied file is simplest and survives `npm pack` cleanly; a symlink is smaller but its behavior inside a tarball is worth verifying rather than assuming. Whichever is chosen, the packed tarball must contain readable MIT text, since all three manifests already claim it.
3. **`repository` with `directory`** in each manifest, pointing at the monorepo and the package's subdirectory — the `directory` field is what makes npm link to the right subtree rather than the repo root.
4. **Extend each package's `files` allowlist** so the new files actually ship. This is the step it is easy to forget: adding `README.md` to a package whose `files` is `["dist"]` changes nothing.
5. **Assert it.** A test or release check that reads each packed tarball and requires a README entry, a license entry, and a `repository` field. Without this the finding recurs the moment an allowlist is edited — and asserting on tarball contents is exactly what nothing does today.
6. **Fold into `PR.01`.** Add the three items to that task's exit criterion so the release phase measures them, and note there that P16.02 delivered them.

## Out of scope

The `files` allowlist's other contents — source maps, `src` — that is [P16.03](03-published-payload.md), which depends on this task precisely because the allowlist is the shared surface. Rewriting the root `README.md`: `PR.04` owns that.

## Exit criteria

- [ ] Each of the three packages has its own `README.md`, written for that package's audience.
- [ ] Each packed tarball contains readable MIT license text.
- [ ] Each manifest declares `repository` with the correct `directory`.
- [ ] Each package's `files` allowlist includes the new files, verified by packing rather than by reading the manifest.
- [ ] A test or release check asserts README + license + `repository` per package, and fails if an allowlist drops one.
- [ ] `PR.01`'s exit criterion names these three items.
- [ ] Gates green.
