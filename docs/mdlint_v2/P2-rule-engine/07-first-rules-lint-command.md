# P2.07 · First rules through the engine + `lint` command

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

## Goal

Prove the engine end-to-end by porting a few MVP checks as real rules, and introduce the new
`lint` command ([D4](../index.md)) that runs the new pipeline.

## Sequence

- **Previous:** [P2.05 — Orchestration](05-orchestration-lintfiles.md) (the `lintFiles`
  pipeline) and [P2.06 — Schema generation](06-schema-generation.md).
- **Next:** **Phase P3 — the 21 rules + LLM rules** (see [roadmap](../index.md)); it fills out
  the full rule set on this proven engine.
- **Depends on:** P2.05, P2.06 · **Blocks:** confident start of P3.

## Inputs (from previous work)

- The full engine (P2.01–P2.06), the commander CLI scaffold from
  [P0.05](../P0-foundations/05-cli-package-commander.md), and the MVP rule logic in `core`.

## Deliverables / steps

1. Register **proof rules** through the registry/primitives to validate the whole path, e.g.:
   - a reference rule (`REF-001` link resolution — reuses MVP link logic);
   - one of the preserved LLM rules (`SIZE-001` bytes/lines/tokens with per-metric `warn`/`error`
     thresholds, [D3](../index.md)) to prove the LLM features survive the re-platform.
2. Add the `lint` command to the commander program: default command
   ([D4](../index.md)), `--config`/`--format`/`--fail-on`, exit codes (0 pass / 1 findings /
   2 operational), running `lintFiles` + structured/text formatters.
3. **Coexistence plan:** keep the MVP `scan` (old pipeline) running until P3 completes; at the
   **end of P3**, make `scan` a hidden alias of `lint` and remove the old pipeline
   ([D4](../index.md)). Record this explicitly so P3 closes it out.
4. Default `$schema` wiring to the local file (P2.06) when the engine writes/needs config.

## Decisions applied

- [D4](../index.md) `lint` default + `scan` alias (alias at end of P3) · [D3](../index.md)
  LLM rule survives · [R1/R3](../requirements/02-rules-engine.md) severity + structured output.

## Exit criteria

- [ ] `wastech-ctxlint lint` runs the new engine on the proof rules with correct exit codes.
- [ ] A reference rule and an LLM rule both produce structured findings.
- [ ] Coexistence/alias plan for `scan` recorded for P3 to finish.
- [ ] Phase P2 [exit criteria](index.md) satisfied.

## Hand-off to next

P3 implements all 21 built-ins as primitive presets + the `custom` rule + the remaining LLM
rules, then flips `scan` to a `lint` alias and removes the legacy pipeline.
