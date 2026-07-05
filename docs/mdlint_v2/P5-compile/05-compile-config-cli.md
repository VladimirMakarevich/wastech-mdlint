# P5.05 · `compile` config section + CLI `compile` command

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

## Goal

Expose compilation through config + the CLI, writing the skill to disk with preview support.

## Sequence

- **Previous:** [P5.04 — Synthesize](04-synthesize.md) produced `CompileResult`.
- **Next:** [P5.06 — Compile tests](06-compile-tests.md).
- **Depends on:** P5.04 + config model (P2.04, root schema only) + commander scaffold (P0.05) ·
  **Blocks:** P5.06.

## Deliverables / steps

1. Config `compile` section — **defined and Zod-validated in this task.** P2.04 deliberately
   left it opaque: `config-schema.ts` types `compile` as `z.unknown().optional()` with the
   comment *"its shape is validated in P5"*, so P5.05 replaces that placeholder with the strict
   shape `{ outdir?, skill: { name, description }, sections?: { architecture?, rules?,
   dependencies?, workflow? }, commandPreset?, hubMinInDegree? }`. Keep `.strict()` (matching the
   root `lintConfigSchema`) so unknown `compile.*` keys become C7 diagnostics.
   `hubMinInDegree` (default **3**) is the node-role hub threshold used by `classifyNodes`
   ([P5.01](01-graph-analysis.md), audit 3.3).
2. CLI `compile`: `--config`, `--outdir`, `--dry-run`, `--cwd`; resolve outdir as
   `--outdir` → `config.compile.outdir` → `.claude/skills/wastech-mdlint/`.
3. Require `config.compile`; if absent, exit **2** with a clear message. `compileContext`
   throws the typed `CompileConfigMissingError` (code `COMPILE_CONFIG_MISSING`, [P5.04 frozen
   types](04-synthesize.md), audit 4.4) — the CLI surfaces its message; the same error powers
   the MCP `{ code, message, hint }` contract, so both hosts stay consistent.
4. `--dry-run` prints the would-be `SKILL.md` without writing.
5. CLI only handles file I/O; generation stays in core (the core-hosts-the-pipeline decision).

## Decisions applied

- [S2](../requirements/04-skills-compile.md) `commandPreset` in config · [core-hosts-the-pipeline](../decisions/core-hosts-the-pipeline.md).

## Exit criteria

- [ ] `compile` writes `SKILL.md` to the resolved outdir; `--dry-run` previews.
- [ ] Missing `config.compile` exits 2 with guidance.

## Hand-off to next

P5.06 tests the command + content; P7's `compile-context` reuses `compileContext` and returns
the same content + metadata block.
