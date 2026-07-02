# P7.04 · `compile-context` tool

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.

## Goal

Expose `compileContext` over MCP, returning the generated skill content + a metadata block.

## Sequence

- **Previous:** [P7.01 — Server foundation](01-server-foundation.md) + the compiler
  ([P5](../P5-compile/index.md)).
- **Next:** [P7.05 — Integration tests & docs](05-integration-tests-docs.md).
- **Depends on:** P7.01, P5 · **Parallel with:** P7.02, P7.03.

## Deliverables / steps

1. `compile-context` — `{ configPath?, cwd? }`: load config → require `config.compile` →
   `compileContext` → return **two content blocks**: the `skillContent` and a metadata block
   (`Documents: N, Rules: M, Components: K`).
2. Missing `config.compile` → format the core `CompileConfigMissingError` (code
   `COMPILE_CONFIG_MISSING`, [P5.04](../P5-compile/04-synthesize.md), audit 4.4) into the
   `{ code, message, hint }` error contract ([M6](../requirements/05-mcp-server.md)), not empty
   output. The tool consumes the frozen `CompileResult` type; it does not invent its own error.
3. Same deterministic content as the CLI `compile` ([S4](../requirements/04-skills-compile.md));
   read-only annotation ([M7](../requirements/05-mcp-server.md)).

## Decisions applied

- [M1, M6, M7](../requirements/05-mcp-server.md) · [S4](../requirements/04-skills-compile.md) determinism.

## Exit criteria

- [ ] Returns skill content + metadata; missing `compile` errors with guidance.
- [ ] Output matches CLI `compile` byte-for-byte (determinism).

## Hand-off to next

P7.05 covers this tool's contract in the stdio integration tests.
