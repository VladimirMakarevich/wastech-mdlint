# Phase P8 — Static Agent Skills

> Roadmap: [v2 Index](../index.md) · Phase **P8** · Size **S–M** · Status **Not started** ·
> Depends on [P6](../P6-init/index.md), [P7](../P7-mcp-server/index.md).
>
> **Goal:** ship the three hand-authored, host-neutral Agent Skills (`-init`, `-fix`,
> `-impact`) that orchestrate the CLI/MCP surface, validated by a typed frontmatter schema.

## Why this phase exists

Skills are workflow instructions the AI host executes — a contract over the product surface
(CLI commands, config, MCP tools). v2 applies the
[skills requirements](../requirements/04-skills-compile.md): a frontmatter schema +
validation ([S1](../requirements/04-skills-compile.md)), a unified skill model
([S5](../requirements/04-skills-compile.md)), host-neutral content + replaced placeholders
([S7](../requirements/04-skills-compile.md)), and `-fix` delegating to the deterministic
`--fix` ([S8](../requirements/04-skills-compile.md)). Distribution stays vendor-neutral per
[vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md).
A 4th skill is [S9 backlog](../requirements/04-skills-compile.md).

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P8.01](01-frontmatter-schema-model.md) | Frontmatter schema + unified skill model | S | P7 done |
| [P8.02](02-skill-init.md) | `wastech-mdlint-init` skill | S | P8.01, P6 |
| [P8.03](03-skill-fix.md) | `wastech-mdlint-fix` skill | M | P8.01, P3 (`--fix`) |
| [P8.04](04-skill-impact.md) | `wastech-mdlint-impact` skill | S | P8.01, P7 |
| [P8.05](05-skills-validation.md) | Skill validation tests + host-neutrality check | S | P8.02–P8.04 |

## Sequence

```
(P6/P7) ─► P8.01 ─┬─► P8.02 ─┐
                  ├─► P8.03 ─┼─► P8.05 ─► (Phase P9)
                  └─► P8.04 ─┘
```

> Per-task dependencies are narrower than the phase-level "P6, P7": P8.01 and the `-impact` MCP
> path need P7; `-init` (P8.02) needs P6; `-fix` (P8.03) needs only the P3 `--fix` engine, so it
> can be authored ahead of P6/P7 once P8.01's schema exists.

## Decisions applied

- [S1, S5, S7, S8](../requirements/04-skills-compile.md) · [S9 backlog](../requirements/04-skills-compile.md) ·
  [vendor-neutral skill distribution](../decisions/vendor-neutral-skill-distribution.md) vendor-neutral.

## Phase exit criteria

- [ ] `skills/wastech-mdlint-{init,fix,impact}/SKILL.md` exist with valid frontmatter
      (schema-checked, S1) and the unified skill model (S5).
- [ ] Content is host-neutral (no Claude-specific syntax, the vendor-neutral skill distribution decision); placeholders replaced
      with `VladimirMakarevich/wastech-mdlint` (S7).
- [ ] `-fix` delegates mechanical fixes to core `--fix`; reserves judgement for the AI (S8).
- [ ] Skills install via `gh skill install` and reference the real CLI/MCP surface.

## What P8 unblocks

- **P9** — skills are tagged together with the npm packages under one version (I4/I7).
