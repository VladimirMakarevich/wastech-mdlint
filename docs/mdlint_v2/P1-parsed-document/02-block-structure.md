# P1.02 · Block structure — headings, sections, tables, checklist, content

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Not started**.

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

- MVP `markdown/parse.ts` (remark + remark-gfm + unist-util-visit + github-slugger), already
  in `core`, currently extracting links/headings/anchors.

## Deliverables / steps

1. Extend the single remark visit pass to also collect:
   - **headings** → `{ text, depth, slug, line }` (reuse `github-slugger` for `slug`);
   - **sections** → array of heading texts (cheap existence checks for SEC-*/CTX-*);
   - **tables** → headers + `rows[{ line, cells: Record<header,string> }]` + enclosing
     `section` + table `line` (GFM tables; map each cell to its header key);
   - **checkItems** → `{ text, checked, section?, line }` (GFM task list items);
   - **content** → raw document text.
2. Track the "current section" while walking so tables/checkItems can record their enclosing
   heading.
3. Keep everything in **one** traversal (no re-parse per field).

## Decisions applied

- [R9](../requirements/02-rules-engine.md) — tables/sections/checklist are primitive sources
  for TBL-*/SEC-*/CHK-*/CTX-* and declarative custom rules.

## Exit criteria

- [ ] Tables expose keyed cells, header order, line, and enclosing section.
- [ ] Headings carry correct GitHub slugs (incl. duplicates → `-1`, `-2`).
- [ ] Checklist items report checked state + section.
- [ ] Single-pass extraction (no duplicate parsing).

## Hand-off to next

P1.03 hooks into the same traversal to add reference-like nodes (links/images/imports) and
heading-anchor data, reusing the section tracking established here.
