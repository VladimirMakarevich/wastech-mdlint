# P8.03 · `wastech-mdlint-fix` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

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
   - REF-\* fix typos, ask for genuinely missing targets (AI judgement — not core `--fix`);
   - TBL-\* allowed-value violations → ask (only the empty-cell case is core `--fix`);
   - CTX-_ (incl. checklist completeness CTX-002), GRP-_, LLM-_, SIZE-_, STR-\* (project-scope
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

- [x] Skill uses core `--fix` for mechanical fixes; escalates judgement calls.
- [x] Fix policy table per rule prefix encoded; re-runs lint to confirm.

## Hand-off to next

P8.05 validates this skill; `-impact` recommends `-fix` after analysis.

## Implementation notes

`skills/wastech-mdlint-fix/SKILL.md` is the sole deliverable — a hand-authored, host-neutral
skill, no product code. Frontmatter mirrors P8.02 and uses only the keys P8.01's `.strict()`
schema permits, so it passes P8.05's standing validation sweep.

Non-obvious decisions the prose encodes, and why:

- **Policy sourced from the generated `README.md` table, never a baked-in list.** The skill
  names SEC-001/TBL-002 only as illustrative current state and instructs the AI to read the
  `Fixable` column between the generated-rules markers. This keeps the skill correct as P3 rule
  metadata evolves — the `docs-sync` test already keeps that column honest — without a code
  path to re-derive fixability, which no CLI/MCP command exposes.
- **Three explicit snapshots, not two.** The flow drives from baseline (step 2) → post-fix
  remainder (step 3, captured with `lint --fix --format json`) → final re-lint (step 5). The
  post-fix snapshot is load-bearing because core `--fix` can _surface new findings_ the baseline
  never had — e.g. SEC-001 appends a `TODO` scaffold heading that CTX-001 then flags as
  placeholder-only. Working the manual step from the post-fix remainder is what stops those from
  being missed, and the three states let the summary credit core-fixed vs. manually-fixed
  separately instead of conflating them.
- **`--fail-on off` on every run.** The linter defaults to `--fail-on error` and exits non-zero
  whenever errors remain — the normal state of a fix session. A host treating that as a hard
  failure would abort before parsing findings, so the skill forces exit 0 and judges success
  from findings, not the exit code.
- **Summary built from findings, not a changed-files list.** `handleLint` discards
  `applyFixes`'s `fixedFiles` and the JSON contract emits only `summary`/`messages`/`files`, so
  the skill cannot claim "files `--fix` changed"; it derives affected files from resolved
  findings' `filePath`s across the snapshot deltas instead.
- **Escalation policy is split by actual built-in behavior, with a default-deny tail.** REF is
  broken out per rule (REF-001/002/003 typo-or-ask; REF-004 propose a `Dependencies` edit;
  REF-005 separates dangling references from orphan definitions; REF-006 is a stability-tier
  judgement, not a target-typo fix). Custom / unrecognized rule IDs fall to an explicit
  default-deny case — core never auto-fixes a custom rule, so they are surfaced for user
  judgement and never routed through `--fix`.

Delegates to core `--fix` and never re-implements a rule's deterministic job
([S8](../requirements/04-skills-compile.md), [R2](../requirements/02-rules-engine.md));
placeholders resolve to `VladimirMakarevich/wastech-mdlint` per
[S7](../requirements/04-skills-compile.md). No glossary change: `static skill`,
`SKILL.md`, and the rule IDs referenced are already defined; this is an instance of them, not a
new term.
