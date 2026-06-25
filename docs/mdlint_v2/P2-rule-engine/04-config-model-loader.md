# P2.04 · New config model + JSONC loader + `findConfig`

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **L** · Status **Not started**.

## Goal

Replace the MVP sectioned config with the new rule-driven model and a JSONC-tolerant loader,
implementing the locked [configuration requirements](../requirements/01-configuration.md).

## Sequence

- **Previous:** [P2.03 — Registry & metadata](03-registry-metadata.md) defined how a `rules[]`
  entry resolves to a `Rule` (canonical IDs, per-rule option validation).
- **Next:** [P2.05 — Orchestration](05-orchestration-lintfiles.md) consumes the loaded config
  to run the pipeline.
- **Depends on:** P2.03 · **Blocks:** P2.05, P2.06.

## Inputs (from previous work)

- MVP `config/{defaults,load}.ts` (Zod-based) in `core` — to be **replaced**, not extended
  ([D2](../index.md), greenfield).
- The full config shape from [01-configuration.md](../requirements/01-configuration.md).

## Deliverables / steps

1. Zod **root schema**: `{ $schema?, include?, exclude?, respectGitignore?, settings?,
   rules: [{ rule, severity?: "error"|"warning"|"off", options? }], compile? }`.
   - top-level `exclude` ([C1](../requirements/01-configuration.md), wins over include);
   - per-rule `severity` ([C2](../requirements/01-configuration.md));
   - `settings.siteRouter` shared/inheritable ([C5](../requirements/01-configuration.md));
   - `respectGitignore` ([C8](../requirements/01-configuration.md)).
2. **JSONC** parsing ([C4](../requirements/01-configuration.md)) — comments + trailing commas;
   file stays `.json`.
3. `findConfig()` walk-up (parent dirs to FS root); `--config` overrides.
4. **Two-stage validation:** root shape here; per-rule options via `resolveRule` (P2.03).
5. **Rich diagnostics** ([C7](../requirements/01-configuration.md)): unknown keys, unknown
   rules (did-you-mean), option path errors.
6. Resolve `settings` and pass them into `RuleContext.settings` (per-rule override allowed).

## Decisions applied

- [C1–C9](../requirements/01-configuration.md) · [D2](../index.md) clean replace, greenfield
  (no migration, [I8 not needed](../requirements/06-installation.md)).

## Exit criteria

- [ ] New config parses (JSONC), validates two-stage, rejects unknown keys with clear errors.
- [ ] `exclude` wins over `include`; `settings` inheritance works with per-rule override.
- [ ] `findConfig` walk-up + `--config` override covered by tests.

## Hand-off to next

P2.05 receives a validated config + resolved rules + settings and runs `loadDocuments` with
`include`/`exclude`/`respectGitignore`; P2.06 reflects this shape in `schema.json`.
