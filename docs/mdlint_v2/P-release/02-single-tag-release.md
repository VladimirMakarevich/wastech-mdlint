# PR.02 · Single-tag release automation (npm + skills)

> Phase: [P-release — Release](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

One `vX.Y.Z` tag publishes all npm packages and tags the skills together — no version skew ([I4](../requirements/06-installation.md), [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md)).

## Sequence

- **Previous:** [PR.01 — Package metadata](01-package-metadata.md) (publishable packages).
- **Next:** [PR.05 — Release verification](05-release-verification.md).
- **Depends on:** PR.01 · **Parallel with:** PR.03, PR.04 · **Blocks:** PR.05.

## Deliverables / steps

1. Release tooling (e.g. changesets) coupling `@wastech-mdlint/{core,cli,mcp-server}` to a single version; publish on tag.
2. Tag the `skills/*` together with the same `vX.Y.Z`; set each skill's `compatibility` to the CLI version ([I7](../requirements/06-installation.md)).
3. Update `.github/workflows/publish.yml` (the P0.07 placeholder) to do the coupled publish with provenance.
4. Document the release process (tag → publish → skill tag) in the repo.
5. **Audit follow-up (L-11, tracked here, not resolved in P10):** add a test that asserts each `SKILL.md` `compatibility` field names the CLI version this tag publishes. Pre-release the field is prose (`"Version-coupled to @wastech-mdlint/cli…"`) with no test tying it to the package version — acceptable at `v0.0.0`, but once this task stamps a real `vX.Y.Z` the I7 coupling needs a machine check, not just a manual convention ([audit L-11](../audit-2026-07-23-p0-p8.md)).

## Decisions applied

- [I4](../requirements/06-installation.md) single-tag · [I7](../requirements/06-installation.md) skill compatibility · [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md).

## Exit criteria

- [ ] A single tag publishes core+cli+mcp and tags the skills together.
- [ ] Skill `compatibility` matches the published CLI version.
- [ ] Publish runs with provenance.
- [ ] A test guards skill `compatibility` against the published CLI version (closes audit L-11).

## Hand-off to next

PR.05 dry-runs and verifies the release end-to-end.
