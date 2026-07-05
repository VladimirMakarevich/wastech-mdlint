# Phase P5 — Context compiler & `compile`

> Roadmap: [v2 Index](../index.md) · Phase **P5** · Size **M** · Status **Not started** ·
> Depends on [P4](../index.md).
>
> **Goal:** generate a deterministic, host-neutral, project-specific `SKILL.md` from the
> document graph + rules, including an LLM context-budget summary.

## Why this phase exists

`compile` turns a repo into an agent-readable map (architecture, rules, dependencies,
workflow). v2 applies the [skills/compile requirements](../requirements/04-skills-compile.md):
host-neutral commands ([S2](../requirements/04-skills-compile.md)), deterministic output
([S4](../requirements/04-skills-compile.md)), frontmatter schema
([S1](../requirements/04-skills-compile.md)), and a context-budget section
([S6](../requirements/04-skills-compile.md)). See the [skills & compile
requirements](../requirements/04-skills-compile.md).

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P5.01](01-graph-analysis.md) | `classifyNodes` + `analyzeGraph` (roles, reading order) | S | P4 done |
| [P5.02](02-doc-profile.md) | `extractDocProfile` (outline, table schemas, refs in/out) | M | P5.01 |
| [P5.03](03-describe-rules.md) | `describeRules` from the metadata source (incl. custom) | S | P2.03 (rule metadata) |
| [P5.04](04-synthesize.md) | `synthesize` → `CompileResult` (host-neutral, deterministic, budget) | M | P5.02, P5.03 |
| [P5.05](05-compile-config-cli.md) | `compile` config section + CLI `compile` command | M | P5.04 |
| [P5.06](06-compile-tests.md) | Compile tests & fixtures | M | all above |

## Sequence

```
(P4.08) ─► P5.01 ─┬─► P5.02 ─┐
                  └─► P5.03 ─┴─► P5.04 ─► P5.05 ─► P5.06 ─► (Phase P6)
```

## Decisions applied

- [S1, S2, S4, S5, S6](../requirements/04-skills-compile.md) · ([S3 skipped](../requirements/04-skills-compile.md)) ·
  [R6](../requirements/02-rules-engine.md) metadata-driven rule descriptions · [D3](../index.md)
  budget reuse.

## Phase exit criteria

- [ ] `compileContext` runs load→graph→analyze→profile→describe→synthesize deterministically.
- [ ] Generated `SKILL.md`: frontmatter (schema-validated, S1), host-neutral command block
      (preset `claude|generic|none`, S2), context-budget summary (S6), and a
      "generated from N docs, M rules" header + hash (S4).
- [ ] CLI `compile` with `--outdir`/`--dry-run`, default `.claude/skills/wastech-mdlint/`;
      missing `config.compile` exits 2.

## What P5 unblocks

- **P7** — MCP `compile-context` returns the same deterministic content + metadata.
- **P8** — the `-fix`/`-impact`/`-init` skills reference a stable compile output and surface.
