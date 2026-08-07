// The `ParsedDocument` contract.
//
// `ParsedDocument` is the single data source produced by one parse pass and read
// by every downstream consumer. It is deliberately a *superset* that satisfies all of them, so no
// consumer ever re-parses Markdown. The field→consumer mapping below is the contract the rest of
// the product builds on: a field may gain consumers, but moving or repurposing one silently breaks
// every reader listed beside it.
//
// Field → consumer:
// headings → REF-002 anchor slugs, SEC-* ordering, anchor graph edges, slice index
//   sections   → cheap SEC-*/CTX-* section-existence checks
//   tables     → TBL-* rules, REF-005/006 id tables, extractDefinedIds(), compile
//   checkItems → CTX-002 checklist rules
// links → REF-001/002 link resolution, link/anchor graph edges, edge explainability
// images → REF-003 image resolution, image graph edges
// imports → LLM eager-import budget (SIZE/LLM rules), import graph edges
//   directives → inline-disable suppression (applied engine-side, not by the parser)
//   content    → CTX-001 placeholder scan, size/token estimation, raw fallbacks
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

export type ParsedDocument = {
  // Repo-relative POSIX path. Not strictly parse output, but carried here because findings are
  // attributed by repo-relative path, and carrying it here fixes it deterministically at load
  // time instead of recomputing per consumer.
  path: string;
  headings: ParsedHeading[];
  sections: string[];
  tables: ParsedTable[];
  checkItems: ParsedCheckItem[];
  links: ParsedLink[];
  images: ParsedImage[];
  imports: ParsedImport[];
  directives: InlineDirective[];
  content: string;
};
