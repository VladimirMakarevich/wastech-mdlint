# Testing Rules

The testing source of truth is the v2 roadmap in `docs/mdlint_v2/` plus the repository's
Vitest-based test suite. For the meaning of the terms used here — fixtures, rule scopes,
`ParsedDocument`, graph algorithms, exit codes — see the glossary at
`docs/mdlint_v2/glossary.md`.

## Test Framework

- Use Vitest for unit, integration, and CLI-level tests.
- Keep tests deterministic and local. No network calls unless a task explicitly adds a tested
  network surface.

## Fixture Strategy

- Prefer focused fixtures over the repository's real documentation files.
- Add scenario-specific fixtures for parser, rules, graph, compile, init, and CLI/MCP behavior.
- Keep fixtures small enough that failures point to one behavior, not an entire repo snapshot.

## Coverage Priorities

- Config loading, diagnostics, canonical IDs, JSONC behavior, and schema generation.
- Markdown parsing: headings, slugs, tables, sections, checklist items, links, images, eager
  imports, and inline-disable directives.
- Rule coverage by family with per-rule fixtures where behavior differs materially.
- Graph construction and algorithms: semantic edges, cycles, components, slice, impact, and
  coverage diagnostics.
- CLI behavior: command parsing, output modes, file emission, and exit codes.
- MCP behavior: tool registration, structured output, error contracts, and stdio integration.
- Compile and init flows, including deterministic output and local `$schema` wiring.
- Generated docs/schema sync checks where the roadmap requires generated metadata.

## Cross-Platform Expectations

- Treat Windows, macOS, and Linux support as a product requirement for `core`, `cli`, and
  `mcp-server`, not an optional extra.
- Normalize path assertions to repository-relative POSIX paths where user-visible output is part
  of the contract.
- Be explicit about newline handling when output is byte-compared.
- Avoid tests that depend on host-specific directory ordering or path separators.
- Add or update tests when a change touches path handling, glob evaluation, newline-sensitive
  output, or child-process behavior that could differ by OS.

## Verification Gates

Prefer these commands before finishing code changes:

```bash
npm run typecheck
npm test
npm run build
```

Run `npm run lint` and `npm run format` when the task or touched scope makes them relevant.

## Change Discipline

- Every behavior change should add or update tests unless the task is documentation-only.
- When implementing roadmap work, align test coverage with the phase exit criteria instead of
  inventing a separate success bar.
- If a roadmap task calls for sync tests or generated-doc validation, treat those as mandatory,
  not optional polish.
