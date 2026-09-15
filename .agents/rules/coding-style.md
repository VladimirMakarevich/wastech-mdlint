# Coding Style Rules

## Language And Tooling

- Runtime target: Node.js `24.17.0`.
- Language: TypeScript with ESM and `NodeNext` module resolution, so relative imports carry a `.js` extension.
- Type checking: strict TypeScript.
- Linting: ESLint. Formatting: Prettier. Tests: Vitest.

Match the repository's actual tooling and configuration.

## General Principles

- Keep modules small and purpose-specific.
- Prefer explicit data flow between discovery, parsing, config, rules, graph, compile, CLI, and MCP layers.
- Keep rule logic pure where practical: parsed inputs in, structured findings or fixes out.
- Reuse existing local patterns and helper APIs before adding new abstractions.
- Do not build extension points for hypothetical future needs.

## Comments And Rationale

- Treat comments as part of the deliverable: new code is documented where it is introduced, not in a later cleanup pass.
- Follow **why, not what**: explain why the code exists, why a constraint matters, or why a specific shape was chosen.
- Prefer rationale, invariants, tradeoffs, cross-platform notes, and bug-prevention context over narrating what the syntax already says.
- Do not add comments that merely restate names, types, assignments, loops, or conditionals.
- If a block is hard to justify with a short why-comment, simplify or restructure it until the intent is clear.

### Comments Are Self-Contained

A comment is read by somebody sitting in the code, often long after it was written, with no planning tree open beside them. Documents get superseded, renamed, archived and deleted; a comment that outsources its reason to one decays into a dangling pointer, and the reason it was protecting goes with it. In this repository that is not a hypothetical: the entire planning tree these comments once pointed at has been deleted.

This covers comments in **every** non-prose file, not only `.ts`: JSONC (`tsconfig.base.json`), `#`-comments (`.npmrc`, `.gitattributes`), YAML (`.github/workflows/`), and doc comments (JSDoc/TSDoc) are all code comments for this rule.

- **No planning tags.** Do not open or annotate a comment with a phase or task id, a backlog or finding id, an audit round, or a ticket number. They say nothing to a reader without that backlog in front of them, and they outlive the item they name.
- **No references to documentation.** Do not point a comment at `docs/`, `AGENTS.md`, `CLAUDE.md`, `.agents/rules/`, a task or decision page, or an audit report — not as a path, a link, a section title, or a bare "see …".
- **Write the substance instead.** Whatever the pointer stood in for — the constraint, the decision, the alternative that was rejected, the failure this shape prevents — state it in the comment, at whatever length it honestly takes. Deleting the pointer and leaving nothing is the wrong fix: the rationale is the deliverable and the pointer was only ever a shortcut to it.
- **The check:** strike every reference out of the comment. If what is left no longer explains why the code looks like this, the comment is not finished.
- **Pointing at code is allowed.** Naming another source or test file, a symbol, or an upstream library's behavior links two things that live in the same tree and move together under review. State the fact first anyway, so the comment survives that file being renamed.
- **One carve-out — machine-read markers.** A marker something actually parses (`@boundary-guard <category>`, an ESLint or TypeScript directive, `prettier-ignore`) is program input wearing comment syntax, not a documentation reference. Keep those, in exactly the form their reader expects.

Rationale a _user_ needs belongs in `docs/guide/`, where it is maintained as prose. Rationale a _maintainer_ needs belongs in the comment. Neither belongs in a document written to carry one task and then deleted.

## Naming

Use one name per concept across code, tests, config keys, and user-facing output. A concept that is `ContextGraph` in core and something else in a host is two concepts as far as any reader is concerned. Consistent naming is a contract, not a style preference.

## Types And Contracts

- Keep public and cross-module contracts explicit and strongly typed.
- Preserve or evolve load-bearing contracts deliberately, especially `ParsedDocument`, rule metadata and `RuleContext`, structured lint findings, `ContextGraph`, and compile outputs.

## Determinism And Paths

- Runtime behavior must stay correct on Windows, macOS and Linux for all three packages.
- Public data structures and reports use normalized repository-relative POSIX paths.
- Sort output collections before rendering or serializing when order is user-visible. Use the shared code-point comparator rather than locale-aware collation: locale collation depends on the host's ICU data and default locale, so it cannot produce the same order on two machines.
- Avoid hidden time-dependent or filesystem-order-dependent behavior.
- Do not rely on POSIX-only shell behavior, path separators, or newline assumptions in product runtime code.
- Keep token estimation isolated so the heuristic can be replaced later without broad rewrites.

## Markdown, Config, And Validation

- Prefer parser libraries and AST traversal over ad hoc Markdown parsing.
- Use Zod for config and rule-option validation, as the repository already does.
- Config is JSONC `wastech-mdlint.config.json` with a local `$schema`.
- Do not add remote schema dependencies or runtime code execution to configuration paths.

## Verification Expectations

- Prefer `npm run typecheck`, `npm test` and `npm run build` before finishing code changes.
- Run `npm run lint` or `npm run format` when the touched scope needs style verification.
- Every behavior change comes with tests scaled to the risk of the change.
