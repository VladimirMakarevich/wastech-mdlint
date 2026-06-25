# Phase P1 — `ParsedDocument` & parser upgrade

> Roadmap: [v2 Index](../index.md) · Phase **P1** · Size **M** · Status **Not started** ·
> Reuse from MVP: **High**.
>
> **Goal:** one parse pass produces *everything* every downstream consumer needs. Extend the
> remark parser (now in `@wastech-ctxlint/core` after [P0.04](../P0-foundations/04-migrate-mvp-to-core.md))
> into a rich `ParsedDocument` and a deterministic `loadDocuments()` loader.

## Why this phase exists

`ParsedDocument` is the single data source for four different consumers, so it must be a
**superset** that satisfies all of them:

- the **rule engine** primitive vocabulary ([R9](../requirements/02-rules-engine.md)) —
  tables, sections, checklist, links, headings, content;
- **semantic graph edges** ([G1](../requirements/03-context-graph.md)) — anchors, eager
  `@imports`, and (later) ID references, plus link label text for explainability
  ([G3](../requirements/03-context-graph.md));
- **inline-disable** directives ([R8](../requirements/02-rules-engine.md));
- the **LLM context features** ([D3](../index.md)) — eager `@path.md` imports.

Avoiding re-parsing per consumer is a deliberate design choice — one parse pass feeds every
consumer.

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P1.01](01-parsed-document-contract.md) | Define the `ParsedDocument` contract (types) | S | P0 done |
| [P1.02](02-block-structure.md) | Block structure: headings(+slug), sections, tables, checklist, content | M | P1.01 |
| [P1.03](03-references-extraction.md) | References: links(+text), images, anchors, eager `@imports` | M | P1.02 |
| [P1.04](04-inline-disable-directives.md) | Inline-disable directive extraction | S | P1.03 |
| [P1.05](05-load-documents.md) | `loadDocuments()` deterministic loader | M | P1.04 |
| [P1.06](06-parser-tests-fixtures.md) | Parser tests & fixtures (incl. CJK, determinism) | M | P1.05 |

## Sequence

```
(P0.08) ─► P1.01 ─► P1.02 ─► P1.03 ─► P1.04 ─► P1.05 ─► P1.06 ─► (Phase P2)
```

## Decisions applied

- [R8](../requirements/02-rules-engine.md) inline-disable · [R9](../requirements/02-rules-engine.md)
  primitive vocabulary source · [G1](../requirements/03-context-graph.md)/[G3](../requirements/03-context-graph.md)
  semantic-edge inputs · [D3](../index.md) eager imports · GitHub-style slugs (carry over from MVP).

## Phase exit criteria

- [ ] `ParsedDocument` exposes tables (keyed rows + line + section), headings (+ slug),
      sections, links (+ label text + anchor + kind), images, checkItems, eager imports,
      inline-disable directives, and raw content — each with line positions.
- [ ] `loadDocuments(patterns, …)` returns a deterministic `Map<absPath, ParsedDocument>`
      (sorted, POSIX-normalized paths).
- [ ] Parser unit tests cover tables/checklists/sections/links/anchors/imports/directives;
      CJK fixtures pass; output is byte-stable across runs.
- [ ] No rule/graph logic added here — this phase only produces parsed data.

## What P1 unblocks

- **P2** — the rule engine runs over `ParsedDocument`; the primitive vocabulary maps onto its
  fields; the orchestrator consults the inline-disable directives.
- **P4** — `buildContextGraph` reads links/images/anchors/imports to build semantic edges;
  the deterministic search index (G4) is built from tables/headings.
- **P5** — `extractDocProfile` (compile) reads outline/tables.
