# P9.01 · Finalize per-package publish metadata + supply chain

> Phase: [P9 — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Make every package correctly publishable, building on the [P0.07 baseline](../P0-foundations/07-ci-packaging-baseline.md).

## Sequence

- **Previous:** [P7](../P7-mcp-server/index.md) (mcp-server filled) and [P8](../P8-skills/index.md)
  (skills) — the full surface now exists.
- **Next:** [P9.02 — Single-tag release](02-single-tag-release.md), [P9.03](03-github-action.md),
  [P9.04](04-docs-readme.md).
- **Depends on:** P7, P8 · **Blocks:** P9.02–P9.04.

## Deliverables / steps

1. **Verify** per-package `package.json` — most of this shipped in P0/P3, so this is an audit, not
   fresh authoring. Already in place across all three: `engines.node: ">=24.17.0"` (no upper
   bound), `publishConfig: { access: "public", provenance: true }`, the `bin` names
   (`wastech-mdlint` on `cli`, `wastech-mdlint-mcp` on `mcp-server`), and `files` allowlists.
   Library `exports` (+ types) applies to **`core` only** — `cli`/`mcp-server` are bin-only apps
   and correctly ship no `exports` map. Confirm/add any metadata the P7/P8 surface introduced.
2. Internal deps are exact literal pins (`"@wastech-mdlint/core": "0.0.0"`, the npm-workspaces
   convention — there is **no** `workspace:*` protocol here, so nothing "resolves on publish"). The
   release tool ([P9.02](02-single-tag-release.md)) must bump each package version **and every
   internal `@wastech-mdlint/*` dependency pin** to the same `vX.Y.Z` in one atomic change, so
   published `cli`/`mcp-server` depend on the published `core`, not a stale `0.0.0`.
3. Confirm the generated `schema.json` still ships in `cli`'s `files` (already listed) so editor
   `$schema` resolution works from the installed package
   ([C9](../requirements/01-configuration.md)).
4. `npm pack --dry-run` per package: confirm `dist` (+ `cli`'s `schema.json`) is present and no
   dev/test files leak.

## Decisions applied

- [I5](../requirements/06-installation.md) supply chain · [C9](../requirements/01-configuration.md)
  ship schema.

## Exit criteria

- [ ] All three packages' publish metadata + provenance verified (`core` has `exports`;
      `cli`/`mcp-server` are bin-only, no `exports`).
- [ ] Package version + internal `@wastech-mdlint/*` pins bump in lockstep — no stale `0.0.0`
      dependency ships.
- [ ] `npm pack --dry-run` clean per package; `cli` ships `schema.json`.

## Hand-off to next

P9.02 wires the release workflow that publishes these packages under one tag.
