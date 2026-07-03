# P1.05 · `loadDocuments()` deterministic loader

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Done**.

## Goal

Provide the deterministic entry point the whole pipeline uses: glob → read → parse →
`Map<absPath, ParsedDocument>`, with sorted, POSIX-normalized keys.

## Sequence

- **Previous:** [P1.04 — Inline-disable directives](04-inline-disable-directives.md)
  completed `ParsedDocument`, so the loader can return fully-parsed documents.
- **Next:** [P1.06 — Parser tests & fixtures](06-parser-tests-fixtures.md) validates the
  loader and the parsers end-to-end.
- **Depends on:** P1.04 · **Blocks:** P1.06; consumed by graph/lint/compile in P2–P5.

## Inputs (from previous work)

- current `discovery/{discover,globs}.ts` (micromatch globbing, path normalization), in `core`.
- The parser pipeline from P1.02–P1.04.

## Deliverables / steps

1. `loadDocuments(patterns, { cwd, exclude?, respectGitignore? })`:
   - expand globs (absolute, `nodir: true`), normalize `\` → `/`, **sort** the file list;
   - read + parse each file into `ParsedDocument`;
   - return `Map<absolutePath, ParsedDocument>`.
2. Accept `exclude` and `respectGitignore` arguments now ([C1](../requirements/01-configuration.md)/[C8](../requirements/01-configuration.md)),
   but **do not** wire them to config yet — the new config model lands in
   [P2](../index.md), which will pass `config.exclude` / `config.respectGitignore` here.
3. Deterministic ordering of map insertion and any derived arrays.

> **Boundary note:** P1's loader takes explicit patterns/options so it has no dependency on
> the (current) config. P2 connects it to the new `{ include, exclude, … }` config.

## Decisions applied

- Determinism (sorted, POSIX paths) · [C1](../requirements/01-configuration.md)/[C8](../requirements/01-configuration.md)
  exclude/gitignore plumbing (config wiring deferred to P2).

## Exit criteria

- [ ] `loadDocuments` returns a deterministic, sorted `Map<absPath, ParsedDocument>`.
- [ ] `exclude` and `respectGitignore` parameters are honored when passed explicitly.
- [ ] Windows paths normalized to POSIX in keys.

## Hand-off to next

P1.06 exercises the loader on fixtures; P2 swaps in config-driven `include`/`exclude`; P4
builds the graph from the returned map.
