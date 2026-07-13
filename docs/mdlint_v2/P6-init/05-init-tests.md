# P6.05 · `init` tests & fixtures

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Verify `init` produces a valid, lint-clean config across repo shapes, interactively and with
`--yes`.

## Sequence

- **Previous:** [P6.04 — Config writer](04-config-writer-schema.md).
- **Next:** **Phase P7 — MCP server** (see [roadmap](../index.md)).
- **Depends on:** P6.01–P6.04 · **Blocks:** —.

## Deliverables / steps

1. Fixtures for several layouts: `docs/`, a custom layout (`specs/`, `adr/`), and a small
   monorepo; plus a repo with an existing config.
2. Test `--yes` non-interactive output (deterministic config); assert canonical IDs +
   local `$schema` + no remote URL.
3. Assert the generated config **loads without a `ConfigError`** (structurally valid, canonical
   IDs, local `$schema`); and on a **clean** fixture (content with no violations) that `lint`
   exits 0. Do not assert exit 0 on arbitrary content — a real ruleset can report findings by
   design.
4. Test package-manager detection and existing-config handling (overwrite/merge/skip).

## Decisions applied

- [I2](../requirements/06-installation.md), [C9](../requirements/01-configuration.md) ·
  focused fixtures (AGENTS.md).

## Exit criteria

- [x] `--yes` config is deterministic, canonical, locally-schema'd, and lints clean.
- [x] Layout/monorepo/existing-config cases covered.
- [x] Phase P6 [exit criteria](index.md) satisfied.

## Implementation notes

Decisions that are load-bearing but not obvious from the code:

- **Fixtures are in-memory objects written to a `mkdtemp` dir, not checked-in static
  `fixtures/<scenario>/` directories.** `init` mutates its target tree (it writes the config,
  schema, and optionally a workflow), so a static fixture dir would be written into by the test
  run. Every `init` e2e test uses the `fixtureRepo(files)` helper for this reason; the new
  layout/monorepo/clean cases follow the same convention rather than introducing a second one.
- **"Lints clean" is asserted as the exact zero-messages string, not just exit 0.** `TBL-002`
  and `CTX-002` default to `warning`, so a fixture with lingering warnings would still exit 0
  under the default `--fail-on error` — satisfying the letter of "lint exits 0" while violating
  "content with no violations". The clean-fixture tests assert `formatLintResultText`'s exact
  `"No problems found.\n"` output in addition to `EXIT_CODE_SUCCESS`.
- **Which fixture proves which clean rule path.** `CLEAN_DOCS_FIXTURE` (a surgical clean
  derivation of the cross-linked `docs/` fixture) proves `REF-001/REF-002/TBL-002/CTX-002/GRP-001`
  lint clean; `CUSTOM_LAYOUT_FIXTURE` (`specs/` + `adr/`) additionally proves `SEC-001`'s clean
  path, which the plain-docs fixture never infers.
- **The monorepo fixture is scoped to shape/determinism, not clean-lint.** It proves per-package
  cluster detection, a deterministic sorted root `include` spanning both workspace packages, npm
  detection, and that `loadConfiguration` accepts the result — cleanliness is already covered by
  the docs/ and custom fixtures, so re-proving it per layout would be duplicate coverage.
- **Existing-config handling (overwrite/merge/skip) is not re-tested per new layout.** That path
  is layout-agnostic (it only inspects the existing config file, never the scan result) and is
  already covered against the cross-linked fixture.

## Hand-off to next

P7 builds the MCP server; P8's `-init` skill wraps this command. The CLI now stands on its
own for bootstrap.
