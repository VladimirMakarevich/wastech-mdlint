# 02 · Single-tag release automation (npm + skills)

> Part of the [release checklist](index.md).

## Goal

One `vX.Y.Z` tag publishes all three npm packages and tags the skills with them, so no two halves of the product can drift apart in a user's installation.

## Steps

1. Couple `@wastech-mdlint/{core,cli,mcp-server}` to a single version and publish on tag. `core` publishes first: `cli` and `mcp-server` pin it exactly, so publishing them against a registry that does not yet hold that `core` version leaves the first consumer to install them with an unresolvable dependency.

2. Tag the `skills/*` together with the same `vX.Y.Z`, and set each skill's `compatibility` field to the CLI version being published. The skills name CLI commands, flags and MCP tools; a skill pinned to a version whose surface has moved gives an agent instructions the installed binary does not implement.

3. Replace the placeholder in `.github/workflows/publish.yml` with a real publish that runs the full gate first and publishes with provenance.

4. Document the release procedure — tag, publish, skill tag — where whoever cuts the next release will find it.

5. **Add a test that ties `compatibility` to the published version.** Today the field is prose ("Version-coupled to @wastech-mdlint/cli…") with nothing checking it against the package version. That is honest at `0.0.0`, where there is no published version to be wrong about; the moment a real version is stamped, a convention that only a reviewer can enforce is the kind that silently stops being true.

## Done when

- [ ] A single tag publishes all three packages and tags the skills together.
- [ ] Each skill's `compatibility` names the published CLI version.
- [ ] The publish runs with provenance.
- [ ] A test fails when a skill's `compatibility` and the CLI version disagree.
