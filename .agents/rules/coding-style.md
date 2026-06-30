# Coding Style Rules

## Language And Tooling

- Runtime target: Node.js `24.17.0`.
- Language: TypeScript with ESM and `NodeNext` module resolution.
- Type checking: strict TypeScript.
- Linting: ESLint.
- Formatting: Prettier.
- Tests: Vitest.

Match the repository's actual tooling and configuration unless a phase task explicitly changes it.

## General Principles

- Keep modules small and purpose-specific.
- Prefer explicit data flow between discovery, parsing, config, rules, graph, compile, CLI, and
  MCP layers.
- Keep rule logic pure where practical: parsed inputs in, structured findings or fixes out.
- Reuse existing local patterns and helper APIs before adding new abstractions.
- Do not build extension points for hypothetical future needs. Add them only when a concrete
  phase task requires them.

## Types And Contracts

- Keep public and cross-module contracts explicit and strongly typed.
- Preserve or evolve load-bearing contracts deliberately, especially around:
  - `ParsedDocument`
  - rule metadata and `RuleContext`
  - structured lint findings
  - `ContextGraph`
  - compile outputs
- In NodeNext TypeScript, follow the repository's ESM import style for relative imports.

## Determinism And Paths

- Runtime behavior must stay correct on Windows, macOS, and Linux for `core`, `cli`, and
  `mcp-server`.
- Public data structures and reports use normalized repository-relative POSIX paths.
- Sort output collections before rendering or serializing when order is user-visible.
- Avoid hidden time-dependent or filesystem-order-dependent behavior.
- Do not rely on POSIX-only shell behavior, path separators, or newline assumptions in product
  runtime code.
- Keep token estimation isolated so the heuristic can be replaced later without broad rewrites.

## Markdown, Config, And Validation

- Prefer parser libraries and AST traversal over ad hoc Markdown parsing.
- Use structured validation for config and rule options; prefer Zod where the repo already does.
- For v2 config work, target JSONC `wastech-ctxlint.config.json` with local `$schema` support.
- Do not add remote schema dependencies or runtime code execution to configuration paths.

## Repository Structure

- Until P0 fully lands, current single-package code may still live in `src/` and `test/`; do not force future
  workspace paths into unrelated tasks.
- When a task explicitly belongs to P0+ workspace migration, place code in the package layout
  defined by the roadmap instead of inventing a new structure.

## Verification Expectations

- Prefer `npm run typecheck`, `npm test`, and `npm run build` before finishing code changes.
- Run `npm run lint` or `npm run format` when the touched scope needs style verification.
- Every behavior change should come with tests scaled to the risk of the change.
