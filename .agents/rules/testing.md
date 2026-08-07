# Testing Rules

The testing source of truth is the v2 roadmap in `docs/mdlint_v2/` plus the repository's Vitest-based test suite. For the meaning of the terms used here — fixtures, rule scopes, `ParsedDocument`, graph algorithms, exit codes — see the glossary at `docs/mdlint_v2/glossary.md`.

## Test Framework

- Use Vitest for unit, integration, and CLI-level tests.
- Keep tests deterministic and local. No network calls unless a task explicitly adds a tested network surface.

## Fixture Strategy

- Prefer focused fixtures over the repository's real documentation files.
- Add scenario-specific fixtures for parser, rules, graph, compile, init, and CLI/MCP behavior.
- Keep fixtures small enough that failures point to one behavior, not an entire repo snapshot.

## Coverage Priorities

- Config loading, diagnostics, canonical IDs, JSONC behavior, and schema generation.
- Markdown parsing: headings, slugs, tables, sections, checklist items, links, images, eager imports, and inline-disable directives.
- Rule coverage by family with per-rule fixtures where behavior differs materially.
- Graph construction and algorithms: semantic edges, cycles, components, slice, impact, and coverage diagnostics.
- CLI behavior: command parsing, output modes, file emission, and exit codes.
- MCP behavior: tool registration, structured output, error contracts, and stdio integration.
- Compile and init flows, including deterministic output and local `$schema` wiring.
- Generated docs/schema sync checks where the roadmap requires generated metadata.

## Process-Boundary Guards

The [post-P9 audit](../../docs/mdlint_v2/audit-2026-07-25-post-p9.md) traced its missed HIGH findings to one systemic cause: **nothing tested the process boundary**. An entrypoint guard with 0% coverage, a shared option with no end-to-end test, and a write path never exercised against a failure all shipped broken while the in-process suite stayed green.

These five categories are the standing answer. Each names a class of defect that in-process tests structurally cannot see, so a subsystem missing one is missing it visibly rather than silently.

| Category | What a guard in it must prove | Current guard(s) |
| --- | --- | --- |
| `installed-bin-spawn` | The built entrypoint actually runs when spawned through an npm-style link, not just by its real path. Only a real process populates `process.argv[1]`, which is what the entrypoint guard compares against `import.meta.url` — and only a spawned server shows the response a client actually receives, where a plausible-looking success can hide a missing input guard (P14.01) | `packages/cli/test/bin.e2e.test.ts`, `packages/mcp-server/test/bin-entrypoint.test.ts`, `packages/mcp-server/test/stdio-integration.test.ts` |
| `write-failure` | A write that fails partway leaves no temp file and no half-written target, and the command reports it and exits non-zero instead of claiming success | `packages/core/test/atomic-write.test.ts`, `packages/cli/test/init.e2e.test.ts` |
| `shared-exclude` | The shared `files`/`exclude` scope stays covered as rules and assert kinds are added, rather than a new one shipping unscoped — and the corpus a resolved scope produces is compared against a tracked-file list in **both** directions, since a total alone cannot see one file dropped and another gained | `packages/cli/test/init.e2e.test.ts`, `packages/cli/test/lint.e2e.test.ts`, `packages/core/test/registry-inventory.test.ts`, `packages/core/test/rules-custom.test.ts` |
| `determinism` | Output does not depend on evaluation order or on state carried between calls — a `g`-flagged `RegExp`'s `lastIndex` being the case that shipped | `packages/core/test/primitives.test.ts` |
| `host-parity` | A surface's human rendering and its structured payload describe the same run, and each host's rendering matches the other's. The two sides must come from **different formulations** — the human text parsed back into rows, not recomputed with the renderer's own helper — or the assertion agrees with itself. Added by P16.01: three missed defects (a dropped `hint`, a `--format json` word collision, a summary key present in one format only) all lived where nothing diffed the two documents a single call returns | `packages/cli/test/lint.e2e.test.ts`, `packages/mcp-server/test/context-graph.test.ts`, `packages/mcp-server/test/host-parity.test.ts`, `packages/mcp-server/test/lint-files.test.ts`, `packages/mcp-server/test/lint.test.ts` (readers: `packages/core/test/support/output-parity.ts`) |

Rules for keeping this honest:

- Each guard carries a `@boundary-guard <category>` comment at the guard itself. `packages/core/test/boundary-guards.test.ts` asserts every category still has its tagged guard, so deleting one fails the suite while renaming a test does not.
- Adding a category here means adding it to that inventory too, and vice versa. Be aware which half of that pairing a test can hold: the inventory pins its own category set, so growing it fails until the author updates that list — which points back at this table — but the inventory does not parse this file, so a row added here alone fails nothing. Keeping this table honest is discipline, not enforcement, and it is the direction in which the table could start claiming coverage the tree no longer has.
- Behaviors a task decides to accept rather than guard belong in the [accepted behaviors register](../../docs/mdlint_v2/accepted-behaviors.md), not in an untested gap.

## Cross-Platform Expectations

- Treat Windows, macOS, and Linux support as a product requirement for `core`, `cli`, and `mcp-server`, not an optional extra.
- Normalize path assertions to repository-relative POSIX paths where user-visible output is part of the contract.
- Be explicit about newline handling when output is byte-compared.
- Avoid tests that depend on host-specific directory ordering or path separators.
- Add or update tests when a change touches path handling, glob evaluation, newline-sensitive output, or child-process behavior that could differ by OS.

## Verification Gates

Prefer these commands before finishing code changes:

```bash
npm run typecheck
npm test
npm run build
```

Run `npm run lint` and `npm run format` when the task or touched scope makes them relevant.

Three facts about these gates that are easy to learn the hard way:

- **Build before test.** The `installed-bin-spawn` suites spawn `dist/`, so run `npm run typecheck` (which is `tsc -b`, and emits) or `npm run build` _first_. A bare `vitest run` on a checkout whose source changed since the last build spawns a stale artifact; every suite that spawns a built entrypoint — the three `installed-bin-spawn` guards and the cross-host `host-parity` one — calls the shared `assertBuilt()` (`packages/core/test/support/assert-built.ts`) at module scope and fails with that message rather than a confusing behavioral diff. `packages/core/test/package-payload.test.ts` calls the same helper for a different reason: it packs a tree it does not build (`npm pack --workspaces` runs no lifecycle script) and, since P16.03, asserts on `dist` contents directly. **If the build does not clear it, run `npx tsc -b --force`** (W-56): `assertBuilt()` compares modification times, while `tsc -b` decides up-to-dateness from content — so a source file whose timestamp moved without its content changing (a `git checkout --`, a stash pop, a copy that resets mtimes) leaves `dist/` untouched, and the guard keeps naming a command that just exited `0`.
- **Test files are never type-checked.** No tsconfig includes `test/**` — the packages are `include: ["src/**/*.ts", …]` for their emit contract — so `npm run typecheck` does not read them. A coverage guard written as a `satisfies` constraint in a test file therefore never runs; write it as a runtime assertion instead.
- **The format gate reaches documentation too.** `npm run format` is `prettier --check .`, which covers every tracked Markdown file including `docs/`, so it must be run before committing a docs deliverable, not only a code one. See the note in `AGENTS.md`'s Repository Hygiene for the remedy and for what is deliberately outside the gate.

## Change Discipline

- Every behavior change should add or update tests unless the task is documentation-only.
- When implementing roadmap work, align test coverage with the phase exit criteria instead of inventing a separate success bar.
- If a roadmap task calls for sync tests or generated-doc validation, treat those as mandatory, not optional polish.
