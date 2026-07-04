# P1.02 · Block structure — headings, sections, tables, checklist, content

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Done**.

## Goal

Implement the block-level extractors that fill the structural part of `ParsedDocument`:
headings (with GitHub slug), section list, GFM tables (keyed rows), checklist items, and raw
content.

## Sequence

- **Previous:** [P1.01 — ParsedDocument contract](01-parsed-document-contract.md) froze the
  target shape and field→consumer mapping.
- **Next:** [P1.03 — References extraction](03-references-extraction.md) adds links/images/
  anchors/imports to the same `ParsedDocument`.
- **Depends on:** P1.01 · **Blocks:** P1.03 (shares the parse pass), P1.06 (tests).

## Inputs (from previous work)

- current `markdown/parse.ts` (remark + remark-gfm + unist-util-visit + github-slugger), already
  in `core`, currently extracting links/headings/anchors.

## Deliverables / steps

1. Extend the single remark visit pass to also collect:
   - **headings** → `{ text, depth, slug, line }` (reuse `github-slugger` for `slug`);
   - **sections** → array of heading texts (cheap existence checks for SEC-*/CTX-*);
   - **tables** → headers + `rows[{ line, cells: Record<header,string> }]` + enclosing
     `section` + table `line` (GFM tables; map each cell to its header key);
   - **checkItems** → `{ text, checked, section?, line }` (GFM task list items);
   - **content** → raw document text.
2. Track the "current section" while walking so tables/checkItems record their enclosing
   heading. **Ownership rule (decided 2026-07-02, audit 5.3):** a block belongs to the
   **most-recent heading above it, regardless of level** — a table after an H3 (itself under an
   H2) has `section` = that H3's text. A new heading of *any* level simply becomes the current
   section (flat "last heading wins"; no hierarchical section paths, matching the single-string
   `section?` field — a higher-level heading does not reopen ancestors). If **no heading
   precedes** the block, `section` is `undefined`.
3. Keep everything in **one** traversal (no re-parse per field).

**Slug/anchor contract (decided 2026-07-02, audit 5.1).** `github-slugger`'s output is the
**canonical** slug — not an implementation detail — because the tool targets GitHub-rendered
Markdown, where github-slugger is the reference. It is authoritative for REF-002 anchor
validation, anchor graph edges ([P4.01](../P4-graph/01-context-graph-model.md)), and the slice
index ([P4.04](../P4-graph/04-search-index-slice.md)) — all consume the *same* slugs. Duplicates
are deduped in **document order** with **one slugger instance per document** (`heading`,
`heading-1`, `heading-2`, …); a bare `#heading` link resolves to the first occurrence,
`#heading-1` to the second. CJK/Unicode letters and punctuation follow github-slugger's behavior
verbatim — **no custom normalization**.

## Decisions applied

- [R9](../requirements/02-rules-engine.md) — tables/sections/checklist are primitive sources
  for TBL-*/SEC-*/CHK-*/CTX-* and declarative custom rules.

## Exit criteria

- [ ] Tables expose keyed cells, header order, line, and enclosing section.
- [ ] Headings carry correct GitHub slugs (incl. duplicates → `-1`, `-2`, in document order) and CJK/Unicode headings, per github-slugger verbatim.
- [ ] Checklist items report checked state + section.
- [ ] Single-pass extraction (no duplicate parsing).

## Hand-off to next

P1.03 hooks into the same traversal to add reference-like nodes (links/images/imports) and
heading-anchor data, reusing the section tracking established here.
