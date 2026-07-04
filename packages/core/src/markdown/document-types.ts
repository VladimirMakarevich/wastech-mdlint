// The `ParsedDocument` contract (P1.01).
//
// `ParsedDocument` is the single data source produced by one parse pass (P1.02–P1.04) and read
// by every downstream consumer. It is deliberately a *superset* that satisfies all of them, so no
// consumer ever re-parses Markdown. The field→consumer mapping below is the contract other phases
// build on; per P1.01 no field moves once P1.02 starts filling it.
//
// Field → consumer:
//   headings   → REF-002 anchor slugs, SEC-* ordering, anchor graph edges (P4), slice index (P4)
//   sections   → cheap SEC-*/CTX-* section-existence checks
//   tables     → TBL-* rules, REF-005/006 id tables, extractDefinedIds() (P4/REF-005), compile
//   checkItems → CHK-001 / CTX-002 checklist rules
//   links      → REF-001/002 link resolution, link/anchor graph edges (P4), G3 explainability
//   images     → REF-003 image resolution, image graph edges (P4)
//   imports    → D3 LLM eager-import budget (SIZE/LLM rules), import graph edges (P4)
//   directives → R8 inline-disable suppression (applied engine-side in P2.05)
//   content    → CTX-001 placeholder scan, size/token estimation, raw fallbacks
//
// Defined IDs are intentionally NOT a field (audit 2.1): they are derived from `tables`/`headings`
// by the shared `extractDefinedIds(doc, idRef)` helper (P4/REF-005), keeping the parser
// config-light (`idPattern` is config, not a parse input) and avoiding duplicated table data.

// Link classification mirrors the legacy parser so behavior is preserved across the cutover.
export type ParsedLinkKind = "local-file" | "same-file-anchor" | "external" | "mailto" | "other";

export type ParsedHeading = {
  text: string;
  depth: number;
  // GitHub-style slug (github-slugger, verbatim — audit 5.1). Authoritative for REF-002, anchor
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
  // Enclosing heading text (most-recent heading above, any level — audit 5.3); undefined if the
  // table precedes every heading.
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
  // Link label text kept for G3 explainability (`design.md:42 → via "[see REQ-001]"`).
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

// Eager `@path.md` import (D3). Becomes an `import` graph edge in P4.
export type ParsedImport = {
  rawTarget: string;
  line: number;
  column?: number;
};

export type InlineDirectiveKind = "disable" | "enable" | "disable-next-line";

// Inline-disable directive (R8). The parser only records position + kind + canonical rule IDs;
// range/scope resolution is engine-side (P2.05). `ruleIds` empty ⇒ applies to all rules.
export type InlineDirective = {
  kind: InlineDirectiveKind;
  ruleIds: string[];
  line: number;
};

export type ParsedDocument = {
  // Repo-relative POSIX path. Additive to the P1.01 minimum (journal [P1.01]): findings are
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
