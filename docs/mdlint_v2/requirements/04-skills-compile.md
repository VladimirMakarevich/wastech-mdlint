# v2 Requirements — 04 · Skills & Compile

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md)
> (Phase **P5** compile, **P8** static skills).
>
> Two layers: **A** generated `SKILL.md` (via `compileContext()`), **B** hand-authored
> static skills (`skills/wastech-ctxlint-{init,fix,impact}/`). Locked v2 requirement;
> authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Layer | Status | Notes |
| --- | --- | --- | --- | --- |
| **S1** | Typed Zod schema + validation for SKILL.md frontmatter | both | ✅ Accepted | Validate static skills in CI + generated output. The "typed model" the spec says is missing. |
| **S2** | Host-neutral / templated command block in generated skill | A | ✅ Accepted | Presets `claude\|generic\|none`; default = plain instructions + MCP-tool reference, not `!npx … $ARGUMENTS`. |
| **S3** | Localizable scaffold template | A | ⛔ Skipped | Generated skill stays English-scaffold (data localized), as in the reference. |
| **S4** | Deterministic, stable generated output | A | ✅ Accepted | Sorted, no timestamps; "generated from N docs, M rules" header + content hash → clean git diffs. |
| **S5** | Unified typed skill model/registry | both | ✅ Accepted | `{ id, kind: "static"\|"generated", path, frontmatter }`. |
| **S6** | LLM context-budget summary inside generated skill | A | ✅ Accepted | Reuses the D3 SIZE/LLM estimator; differentiator tying budget into compile. |
| **S7** | Host-neutral static skills + replace upstream placeholders | B | ✅ Accepted | Swap `vladimir-makarevich` / `wastech-ctxlint.dev` for our repo; no Claude-specific syntax (the vendor-neutral skill distribution decision). |
| **S8** | `-fix` skill delegates to deterministic `--fix` | B | ✅ Accepted | Mechanical fixes → core `--fix` (R2); AI handles only judgement. |
| **S9** | A 4th skill (`-compile` / `-review`) | B | 🔵 Backlog | Next version; keep 3 skills (init/fix/impact) in v2. |

## Detail & rationale

### A. Generated `SKILL.md` (compile)

- **S1 — frontmatter schema.** The spec notes static skills have no runtime validation
  ("process-level only"). v2 defines a Zod schema for SKILL.md frontmatter (`name`,
  `description`, `license`, `compatibility`, `metadata.{homepage,source}`), validates the
  3 static skills in CI, and validates the compiler's output. This *is* the typed model
  the spec says is missing (with S5).

- **S2 — host-neutral commands.** The generated skill hardcodes
  `!npx wastech-ctxlint impact $ARGUMENTS` (Claude-Code command-injection style). The
  spec flags this as less protocol-neutral than the vendor-neutral skill distribution decision wants, and agentskills.io targets
  35+ clients. v2 makes the dynamic-command block a template with host presets
  (`claude` | `generic` | `none`); default emits plain instructions + an MCP-tool
  reference instead of host-specific injection.

- **S4 — determinism.** `SKILL.md` is committed, so output must be byte-stable (sorted,
  no timestamps). Emit a `generated from N docs, M rules` header + content hash so
  regeneration produces meaningful diffs. Formalizes the metadata the reference already
  carries (`documentCount`, `ruleCount`, `componentCount`).

- **S6 — context budget in the skill.** The product is about LLM context hygiene, so the
  generated skill should also report the budget (the [D3](../index.md) SIZE/LLM rules):
  corpus token estimate + entrypoints over budget. Reuses the token estimator — low cost,
  high differentiation.

### B. Static skills

- **S7 — host-neutral + placeholders.** Replace upstream `vladimir-makarevich` /
  `wastech-ctxlint.dev` with `VladimirMakarevich/wastech-ctxlint`; keep all 3 skills
  free of Claude-Code-specific syntax per [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md).

- **S8 — `-fix` delegates to `--fix`.** With deterministic core `--fix`
  ([R2](02-rules-engine.md)), the `-fix` skill runs `--fix` for mechanical corrections
  and reserves AI reasoning for genuine judgement calls (allowed-value violations, missing
  targets). Less brittle, faster, consistent across hosts.

## Skipped / deferred

- **S3 (skipped)** — full scaffold localization. Generated skill stays English-scaffold;
  only data from documents and `compile.skill` is localized, matching the reference. Not
  planned for v2.
- **S9 (backlog, next version)** — a 4th skill driving `compile` or PR review. v2 ships
  exactly `init`, `fix`, `impact`.

## Downstream impact

- **Config (P2):** `compile` section already covers `outdir` / `skill` / `sections`; add
  optional `compile.commandPreset` (`claude|generic|none`, S2).
- **Rule engine (R2/R6):** `--fix` powers S8; `describeRules` reads the rule-metadata
  source and must describe custom rules too.
- **Budget (D3):** estimator feeds S6.
- **MCP (P7):** `compile-context` returns the same deterministic content (S4) and respects
  the command preset (S2).
- **CI (P9):** validates static skills against the frontmatter schema (S1) and the
  unified skill model (S5).
