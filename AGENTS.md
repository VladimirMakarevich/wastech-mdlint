# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Source Of Truth

**The codebase is the only source of truth.** Not a plan, not a roadmap, not an audit report, not a task file. When you need to know how something behaves, read the code and the tests that pin it.

Three rules follow from that, and they are not negotiable:

1. **Task documentation is temporary.** A document written to carry one piece of work through to completion is deleted when that work lands. Nothing — no comment, no test, no other document — may build a dependency on it. If a fact has to outlive the task, it goes into the code as a comment, into a test as an assertion, or into the permanent user documentation. A pointer is not a home for a fact.
2. **Permanent documentation is a short list.** [`README.md`](README.md) is the product overview. [`docs/guide/`](docs/guide/README.md) is the full user reference and is maintained. These files and `.agents/rules/` are the agent-operation guidance. Everything else in the tree is either code or temporary.
3. **Comments carry their own reasons.** See [Comments](#comments) below; the full rule is in [`.agents/rules/coding-style.md`](.agents/rules/coding-style.md).

## Project Shape

`wastech-mdlint` is an npm-workspaces monorepo. All product code lives under `packages/*`; there is no root `src/` or `test/`.

- `@wastech-mdlint/core` — the engine.
- `@wastech-mdlint/cli` — the commander-based CLI host. Bin: `wastech-mdlint`.
- `@wastech-mdlint/mcp-server` — the stdio MCP host. Bin: `wastech-mdlint-mcp`.

Treat the filesystem as truth for where code lives.

## Architecture Invariants

These hold for every change. Breaking one is a design decision, not an implementation detail, and needs to be raised explicitly rather than done quietly.

- **Core owns the pipeline.** `@wastech-mdlint/core` is the single owner of parsing, config loading, lint orchestration, graph construction, compile logic, and result formatting.
- **Hosts are thin.** `cli` and `mcp-server` are adapters over core. They never re-implement the pipeline. Host-specific behavior — argument parsing, exit codes, tool registration, error wrapping, structured output — belongs at the boundary; shared computation belongs in core. Two hosts computing the same answer separately is how they start giving different answers.
- **One parse pass.** `ParsedDocument` is produced once per document and feeds rules, graph, compile, and inline suppression. Nothing re-parses Markdown ad hoc.
- **The rule system is registry-driven.** Structured metadata, Zod-validated options, shared assertion primitives, deterministic findings. Declarative custom rules stay data-driven over a closed primitive vocabulary — never runtime user code.
- **One graph.** `ContextGraph` is shared infrastructure for graph commands, impact and slice logic, MCP tools, and graph-aware rules. A parallel traversal implementation is a bug waiting to diverge.
- **Deterministic output.** Public and report output uses normalized repository-relative POSIX paths and stable ordering. No timestamps, no filesystem-order dependence, no locale-dependent collation.
- **Cross-platform.** Runtime surfaces in all three packages must behave correctly on Windows, macOS and Linux. Path normalization, glob handling, newline behavior and child-process handling are correctness concerns, not polish.
- **Config is data.** JSONC in `wastech-mdlint.config.json` with a local `$schema`. No remote schema URLs, no runtime TypeScript config loading, no `.cjs`/`.mjs` config.

## Implementation Guidance

- Prefer small modules with explicit data handoff between parser, config, engine, rules, graph, compile, CLI and MCP.
- Keep rule logic pure where practical: parsed inputs in, structured findings or edits out.
- Use explicit public types for load-bearing contracts: `ParsedDocument`, `Rule`, `RuleContext`, `LintMessage`, `ContextGraph`, compile outputs.
- Reuse parser libraries and structured AST traversal instead of ad hoc Markdown parsing.
- Keep token estimation isolated so the current heuristic can be replaced without refactoring unrelated code.
- Reuse existing local patterns and helper APIs before adding new abstractions. Do not build extension points for hypothetical needs.
- Do not add skills, `.claude/skills/`, hooks, LSP support, docs-site work, external HTTP link checking, external link caches, or code-plugin execution unless the user explicitly asks for that scope.

## Comments

A comment is read by somebody sitting in the code, long after it was written, with nothing else open beside them. So every comment carries its own justification in full.

- Follow **why, not what**. Explain the reason, the invariant, the alternative that was rejected, or the bug this shape prevents. Do not restate what the syntax already says.
- **No pointers.** No phase or task ids, no finding or backlog ids, no audit rounds, no ticket numbers, and no references to `docs/`, `AGENTS.md`, `CLAUDE.md`, `.agents/rules/`, or any other document — not as a path, a link, a section title, or a bare "see …". This applies to every non-prose file: `.ts`, JSONC, `#`-comments, CI YAML, and doc comments alike.
- **Write the substance instead.** Whatever the pointer stood in for, state it. Deleting the pointer and leaving nothing is the wrong fix — the rationale is the deliverable.
- **The check:** strike the pointer out. If what is left no longer explains why the code looks like this, the comment is not finished.
- **One carve-out:** machine-read markers (`@boundary-guard <category>`, ESLint and TypeScript directives, `prettier-ignore`) are program input wearing comment syntax. Keep them verbatim.

Naming other code — a source or test file, a symbol, an upstream library's behavior — is allowed, because those move together with the comment under review. State the fact first anyway, so the comment survives that file being renamed.

## Testing And Verification

Prefer focused fixtures over this repository's real Markdown files.

Before finishing code changes:

```bash
npm run typecheck
npm test
npm run build
```

Use `npm run lint` and `npm run format` when the touched scope needs style verification, and `npm run lint:docs` when you touched documentation.

**Build before test.** Several suites spawn the built entrypoints in `dist/`, so `npm run typecheck` (which is `tsc -b`, and emits) or `npm run build` has to run first; those suites call a shared `assertBuilt()` and fail with that message rather than a confusing behavioral diff. If the build does not clear it, run `npx tsc -b --force` — `assertBuilt()` compares modification times while `tsc -b` decides up-to-dateness from content, so a source file whose timestamp moved without its content changing leaves `dist/` untouched.

**Test files are never type-checked.** No tsconfig includes `test/**`. A coverage guard written as a `satisfies` constraint in a test file therefore never runs; write it as a runtime assertion.

Keep the five process-boundary guard categories intact — spawning the installed bin, a write failure, shared `exclude` scope, determinism, and host parity. They cover defect classes the in-process suite structurally cannot see. The checklist and the test that enforces it are in [`.agents/rules/testing.md`](.agents/rules/testing.md).

## Repository Hygiene

- Do not rewrite or revert existing user changes unless explicitly requested.
- Keep user-facing product documentation in `README.md` and `docs/guide/`, and keep it current in the change that makes it wrong — not in a later cleanup pass.
- Keep agent-operation guidance in `AGENTS.md`, `CLAUDE.md` and `.agents/rules/`.
- If a task is documentation-only, do not change product code, public interfaces, package metadata, or dependencies unless the user explicitly expands scope.
- Run `npm run format` before committing **any** deliverable, documentation included. `prettier --check .` covers every tracked Markdown file, so a docs change can turn the gate red exactly as a code change can. The remedy is a targeted `npx prettier --write <paths>` on the files you touched, never a repo-wide rewrite. CI runs the same check on ubuntu, windows and macOS; `.gitattributes` (`* text=auto eol=lf`) is what keeps it from failing on line endings alone. Deliberately outside the gate: `tasks/`.
- **Markdown prose is not hard-wrapped.** `.prettierrc.json` sets `proseWrap: "never"`, so one paragraph is one line and the formatter reflows it for you. Never hand-wrap to a column, and never write a line break inside an inline code span or a list continuation.
- **Never nest a glob-bearing code span inside a bold span.** A code span containing a double asterisk, written inside a bold span, is rewritten destructively — the surrounding inline delimiters are eaten and the sentence stops reading as authored — and because the formatter produced the damage itself, `prettier --check` passes on it. Nothing in CI can catch this class, so avoiding the construct is the whole guard: put the glob in the sentence body, outside the bold span.
