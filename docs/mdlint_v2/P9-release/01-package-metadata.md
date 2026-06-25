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

1. Per-package `package.json`: `name`, `bin` (`wastech-ctxlint`, `wastech-ctxlint-mcp`),
   `exports` (+ types), `files` allowlist, `engines.node` (`>=24.17.0 <25`),
   `publishConfig.access: "public"` + **provenance** ([I5](../requirements/06-installation.md)).
2. Ensure `core` is a published dependency of `cli`/`mcp-server` (resolve `workspace:*` on
   publish to the real version).
3. Ship the generated `schema.json` in the `cli` (and/or `core`) package `files`
   ([C9](../requirements/01-configuration.md)).
4. Confirm no stray dev/test files are packed (`npm pack --dry-run`).

## Decisions applied

- [I5](../requirements/06-installation.md) supply chain · [C9](../requirements/01-configuration.md)
  ship schema.

## Exit criteria

- [ ] All three packages have correct, minimal publish metadata + provenance.
- [ ] `workspace:*` resolves to real versions on publish.
- [ ] `npm pack --dry-run` clean per package; schema shipped.

## Hand-off to next

P9.02 wires the release workflow that publishes these packages under one tag.
