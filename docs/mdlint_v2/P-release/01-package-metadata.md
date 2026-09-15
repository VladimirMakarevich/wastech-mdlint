# 01 · Publish metadata, version coupling, and payload shape

> Part of the [release checklist](index.md).

## Goal

Make every package correctly publishable, and make the three versions move together.

## Steps

1. **Audit each `package.json`.** Most of this already shipped; this step confirms it rather than authoring it. In place across all three: `engines.node: ">=24.17.0"` with no upper bound, `publishConfig: { access: "public", provenance: true }`, the bin names (`wastech-mdlint` on `cli`, `wastech-mdlint-mcp` on `mcp-server`), and a `files` allowlist. A library `exports` map applies to `core` only — `cli` and `mcp-server` are bin-only apps and correctly ship none. Also confirm the three fields that a tarball needs and a manifest audit tends to skip, because omitting them once shipped unnoticed: a per-package `README.md`, MIT `LICENSE` text inside the payload, and `repository` carrying the package's own `directory` subpath.

2. **Bump the version and every internal pin in one change.** Internal dependencies are exact literal pins (`"@wastech-mdlint/core": "0.0.0"`), which is the npm-workspaces convention — there is no `workspace:*` protocol here, so nothing is rewritten at publish time. A release that bumps the three `version` fields but leaves the pins behind publishes a `cli` and an `mcp-server` that depend on a `core` version nobody ever published, and npm resolves that at install time, not at publish time. The failure therefore reaches users rather than the release.

3. **Confirm `cli` still ships `schema.json`.** It is the one payload file present only because the allowlist names it, and it is what makes `$schema` resolution work offline from the installed package: config files point at a relative path into `node_modules`, never at a URL, so an editor validates against the version actually installed.

4. **Pack each package and read the payload.** `dist` present, `cli`'s `schema.json` present, no dev or test files leaking. **The payload ships no source maps**, deliberately: `declarationMap` and `sourceMap` are off in `tsconfig.base.json`. The maps were not merely unused, they were unresolvable — each emitted `"sources":["../src/…"]` with no `sourcesContent` into a tarball whose allowlist is `dist`-only, so nothing at the consumer could ever open one, and they were roughly half of core's packed size. The two ways to make them resolvable both grow the payload to buy a benefit two of the three packages cannot use: `inlineSources` embeds the source text into both the `.js.map` and the `.d.ts.map`, and adding `src` to `files` ships the whole source tree. The `repository.directory` field from step 1 already gives a consumer who wants source a link to the exact subtree. The cost is local as well as consumer-side: a file inside a referencing project's `include` still gets project-reference redirect to source for go-to-definition, but a file in no tsconfig — any test file — now resolves `@wastech-mdlint/core` to `dist/index.d.ts` instead of source. Anyone restoring published maps should state which of the two payload costs they are buying.

## Done when

- [ ] All three packages' publish metadata and provenance are verified (`core` has `exports`; `cli` and `mcp-server` are bin-only and have none).
- [ ] Package versions and internal `@wastech-mdlint/*` pins move in lockstep; no stale pin ships.
- [ ] `cli` ships `schema.json`.

Payload shape — per-package README and LICENSE, `repository.directory`, no source maps, nothing outside each allowlist — is asserted against the packed tarballs by `packages/core/test/package-payload.test.ts`, so it is measured by running the gate rather than re-checked by hand.
