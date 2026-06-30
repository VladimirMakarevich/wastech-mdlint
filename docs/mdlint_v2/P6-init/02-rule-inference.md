# P6.02 · Rule inference / category → zero-config rule set

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Turn the scan into a proposed rule set: sample files, detect patterns, and map rule
categories to concrete canonical rule IDs with rationale.

## Sequence

- **Previous:** [P6.01 — Repo scan](01-repo-scan-detection.md) (clusters + samples).
- **Next:** [P6.03 — Interactive prompts](03-interactive-prompts.md).
- **Depends on:** P6.01 + rule metadata ([P2.03](../P2-rule-engine/03-registry-metadata.md)) ·
  **Blocks:** P6.03.

## Deliverables / steps

1. Read 3–5 sample files per cluster; detect patterns (cross-refs, tables, ADR triplets,
   checklists, placeholders, potential cycles).
2. Category → rule mapping (canonical IDs, [C3](../requirements/01-configuration.md)), e.g.:
   `ref` → REF-001/002/003, `tbl` → TBL-002, `ctx` → CTX-001/002,
   `grp` → GRP-001/002. Source the mapping from the rule **metadata** so it stays in sync
   ([R6](../requirements/02-rules-engine.md)).
3. Produce a draft rule set + per-rule rationale string for the prompt step.

## Decisions applied

- [I2](../requirements/06-installation.md) inference · [C3](../requirements/01-configuration.md)
  canonical IDs · [R6](../requirements/02-rules-engine.md) metadata-sourced mapping.

## Exit criteria

- [ ] Sampling produces a justified draft rule set per cluster.
- [ ] Category→rule mapping derives from rule metadata (no hardcoded drift).

## Hand-off to next

P6.03 presents this draft (with rationale) for confirmation, or accepts it as-is under `--yes`.
