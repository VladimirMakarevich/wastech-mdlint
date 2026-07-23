# Agent skills

> [Guide index](README.md) · [Compile](compile.md) · [MCP server](mcp-server.md)

`wastech-mdlint` ships **3 hand-authored, host-neutral Agent Skills** that orchestrate the CLI/MCP
surface. They are workflow instructions an AI host executes — a contract over the product surface,
not code. They live under [`skills/`](../../skills):

| Skill | Purpose |
| --- | --- |
| [`wastech-mdlint-init`](../../skills/wastech-mdlint-init/SKILL.md) | Bootstrap: scan the repo and produce a sensible `wastech-mdlint.config.json` via `init`. |
| [`wastech-mdlint-fix`](../../skills/wastech-mdlint-fix/SKILL.md) | Fix findings by rule prefix — delegating mechanical fixes to the deterministic `--fix`, reserving judgement for the AI. |
| [`wastech-mdlint-impact`](../../skills/wastech-mdlint-impact/SKILL.md) | Explain the blast radius of a change using `impact` / the graph. |

## Host-neutral by design

The skills contain **no host-specific command-injection syntax** (no `$ARGUMENTS`, no bang-command
injection) and no vendor branding — they work in any skill-capable host. This is enforced by a
validation test (`skills-validation.test.ts`): frontmatter is schema-checked, host-neutrality is
asserted, and the commands/tools the skills reference are checked against the real CLI `--help` and
MCP `listTools` surface so a skill can't drift from the product.

## Frontmatter

Each `SKILL.md` carries `name`, `description`, `license`, `compatibility`, and
`metadata.{homepage,source}`, validated by a single Zod schema in core (the same schema
[`compile`](compile.md) uses for generated skills). `compatibility` couples the skill to the CLI
version.

## `-fix` delegation policy

`wastech-mdlint-fix` reads the fixable set from the generated rule table (currently
[SEC-001](rules/SEC-001.md) and [TBL-002](rules/TBL-002.md)) rather than hardcoding it, runs core
`--fix` for those, and leaves non-mechanical findings for human/AI judgement.

## Generated vs. static skills

These 3 are **static** (hand-authored, shipped as-is). Separately, [`compile`](compile.md)
generates a **project-specific** `SKILL.md` from your repo. Both share one frontmatter contract.

## Install

Skills install via `gh skill install` and are tagged together with the npm packages under one
version at release. See the top-level [README](../../README.md) for install channels.
