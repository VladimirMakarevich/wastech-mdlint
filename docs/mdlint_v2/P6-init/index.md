# Phase P6 — `init` command

> Roadmap: [v2 Index](../index.md) · Phase **P6** · Size **M** · Status **Not started** ·
> Depends on [D5](../index.md).
>
> **Goal:** a **smart, self-sufficient** `init` that scans the repo, infers a sensible rule
> set, and writes a valid `wastech-mdlint.config.json` with a local `$schema` — so the CLI
> stands on its own without the AI skill.

## Why this phase exists

Earlier designs split a *dumb* CLI `init` (writes a fixed config) from a *smart* skill-driven
one. v2 applies [I2](../requirements/06-installation.md): the smart inference lives in the CLI
itself
(cluster detection, sampling, rule suggestion, package-manager detection), with `--yes` for
CI; the [`-init` skill](../P8-skills/index.md) (P8) then orchestrates and layers GitHub
Actions/README on top. `init` also wires the **local schema** ([I3](../requirements/06-installation.md)/[C9](../requirements/01-configuration.md))
and replaces the removed `postinstall` ([I1](../requirements/06-installation.md), done in
[P0.02](../P0-foundations/02-root-scaffolding.md)).

## Package placement (core-hosts-the-pipeline)

The deterministic computation — repo scan (P6.01), rule inference (P6.02), and config-text
generation (P6.04) — lives in **`@wastech-mdlint/core`** as pure, unit-tested functions the P8
`-init` skill can also reuse. The CLI `init` command is the thin host boundary: it runs the
`@inquirer/prompts` flow, dispatches, and performs the actual file write. This keeps `init` off a
parallel pipeline (the [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md)
invariant) and lets tests exercise inference without a TTY.

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P6.01](01-repo-scan-detection.md) | Repo scan: doc clusters + package-manager detection | M | P3 done |
| [P6.02](02-rule-inference.md) | Rule inference / category → zero-config rule set | M | P6.01 |
| [P6.03](03-interactive-prompts.md) | Interactive prompts (inquirer) + `--yes` | M | P6.02 |
| [P6.04](04-config-writer-schema.md) | Config writer + local `$schema` wiring (+ optional CI workflow) | M | P6.03 |
| [P6.05](05-init-tests.md) | `init` tests & fixtures | M | all above |

## Sequence

```
(P3.09) ─► P6.01 ─► P6.02 ─► P6.03 ─► P6.04 ─► P6.05 ─► (Phase P7)
```

> P6 depends on the rule engine + schema (P2/P3); it can be detailed/implemented in parallel
> with P4/P5 since it does not need the graph or compile.

## Decisions applied

- [D5](../index.md) commander + inquirer · [I2](../requirements/06-installation.md) smart init ·
  [I3](../requirements/06-installation.md)/[C9](../requirements/01-configuration.md) local schema ·
  [C3](../requirements/01-configuration.md) canonical IDs · [C4](../requirements/01-configuration.md)
  commented config · [I6](../requirements/06-installation.md) optional CI workflow.

## Phase exit criteria

- [x] `init` detects doc clusters + the package manager and proposes a rule set with rationale.
- [x] Interactive flow (include, categories — the "language" prompt named here is confirmed
      dead text, see [P6.03](03-interactive-prompts.md)) + non-interactive `--yes`; Ctrl+C
      exits 0.
- [x] Writes a valid `wastech-mdlint.config.json` (canonical IDs, optional rationale
      comments) with a **local** `$schema`; generates a project schema when custom rules exist.
- [ ] The produced config is structurally valid and loads without a `ConfigError` (canonical IDs,
      local `$schema`). On a **clean** fixture (no violations) `lint` exits 0; a real inferred
      ruleset may legitimately surface findings on non-clean content — that is not a failure.

## What P6 unblocks

- **P8** — the `-init` skill orchestrates this CLI `init` and adds GitHub Actions/README.
- **P9** — the optional workflow file references the published GitHub Action.
