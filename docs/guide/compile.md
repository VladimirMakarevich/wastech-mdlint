# Context compiler — `compile`

> [Guide index](README.md) · [CLI reference](cli.md#compile) · [Configuration](configuration.md)

`compile` generates a **deterministic** `SKILL.md` — a project-specific agent skill — from the
[context graph](context-graph.md), the active rule descriptions, and the `compile` config. It lets
an AI host load a compact, accurate description of *this* repository's docs structure and
conventions.

## Usage

```bash
wastech-mdlint compile                 # write SKILL.md to the resolved outdir
wastech-mdlint compile --dry-run       # print it to stdout instead of writing
wastech-mdlint compile --outdir build/skill
wastech-mdlint compile --cwd packages/docs
```

- Output path precedence: `--outdir` → `config.compile.outdir` → `.claude/skills/wastech-mdlint/`.
  The file is always named `SKILL.md`.
- Unlike other commands, `compile` takes `--cwd` (not `[path]`), and resolves a relative
  `--config`/`--outdir` against it.
- Requires a `compile` section in config; a missing one exits `2` with guidance, not a stack trace.

## What goes into `SKILL.md`

The compiler analyzes the graph (classifying nodes as entry/hub/leaf/isolated/bridge), extracts a
document profile (outline, table schemas, detected ID patterns, references in/out), describes the
active rules, and synthesizes a skill document. Output is **byte-deterministic**: sorted, POSIX
paths, a content hash, no timestamps — so re-running on the same inputs produces identical bytes.

## Config

```jsonc
"compile": {
  "outdir": ".claude/skills/wastech-mdlint",
  "skill": {
    "name": "my-project-context",              // required, non-empty
    "description": "Docs context for my project" // required, non-empty
  },
  "sections": {                 // gate which SKILL.md sections render (all default true)
    "architecture": true,
    "rules": true,
    "dependencies": true,
    "workflow": true
  },
  "commandPreset": "generic",   // "claude" | "generic" | "none" — wording of the deps block
  "hubMinInDegree": 3           // in-degree threshold to classify a document as a hub (default 3)
}
```

- `skill.name` / `skill.description` are required.
- `sections.*` toggle the four generated sections.
- `commandPreset` selects the phrasing of the "Working with dependencies" block.
- `hubMinInDegree` tunes hub classification.
- Unknown `compile.*` keys are rejected like any other unknown config key.

## Compile vs. static skills

`compile` produces a **generated, project-specific** skill. The three **hand-authored** skills
(`-init`, `-fix`, `-impact`) are separate and shipped as-is — see [Skills](skills.md). Both share
one frontmatter schema in core.

## Via MCP

The [`compile-context`](mcp-server.md) MCP tool produces the same deterministic output as this
command (as two plain-text blocks). It also requires `config.compile`.
