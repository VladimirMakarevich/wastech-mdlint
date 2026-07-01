# P8.04 · `wastech-mdlint-impact` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Author the blast-radius skill that wraps the impact engine (CLI or MCP) and presents
actionable findings.

## Sequence

- **Previous:** [P8.01 — Frontmatter schema](01-frontmatter-schema-model.md) and the impact
  surface (CLI [P4.07](../P4-graph/07-cli-graph-slice-impact.md) / MCP [P7.03](../P7-mcp-server/03-graph-tools.md)).
- **Next:** [P8.05 — Skills validation](05-skills-validation.md).
- **Depends on:** P8.01, P4, P7 · **Parallel with:** P8.02, P8.03.

## Deliverables / steps

1. `skills/wastech-mdlint-impact/SKILL.md` with valid frontmatter.
2. Workflow: verify setup (recommend REF-001/GRP-001 enabled) → resolve target (file or ID →
   containing file) → run `impact <file> --format json` **or** prefer the MCP
   `impact-analysis` tool when available → group direct/transitive, highlight hubs/cycles →
   recommend follow-ups (often `-fix`).
3. Host-neutral; placeholders replaced ([S7](../requirements/04-skills-compile.md)).

## Decisions applied

- [S7](../requirements/04-skills-compile.md) host-neutral · prefers MCP tool when present
  ([M2](../requirements/05-mcp-server.md) honest semantics).

## Exit criteria

- [ ] Skill resolves a target and reports direct/transitive impact with follow-ups.
- [ ] Uses CLI or MCP; frontmatter valid; host-neutral.

## Hand-off to next

P8.05 validates all three skills together and checks host-neutrality.
