# P3.08 · Declarative `custom` rule

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Expose the primitive vocabulary directly to config as a `custom` rule so teams add new
invariants **without rebuilding or publishing** ([R9 Tier 1](../requirements/02-rules-engine.md)).

## Sequence

- **Previous:** the built-in families ([P3.02–P3.06](index.md)) proved each primitive works in
  real rules.
- **Next:** [P3.09 — Tests + cutover](09-rule-tests-and-cutover.md).
- **Depends on:** P3.02–P3.06 (primitives exercised) · **Blocks:** P3.09.

## Inputs (from previous work)

- The closed primitive vocabulary (P2.02) and registry (P2.03); schema generation (P2.06).

## Deliverables / steps

1. Register a `custom` rule whose config entry is
   `{ rule: "custom", id, description, severity?, target, options: { files?, exclude?, assert } }`,
   where `assert` is a discriminated union over the primitive `kind`s.
2. Enforce a **user-chosen namespaced `id`** that cannot collide with built-in canonical IDs
   ([C3](../requirements/01-configuration.md)) — decided 2026-07-02, audit 3.5:
   - **Grammar:** `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$` — uppercase dash-separated segments, at least
     one dash (e.g. `REQ-OWNER`, `ADR-001`, `TEAM-STYLE-01`). Input is case-insensitive and
     normalized to canonical uppercase (C3).
   - **No built-in prefix:** the first segment must **not** be a built-in prefix. The reserved
     set is **derived from the registry** (the prefixes of all built-in rule IDs, [P2.03](../P2-rule-engine/03-registry-metadata.md)),
     so it never drifts and blocks collisions with current *and* future built-ins.
   - **Enforced twice:** the generated `schema.json` ([P2.06](../P2-rule-engine/06-schema-generation.md))
     bakes the current built-in prefixes into a negative-lookahead `pattern` (editor-time); the
     registry/loader runtime check is authoritative and emits a [C7](../requirements/01-configuration.md)
     diagnostic (e.g. `id "REF-100": "REF" is a reserved built-in prefix — use your own
     namespace, e.g. "REQ-100"`). Validate the rest of the entry via the primitive's Zod schema.
3. Ensure the generic `custom` shape is part of the generated `schema.json`
   ([P2.06](../P2-rule-engine/06-schema-generation.md)) so editors validate it.
4. Confirm `custom` rules run inside the MCP server (data-only, never code-plugins —
   [M8](../requirements/05-mcp-server.md)/[R9 Tier 2 deferred](../requirements/02-rules-engine.md)).

## Decisions applied

- [R9](../requirements/02-rules-engine.md) declarative custom rules · [C3](../requirements/01-configuration.md)
  IDs · [M8](../requirements/05-mcp-server.md) MCP safety.

## Exit criteria

- [ ] A `custom` rule defined purely in config runs and reports findings, no rebuild.
- [ ] Custom IDs are validated and cannot shadow built-ins.
- [ ] `custom` validates against the generated schema.

## Hand-off to next

P3.09 documents custom rules in the README and confirms the schema covers them; the whole
rule surface (built-in + LLM + custom) is then complete.
