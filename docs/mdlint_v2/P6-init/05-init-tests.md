# P6.05 · `init` tests & fixtures

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

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

- [ ] `--yes` config is deterministic, canonical, locally-schema'd, and lints clean.
- [ ] Layout/monorepo/existing-config cases covered.
- [ ] Phase P6 [exit criteria](index.md) satisfied.

## Hand-off to next

P7 builds the MCP server; P8's `-init` skill wraps this command. The CLI now stands on its
own for bootstrap.
