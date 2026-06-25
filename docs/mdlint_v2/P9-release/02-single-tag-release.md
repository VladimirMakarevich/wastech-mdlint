# P9.02 · Single-tag release automation (npm + skills)

> Phase: [P9 — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

One `vX.Y.Z` tag publishes all npm packages and tags the skills together — no version skew
([I4](../requirements/06-installation.md), [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md)).

## Sequence

- **Previous:** [P9.01 — Package metadata](01-package-metadata.md) (publishable packages).
- **Next:** [P9.05 — Release verification](05-release-verification.md).
- **Depends on:** P9.01 · **Parallel with:** P9.03, P9.04 · **Blocks:** P9.05.

## Deliverables / steps

1. Release tooling (e.g. changesets) coupling `@wastech-ctxlint/{core,cli,mcp-server}` to a
   single version; publish on tag.
2. Tag the `skills/*` together with the same `vX.Y.Z`; set each skill's `compatibility` to the
   CLI version ([I7](../requirements/06-installation.md)).
3. Update `.github/workflows/publish.yml` (the P0.07 placeholder) to do the coupled publish
   with provenance.
4. Document the release process (tag → publish → skill tag) in the repo.

## Decisions applied

- [I4](../requirements/06-installation.md) single-tag · [I7](../requirements/06-installation.md)
  skill compatibility · [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md).

## Exit criteria

- [ ] A single tag publishes core+cli+mcp and tags the skills together.
- [ ] Skill `compatibility` matches the published CLI version.
- [ ] Publish runs with provenance.

## Hand-off to next

P9.05 dry-runs and verifies the release end-to-end.
