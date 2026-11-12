// The `ParsedDocument` contract.
//
// `ParsedDocument` is the single data source produced by one parse pass and read
// by every downstream consumer. It is deliberately a *superset* that satisfies all of them, so no
// consumer ever re-parses Markdown. The field→consumer mapping below is the contract the rest of
// the product builds on: a field may gain consumers, but moving or repurposing one silently breaks
// every reader listed beside it.
//
// Field → consumer:
// headings → REF-002 anchor slugs, SEC-* ordering, anchor graph edges, slice index (the slugs
//              reach all three through `explicitAnchors` in engine/anchor-resolve.ts)
//   htmlAnchors → REF-002, anchor graph edges, slice index (same `explicitAnchors` route)
//   sections   → cheap SEC-*/CTX-* section-existence checks
//   tables     → TBL-* rules, REF-005/006 id tables, extractDefinedIds(), compile
//   checkItems → CTX-002 checklist rules
// links → REF-001/002 link resolution, link/anchor graph edges, edge explainability
// images → REF-003 image resolution, image graph edges
// imports → LLM eager-import budget (SIZE/LLM rules), import graph edges
//   directives → inline-disable suppression (applied engine-side, not by the parser)
//   frontmatter → no rule reads it yet; it is exposed so frontmatter-aware rules can be added
//                 without re-parsing. Recognising the block matters even with no reader: a YAML
//                 block between two `---` fences would otherwise parse as a thematic break plus
//                 a setext H2, inventing a heading, section and slug, and any link, `@import` or
//                 directive-looking text inside it would be extracted as if it were prose.
//   content    → CTX-001 placeholder scan, size/token estimation, raw fallbacks. Still the whole
//                file, frontmatter bytes included, so byte/line counts match `wc` and every
//                offset a fix or line lookup computes against it stays a true source offset.
//
// Defined IDs are intentionally NOT a field: they are derived from `tables`/`headings`
// by the shared `extractDefinedIds(doc, idRef)` helper, keeping the parser
// config-light (`idPattern` is config, not a parse input) and avoiding duplicated table data.

// Link classification mirrors the legacy parser so behavior is preserved across the cutover.
export type ParsedLinkKind =
  | "local-file"
  | "same-file-anchor"
  | "external"
  | "mailto"
  | "other";

export type ParsedHeading = {
  text: string;
  depth: number;
  // GitHub-style slug (github-slugger, verbatim — never re-derived). Authoritative for REF-002, anchor
  // edges, and the slice index, so all three resolve against the identical slug string.
  slug: string;
  line: number;
};

export type ParsedTableRow = {
  line: number;
  // Cells keyed by their header text. Missing trailing cells map to "" so column-based rules can
  // assert on every declared header without index bookkeeping.
  cells: Record<string, string>;
};

export type ParsedTable = {
  headers: string[];
  rows: ParsedTableRow[];
  // Enclosing heading text (most-recent heading above, at any level — flat ownership, not nested);
  // undefined if the table precedes every heading.
  section?: string;
  line: number;
};

export type ParsedCheckItem = {
  text: string;
  checked: boolean;
  section?: string;
  line: number;
};

export type ParsedLink = {
  rawTarget: string;
  // Link label text, kept so an edge can explain itself (`design.md:42 → via "[see REQ-001]"`).
  text?: string;
  // Fragment after `#`, decoded; undefined when the link has no fragment.
  anchor?: string;
  kind: ParsedLinkKind;
  line: number;
  column?: number;
};

// A fragment target declared in raw HTML rather than by a heading: `id` on any element, or `name`
// on an `<a>`. GitHub renders both as link targets, so without them a `#custom` link to
// `<a id="custom"></a>` reads as broken. Collected from `html` nodes during the parse, which is why
// HTML shown inside inline code, a fenced block or frontmatter never contributes one.
export type ParsedHtmlAnchor = {
  // Attribute value verbatim: no entity decoding and no case folding, because the browser matches
  // a fragment against the attribute exactly as written.
  id: string;
  line: number;
};

export type ParsedImage = {
  rawTarget: string;
  line: number;
};

// Eager `@path.md` import. Becomes an `import` edge in the context graph.
export type ParsedImport = {
  rawTarget: string;
  line: number;
  column?: number;
};

export type InlineDirectiveKind = "disable" | "enable" | "disable-next-line";

// Inline-disable directive. The parser only records position + kind + canonical rule IDs;
// range/scope resolution is engine-side. `ruleIds` empty ⇒ applies to all rules.
export type InlineDirective = {
  kind: InlineDirectiveKind;
  ruleIds: string[];
  line: number;
};

// A YAML frontmatter block. Only the raw text is exposed: core has no YAML parser, so turning it
// into a structured value is left to whichever consumer first needs one.
export type ParsedFrontmatter = {
  // Text between the fences, fences excluded, line endings normalised to "\n" so a CRLF checkout
  // of the same committed file exposes the identical string.
  raw: string;
  // 1-based line of the opening fence. Always 1 in practice: the block is only recognised when the
  // fence opens the file.
  startLine: number;
  // 1-based line of the closing fence; the range is inclusive of both fences.
  endLine: number;
};

export type ParsedDocument = {
  // Repo-relative POSIX path. Not strictly parse output, but carried here because findings are
  // attributed by repo-relative path, and carrying it here fixes it deterministically at load
  // time instead of recomputing per consumer.
  path: string;
  headings: ParsedHeading[];
  // Document order, duplicates kept, so a consumer can report a repeated id at each occurrence.
  htmlAnchors: ParsedHtmlAnchor[];
  sections: string[];
  tables: ParsedTable[];
  checkItems: ParsedCheckItem[];
  links: ParsedLink[];
  images: ParsedImage[];
  imports: ParsedImport[];
  directives: InlineDirective[];
  // Required and `null` when absent, rather than optional: the key is always present, so absence is
  // explicit and survives `JSON.stringify`, which would silently drop an `undefined`.
  frontmatter: ParsedFrontmatter | null;
  content: string;
};
