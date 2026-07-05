# P8.03 · `wastech-mdlint-fix` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Author the fix skill — a policy layer that delegates **mechanical** fixes to the deterministic
core `--fix` and reserves judgement calls for the AI.

## Sequence

- **Previous:** [P8.01 — Frontmatter schema](01-frontmatter-schema-model.md) and the `--fix`
  engine ([R2](../requirements/02-rules-engine.md), [P3](../P3-rules/index.md)).
- **Next:** [P8.05 — Skills validation](05-skills-validation.md).
- **Depends on:** P8.01, P3 (`--fix`) · **Parallel with:** P8.02, P8.04.

## Deliverables / steps

1. `skills/wastech-mdlint-fix/SKILL.md` with valid frontmatter.
2. Workflow: verify setup → run `lint --format json` → **apply core `--fix`** for the
   deterministic-fixable subset → handle the rest by rule prefix. Core `--fix` is
   **document-scope only** (`applyFixes` runs only rules with `scope: "document"` and a `fix`), and
   the locked v2 `fixable` subset (audit 4.2) is exactly **SEC-001** (insert missing
   required-section heading scaffold at EOF) and **TBL-002** (fill empty cell with `TODO`).
   Everything else is the skill's own AI/user policy, not core:
   - SEC-002 (reorder) and SEC-003 (project-template) are `fixable:false` — reserved for AI/user
     judgement, never core `--fix`;
   - REF-* fix typos, ask for genuinely missing targets (AI judgement — not core `--fix`);
   - TBL-* allowed-value violations → ask (only the empty-cell case is core `--fix`);
   - CTX-* (incl. checklist completeness CTX-002), GRP-*, LLM-*, SIZE-*, STR-* (project-scope
     required-files) require user confirmation or are not auto-fixable. (There is no `CHK`
     family — checklist is `CTX-002`.)

   The per-rule fix-support policy is the generated rule table in `README.md` (the `Fixable`
   column, produced by `generateRuleDocs` and kept in sync by the `docs-sync` test) — read that
   committed table, not a hardcoded list. No CLI/MCP command emits it in the current surface.
3. Re-run `lint` to confirm; summarize auto-fixed vs needs-attention.
4. Host-neutral; placeholders replaced ([S7](../requirements/04-skills-compile.md)).

## Decisions applied

- [S8](../requirements/04-skills-compile.md) delegate to `--fix` · [S7](../requirements/04-skills-compile.md)
  host-neutral · [R2](../requirements/02-rules-engine.md) fix engine.

## Exit criteria

- [ ] Skill uses core `--fix` for mechanical fixes; escalates judgement calls.
- [ ] Fix policy table per rule prefix encoded; re-runs lint to confirm.

## Hand-off to next

P8.05 validates this skill; `-impact` recommends `-fix` after analysis.
