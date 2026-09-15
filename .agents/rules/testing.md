# Testing Rules

The test suite is the executable statement of what this product does. Where a behavior matters, a test pins it; where no test pins it, the behavior is not guaranteed.

## Test Framework

- Use Vitest for unit, integration, and CLI-level tests.
- Keep tests deterministic and local. No network calls unless a task explicitly adds a tested network surface.

## Fixture Strategy

- Prefer focused fixtures over the repository's real documentation files.
- Add scenario-specific fixtures for parser, rules, graph, compile, init, and CLI/MCP behavior.
- Keep fixtures small enough that a failure points to one behavior, not an entire repo snapshot.

## Coverage Priorities

- Config loading, diagnostics, canonical IDs, JSONC behavior, and schema generation.
- Markdown parsing: headings, slugs, tables, sections, checklist items, links, images, eager imports, and inline-disable directives.
- Rule coverage by family, with per-rule fixtures where behavior differs materially.
- Graph construction and algorithms: semantic edges, cycles, components, slice, impact, and coverage diagnostics.
- CLI behavior: command parsing, output modes, file emission, and exit codes.
- MCP behavior: tool registration, structured output, error contracts, and stdio integration.
- Compile and init flows, including deterministic output and local `$schema` wiring.
- Generated docs and schema sync checks.

## Process-Boundary Guards

An entrypoint guard with no coverage, a shared option with no end-to-end test, and a write path never exercised against a failure all shipped broken while the in-process suite stayed green. They had one cause in common: **nothing tested the process boundary.** An in-process call can be correct in every way and still tell you nothing about what a real process does, because the things that differ — `process.argv`, a stream a client actually reads, a filesystem that refuses a write, state carried between calls — only exist outside it.

These five categories are the standing answer. Each names a class of defect that in-process tests structurally cannot see, so a subsystem missing one is missing it visibly rather than silently.

| Category | What a guard in it must prove | Current guard(s) |
| --- | --- | --- |
| `installed-bin-spawn` | The built entrypoint actually runs when spawned through an npm-style link, not just by its real path. Only a real process populates `process.argv[1]`, which is what the entrypoint guard compares against `import.meta.url` — and only a spawned server shows the response a client actually receives, where a plausible-looking success can hide a missing input guard | `packages/cli/test/bin.e2e.test.ts`, `packages/mcp-server/test/bin-entrypoint.test.ts`, `packages/mcp-server/test/stdio-integration.test.ts` |
| `write-failure` | A write that fails partway leaves no temp file and no half-written target, and the command reports it and exits non-zero instead of claiming success | `packages/core/test/atomic-write.test.ts`, `packages/cli/test/init.e2e.test.ts` |
| `shared-exclude` | The shared `files`/`exclude` scope stays covered as rules and assert kinds are added, rather than a new one shipping unscoped — and the corpus a resolved scope produces is compared against a tracked-file list in **both** directions, since a total alone cannot see one file dropped and another gained | `packages/cli/test/init.e2e.test.ts`, `packages/cli/test/lint.e2e.test.ts`, `packages/core/test/registry-inventory.test.ts`, `packages/core/test/rules-custom.test.ts` |
| `determinism` | Output does not depend on evaluation order or on state carried between calls — a `g`-flagged `RegExp`'s `lastIndex` being the case that shipped | `packages/core/test/primitives.test.ts` |
| `host-parity` | A surface's human rendering and its structured payload describe the same run, and each host's rendering matches the other's. The two sides must come from **different formulations** — the human text parsed back into rows, not recomputed with the renderer's own helper — or the assertion agrees with itself. Three missed defects (a dropped `hint`, a `--format json` word collision, a summary key present in one format only) all lived where nothing diffed the two documents a single call returns | `packages/cli/test/graph.e2e.test.ts`, `packages/cli/test/lint.e2e.test.ts`, `packages/mcp-server/test/context-graph.test.ts`, `packages/mcp-server/test/host-parity.test.ts`, `packages/mcp-server/test/lint-files.test.ts`, `packages/mcp-server/test/lint.test.ts` (readers: `packages/core/test/support/output-parity.ts`) |

Rules for keeping this honest:

- Each guard carries a `@boundary-guard <category>` comment at the guard itself. `packages/core/test/boundary-guards.test.ts` asserts every category still has its tagged guard, so deleting one fails the suite while renaming a test does not.
- That marker is the one carve-out to the self-contained-comment rule in [`coding-style.md`](coding-style.md), not an exception to it: it is parsed by a test, so it is program input that happens to use comment syntax. Everything else a test's comments say obeys the same rule as product code — describe the defect the guard exists to catch and what a green run therefore proves.
- Adding a category here means adding it to that inventory too, and vice versa. Be aware which half of that pairing a test can hold: the inventory pins its own category set, so growing it fails until the author updates that list — but the inventory does not parse this file, so a row added here alone fails nothing. Keeping this table honest is discipline, not enforcement, and it is the direction in which the table could start claiming coverage the tree no longer has.

## Guards Over The Repository's Own Documents

Two suites read this repository's own Markdown rather than a fixture. They are not process-boundary guards — the five categories above are a closed set about the process boundary — but they follow the same rule: a document that drifts fails a test rather than being noticed later.

| Guard | What it proves |
| --- | --- |
| `packages/core/test/docs-sync.test.ts` | Generated documentation — the README rule table, the MCP tool inventory, the schema — still matches what the registry declares. |
| `packages/core/test/repo-self-lint-scope.test.ts` | The `include` scope this repository lints itself with still covers every tracked documentation page and nothing outside it, compared in both directions against the tracked-file list, because a narrowed scope looks exactly like a clean run. |

`npm run lint:docs` is the third guard, and the only one outside Vitest: it runs this tool over its own documentation and fails on a broken link or anchor.

## Cross-Platform Expectations

- Windows, macOS and Linux support is a product requirement for all three packages, not an optional extra.
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

Run `npm run lint` and `npm run format` when the task or touched scope makes them relevant, and `npm run lint:docs` when you touched documentation.

Three facts about these gates that are easy to learn the hard way:

- **Build before test.** The suites that spawn a built entrypoint run against `dist/`, so run `npm run typecheck` (which is `tsc -b`, and emits) or `npm run build` _first_. A bare `vitest run` on a checkout whose source changed since the last build spawns a stale artifact; every such suite calls the shared `assertBuilt()` (`packages/core/test/support/assert-built.ts`) at module scope and fails with that message rather than a confusing behavioral diff. `packages/core/test/package-payload.test.ts` calls the same helper for a different reason: it packs a tree it does not build, since `npm pack --workspaces` runs no lifecycle script. **If the build does not clear it, run `npx tsc -b --force`**: `assertBuilt()` compares modification times, while `tsc -b` decides up-to-dateness from content — so a source file whose timestamp moved without its content changing (a `git checkout --`, a stash pop, a copy that resets mtimes) leaves `dist/` untouched, and the guard keeps naming a command that just exited `0`.
- **Test files are never type-checked.** No tsconfig includes `test/**` — the packages are `include: ["src/**/*.ts", …]` for their emit contract — so `npm run typecheck` does not read them. A coverage guard written as a `satisfies` constraint in a test file therefore never runs; write it as a runtime assertion instead.
- **The format gate reaches documentation too.** `npm run format` is `prettier --check .`, which covers every tracked Markdown file including `docs/`, so it must be run before committing a documentation deliverable, not only a code one. Deliberately outside the gate: `tasks/`.

## Change Discipline

- Every behavior change adds or updates tests unless the task is documentation-only.
- A test whose subject has been deleted is deleted with it. Weakening its threshold until it passes is worse than removing it: it leaves a suite that reports success about nothing.
- A threshold derived from a magic number goes stale silently. Derive it from something that moves with the repository — the tracked-file list, the registry, the tree on disk — so it keeps meaning what it meant.
