# P5.04 · `synthesize` → `CompileResult`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Assemble the final `SKILL.md` — deterministic, host-neutral, schema-valid, and
budget-aware — and return `CompileResult`.

## Sequence

- **Previous:** [P5.02 — Doc profile](02-doc-profile.md) and [P5.03 — Describe rules](03-describe-rules.md).
- **Next:** [P5.05 — compile config + CLI](05-compile-config-cli.md).
- **Depends on:** P5.02, P5.03 · **Blocks:** P5.05.

## Deliverables / steps

1. `synthesize(...)` → `{ skillContent, metadata: { documentCount, ruleCount, componentCount } }`,
   assembling: frontmatter + sections **Document Architecture** (file tree + roles + document
   types), **Document Rules**, **Document Dependencies** (reading order — and the
   cycle-`excluded` docs `topologicalSort` reports, rendered explicitly rather than silently
   dropped, preserving the G6 honesty guarantee), **Workflow**, gated by `compile.sections`.
2. **Host-neutral commands** ([S2](../requirements/04-skills-compile.md)): the dependencies
   block is templated by `compile.commandPreset` (`claude|generic|none`); default = plain
   instructions + MCP-tool reference (no `!npx … $ARGUMENTS`).
3. **Determinism + provenance** ([S4](../requirements/04-skills-compile.md)): sorted, no
   timestamps; header "generated from N docs, M rules" + a content hash.
4. **Context-budget summary** ([S6](../requirements/04-skills-compile.md)): reuse the shared
   token estimator `estimateTokens` (`engine/tokens.ts`, isolated per [D3](../index.md) so the
   `ceil(len/4)` heuristic can be swapped later) — corpus token estimate + entrypoints over
   budget.
5. **Frontmatter schema** ([S1](../requirements/04-skills-compile.md)): **define and export the
   SKILL.md frontmatter Zod schema here** (`name`, `description`, `license`, `compatibility`,
   `metadata.{homepage, source}`) and validate the emitted frontmatter against it. This schema
   does **not** exist yet — P5 is its first consumer. Export it from `@wastech-mdlint/core` so
   [P8.01](../P8-skills/01-frontmatter-schema-model.md) reuses (does not redefine) it for static
   skills and P9 CI validates against the same schema (single source, S1).

## Command-block presets (S2) — expected output

The **Document Dependencies** section ends with a command block templated by
`compile.commandPreset`; default is `generic`. Presets change **only** this block — the
computed dependency data above it is identical across presets, and every block is static text
(no timestamps, no host detection), preserving S4 byte-stability. Canonical rendering (examples
locked 2026-07-02, audit 3.4):

**`generic`** (default — host-neutral: plain instructions + MCP-tool reference):

```markdown
### Working with dependencies

- Trace what a change affects: run `wastech-mdlint impact <file>`, or call the
  `impact-analysis` MCP tool with `{ "file": "<file>" }`.
- Pull the context slice for a topic: run `wastech-mdlint slice <query>`, or call the
  `context-slice` MCP tool with `{ "query": "<query>" }`.
```

**`claude`** (Claude-Code command-injection style — the pre-v2 hardcoded form):

```markdown
### Working with dependencies

- Trace what a change affects:

  !npx wastech-mdlint impact $ARGUMENTS

- Pull the context slice for a topic:

  !npx wastech-mdlint slice $ARGUMENTS
```

**`none`** (no command block): the **Document Dependencies** section renders the computed
dependency listing (reading order + per-file references) **only** — no "Working with
dependencies" heading, no runnable commands.

## Frozen types + error contract (audit 4.4)

`CompileResult` is a **public core type, frozen before P7 & P8 depend on it**. The top-level
`compileContext` is the entry both hosts call; `synthesize` is the inner assembly:

```ts
// @wastech-mdlint/core
export interface CompileResult {
  skillContent: string; // full SKILL.md text — deterministic, byte-stable (S4)
  metadata: {
    documentCount: number;
    ruleCount: number;
    componentCount: number;
    contentHash: string; // S4 provenance hash (also embedded in the skillContent header)
  };
}

export function compileContext(config: LoadedConfiguration, cwd: string): CompileResult;
// `LoadedConfiguration` (already exported from core) carries the resolved `config`, `rules`, and
// `settings` the load→graph→analyze pipeline needs — there is no bare `Config` type in core.
// throws CompileConfigMissingError (typed, carries a stable `code`) when config.compile is absent
export function synthesize(/* analysis + profiles + rules */): CompileResult;
```

**Error contract is core-owned**, so both hosts format one source: `compileContext` throws a
typed `CompileConfigMissingError` (code `COMPILE_CONFIG_MISSING`) when `config.compile` is
missing. The CLI ([P5.05](05-compile-config-cli.md)) maps it to **exit 2** with the message; the
MCP tool ([P7.04](../P7-mcp-server/04-compile-tool.md)) maps it to `{ code, message, hint }`.
That `code` is one entry in the P7 MCP error taxonomy.

## Decisions applied

- [S1, S2, S4, S6](../requirements/04-skills-compile.md) · ([S3 skipped — English scaffold](../requirements/04-skills-compile.md)).

## Exit criteria

- [ ] Output is byte-stable across runs; hash/provenance header present.
- [ ] Command block respects the preset; default is host-neutral.
- [ ] Budget section present; frontmatter validates against the schema.

## Hand-off to next

P5.05 wires config + the CLI command to write/preview this `CompileResult`.
