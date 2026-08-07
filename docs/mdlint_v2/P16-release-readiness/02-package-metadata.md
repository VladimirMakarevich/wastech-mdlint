# P16.02 · Package publish metadata: README, LICENSE, `repository`

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Backlog: [W-29](../remediation-backlog-2026-08-05.md) (High). Sources: field F-04 (major). Depends on [P15](../P15-output-contracts/index.md). Feeds [PR.01](../P-release/01-package-metadata.md).

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

- [x] Each of the three packages has its own `README.md`, written for that package's audience.
- [x] Each packed tarball contains readable MIT license text.
- [x] Each manifest declares `repository` with the correct `directory`.
- [x] Each package's `files` allowlist includes the new files, verified by packing rather than by reading the manifest.
- [x] A test or release check asserts README + license + `repository` per package, and fails if an allowlist drops one.
- [x] `PR.01`'s exit criterion names these three items.
- [x] Gates green.

## Implementation notes

### The license the repository declared was not the license it shipped

Six declarations said MIT — the root manifest, the three package manifests, and three `skills/*/SKILL.md` frontmatters — while the root `LICENSE` was the Apache-2.0 text, with an accompanying `NOTICE` satisfying Apache-2.0 §4(d). Deliverable 2 asks for "readable MIT text, since all three manifests already claim it", which cannot be satisfied by copying a file that says something else, so the contradiction had to be resolved before anything could be copied.

**Resolved in favor of MIT**, copyright line `Copyright (c) 2026 Vladimir Makarevich`: the root `LICENSE` now holds the canonical MIT text, and byte-identical copies sit in each package. No `license` field changed anywhere.

Two consequences worth stating rather than leaving latent:

- **`NOTICE` was removed.** It existed only to carry Apache-2.0's attribution requirement and said so in its own text ("Licensed under the Apache License, Version 2.0"); MIT has no equivalent obligation, so keeping it would have replaced one license contradiction with a fresher one. Nothing referenced it — no test, script, or doc.
- Nothing depended on the Apache text either. The only other `LICENSE` mentions in the tree are illustrative: the glossary's `STR-001` entry uses it as the example of a required non-Markdown file, and the accepted-behaviors register uses `LICENSE(1)` as a glob-syntax example. `LICENSE` has no extension, so `prettier --check .` never reads it.

### npm force-includes `README*` and `LICENSE*`, so the `files` edit is not what makes them ship

Deliverable 4's rationale — "adding a `README.md` to a package whose `files` is `["dist"]` changes nothing" — is **false for exactly these two filenames**, and a future reader should not re-derive that the hard way. npm's bundled `npm-packlist` injects `!/readme{,.*[^~$]}`, `!/license{,.*[^~$]}` and `!/licence{,.*[^~$]}` into its highest-precedence `strictRules` set (`npm-packlist/lib/index.js:283-286`), matched case-insensitively by `ignore-walk`. A package-root README or LICENSE therefore packs whatever `files` says. The rationale holds for arbitrary files — `cli`'s `schema.json` really does ship only because `files` names it.

The `files` entries were still added: the exit criterion asks for them, they are explicit and harmless, and they keep the allowlist an honest description of the payload. But the guard's teeth come from **the files existing**, which is why `package-payload.test.ts` also asserts `cli`'s `schema.json` — that is the one payload entry with genuine `files` sensitivity, and the assertion that would go red if [P16.03](03-published-payload.md) reshaped an allowlist wrongly.

### Copy, not symlink

Deliverable 2 calls the symlink option "worth verifying rather than assuming". Verified: `npm-packlist`'s walker is constructed with `follow: false` (`npm-packlist/lib/index.js:81`), so a symlinked `LICENSE` packs as a tar symlink entry pointing at `../../LICENSE` — a path that escapes the package root, which `node-tar` refuses on extraction. A Windows checkout without `core.symlinks` would commit a text stub instead of a link. Copies it is; the payload test compares all three against the root file so the four cannot drift.

### The assertion reads tarballs, and had to bring its own reader

`packages/core/test/package-payload.test.ts` packs once in `beforeAll` (`npm pack --workspaces --pack-destination <mkdtemp>`, npm located through `npm_execpath` and spawned as `node <npm-cli.js>` — the one formulation that is both explicit-argv and shell-free on Windows) and asserts only on what comes out: a non-empty `README.md` naming its own package, `LICENSE` text containing `MIT License` and the "AS IS" clause and equal to the root file, and the **payload's own** `package.json` carrying `license: "MIT"` plus `repository` with the right `directory`. Reading the packed manifest rather than the working tree's is what keeps the "do not verify by reading manifests" constraint intact.

Its reader (`packages/core/test/support/read-tarball.ts`) parses ustar headers by hand rather than adding the `tar` package: a guard against a packaging regression should not pay for itself with a new dependency in the tree it guards. There are no packed-file **counts** anywhere — [P16.03](03-published-payload.md) rules a count out as a baseline. Written first and confirmed **red on all three counts** against the pre-fix tree (nine failures; the positive control and the `schema.json` check green throughout), then green once the files landed.

### A sixth `@boundary-guard` category was considered and declined

The payload check fits the shape of a process-boundary guard — it is invisible to the in-process suite for the same structural reason the other five are. It was not added as a category: `AGENTS.md` says keep the five intact, `.agents/rules/testing.md` requires a new category to land in both the prose table and `boundary-guards.test.ts`'s inventory, and this task asks for neither. [P16.03](03-published-payload.md) extends this same test with more payload checks immediately after, so if a `published-payload` category is ever warranted it belongs there, with both halves of the pairing in one change.
