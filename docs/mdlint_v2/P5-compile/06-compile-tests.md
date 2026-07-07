# P5.06 · Compile tests & fixtures

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Lock compile behavior: deterministic content, correct sections, presets, budget, and CLI I/O.

## Sequence

- **Previous:** [P5.05 — compile config + CLI](05-compile-config-cli.md).
- **Next:** **Phase P6 — `init` command** (see [roadmap](../index.md)).
- **Depends on:** P5.01–P5.05 · **Blocks:** P7's `compile-context` confidence.

## Deliverables / steps

1. Unit tests: header/frontmatter (schema-valid), architecture/rules/dependencies/workflow
   sections, command presets (`claude|generic|none`), budget summary, metadata counts, CJK,
   empty/edge cases, and compile-without-`config.compile` (throws).
2. **Determinism test:** two runs over the same input produce byte-identical output (S4).
3. e2e: `compile` writes to default + custom `--outdir`; `--dry-run` writes nothing.

## Decisions applied

- Determinism ([S4](../requirements/04-skills-compile.md)) · frontmatter schema
  ([S1](../requirements/04-skills-compile.md)) · focused fixtures (AGENTS.md).

## Implementation notes

- Most of this task's listed coverage (frontmatter/S1, all four section gates, all three command
  presets, the four budget states, metadata/content-hash provenance, several Markdown-escaping
  edge cases, and core-level determinism) had already landed test-first alongside P5.04/P5.05.
  The actual gap closed here was narrower: CJK content, an empty-corpus integration path, and a
  CLI-boundary determinism check — the rest of this file's exit criteria were already satisfied
  by existing tests.
- The CJK corpus-token-estimate test computes its expected value from the locked D3 formula
  (`Math.ceil(fileContent.length / 4)`) applied directly to the literal fixture string, not by
  calling `estimateTokens()` itself. Calling the function under test to compute its own expected
  value is tautological — a future regression from character-counting to a byte-based measure
  would move both sides of the assertion together and the test would keep passing. Pinning the
  formula (plus a concrete `toBe(17)` literal) is what actually catches that class of regression
  for non-Latin corpora, where UTF-16 code units and UTF-8 bytes diverge.
- CJK coverage uses CJK _content_, never CJK _paths_: the fixture filename stays ASCII (`doc.md`).
  The D3 heuristic and S1 frontmatter schema only need non-ASCII text exercised, and a non-ASCII
  path risks filesystem-encoding flakiness on Windows CI that isn't this task's concern.
- The empty-corpus test is coverage, not a bugfix: `compileContext` already resolved cleanly on a
  zero-match corpus before this task (no zero-node special-casing was needed anywhere in
  `loadContext`/`analyzeGraph`), so the test simply locks in that `documentCount: 0` and
  `"(no documents found)"` stay truthful without ever having exercised that path end-to-end
  before.
- The CLI `--dry-run` determinism test was added inline to `cli.test.ts`'s existing ad hoc
  `describe("compile command", ...)` block rather than a dedicated
  `packages/cli/test/fixtures/<scenario>/` directory. That block's five other tests already share
  the same ad hoc `fixtureRepo()`-per-test style; matching the immediately surrounding convention
  outweighed introducing a second fixture pattern for one additional assertion.

## Exit criteria

- [x] All sections + presets + budget covered; determinism test green.
- [x] `--dry-run` / `--outdir` behavior verified.
- [x] Phase P5 [exit criteria](index.md) satisfied.

## Hand-off to next

P6 builds `init`; P7 wraps `compileContext` as the MCP `compile-context` tool with the same
deterministic output.
