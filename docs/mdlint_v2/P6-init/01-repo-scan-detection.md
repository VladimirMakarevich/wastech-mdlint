# P6.01 · Repo scan — doc clusters + package-manager detection

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Give `init` the situational awareness to propose good defaults: where the docs are and which
package manager the repo uses.

## Sequence

- **Previous:** [P3.09 — Rule tests & cutover](../P3-rules/09-rule-tests-and-cutover.md)
  (the rule set `init` will choose from).
- **Next:** [P6.02 — Rule inference](02-rule-inference.md).
- **Depends on:** P3 done (rules/categories exist) · **Blocks:** P6.02.

## Deliverables / steps

1. Scan for doc clusters: directories with ≥ N Markdown files; boost known layouts
   (`docs/`, `documentation/`, `specs/`, `adr/`, `references/`), handle monorepos — **don't**
   hardcode `docs/` ([I2](../requirements/06-installation.md)).
2. Detect the package manager from lockfiles (bun > pnpm > yarn > npm).
3. Return a structured scan result (clusters + sample file candidates + detected manager).

## Decisions applied

- [I2](../requirements/06-installation.md) smart scanning (no hardcoded layout).

## Exit criteria

- [ ] Clusters detected across common + custom layouts; monorepo-aware.
- [ ] Package manager detected from lockfiles.

## Hand-off to next

P6.02 samples files from the detected clusters and infers which rule categories fit.
