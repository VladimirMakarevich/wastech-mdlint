# P7.04 · `compile-context` tool

> Phase: [P7 — MCP server](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Expose `compileContext` over MCP, returning the generated skill content + a metadata block.

> **Blocked on P5.** `compileContext`, `CompileResult`, and `CompileConfigMissingError` do not
> exist until P5 lands (today `config.compile` is `z.unknown()`). The symbol names below are the
> P5 plan of record — confirm them against `packages/core/src/index.ts` before implementing. This
> is the only one of the six tools that needs P5; if P5 slips, ship [P7.02](02-lint-tools.md) /
> [P7.03](03-graph-tools.md) first.

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

- [x] Returns skill content + metadata; missing `compile` errors with guidance.
- [x] Output matches CLI `compile` byte-for-byte (determinism).

## Implementation notes

- **No `structuredContent`/`outputSchema` — the one structured-output exception among the six
  tools.** Three sources disagreed on the surface: this task file (most specific) specifies "two
  content blocks"; [M1](../requirements/05-mcp-server.md) (locked requirement) names the exact five
  tools that get structured output and omits `compile-context`; the [phase index](index.md)
  roadmap-summary bullet reads as if all six are structured. Per `AGENTS.md` precedence (task file
  > requirement > roadmap summary), the task file and M1 win: `registerTool` omits `outputSchema`
  and the handler returns exactly `content: [skillContent block, metadata block]`. The SDK treats
  a tool without an `outputSchema` as returning `content` (not `structuredContent`), so this is
  mechanically valid. `successResult` (which always attaches `structuredContent`) is deliberately
  not reused for this tool.
- **No error-translation wrapper.** `CompileConfigMissingError.code` (`COMPILE_CONFIG_MISSING`) is
  already in `TOOL_ERROR_CODES` and it carries `.hint`, so `errorResult` passes it through verbatim
  — like `impact-analysis`'s `ImpactAnalysisError`, and unlike `lint`'s `RuleResolutionError` whose
  codes aren't in the taxonomy.

## Hand-off to next

P7.05 covers this tool's contract in the stdio integration tests.
