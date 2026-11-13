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
//   tables     → TBL-* rules (TBL-007 via row cellCount), REF-005/006 id tables, extractDefinedIds(), compile
//   checkItems → CTX-002 checklist rules
// links → REF-001/002 link resolution, link/anchor graph edges, edge explainability, REF-008
//              empty and bare-`#` targets
// images → REF-003 image resolution, image graph edges, REF-008 empty targets
//   undefinedReferences → REF-007. Deliberately no graph edge: an undefined label has no target,
//                and an edge would have to invent one.
//   reversedLinks → REF-008. Deliberately no graph edge: the target is unrendered text on the page,
//                so no reader can follow it.
// imports → LLM eager-import budget (SIZE/LLM rules), import graph edges
//   directives → inline-disable suppression (applied engine-side, not by the parser)
//   frontmatter → FM-001 and the `frontmatterRequired`/`frontmatterInSet`/`frontmatterMatches`
//                 custom kinds, all through `parsed`, so the YAML is parsed once here and never by
//                 a rule. Recognising the block matters beyond those readers: a YAML block between
//                 two `---` fences would otherwise parse as a thematic break plus a setext H2,
//                 inventing a heading, section and slug, and any link, `@import` or
//                 directive-looking text inside it would be extracted as if it were prose.
//   firstBlock → SEC-004 title check. A parse-pass fact rather than a scan of `content`, because
//                deciding what comes "first" means skipping front matter, comments and link
//                definitions, and a rule doing that over raw text would be re-parsing Markdown.
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
  // Cells keyed by their header text. Missing trailing cells map to "" and cells beyond the header
  // are dropped, so column-based rules can assert on every declared header without index
  // bookkeeping.
  cells: Record<string, string>;
  // The number of cells as written, before `cells` pads or truncates the row to the header. `cells`
  // alone hides both defects: TBL-007 reads this to report a row whose count differs from the
  // header's, and TBL-002 reads it to tell a padding cell (never written) from one written empty.
  cellCount: number;
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
  column?: number;
};

// A reference-style link or image whose label has no definition. micromark leaves such a construct
// as plain text, so it never reaches `links` or `images`; without this field no rule and no edge
// would ever see it, and it renders on the page as the literal brackets.
export type ParsedUndefinedReference = {
  // The label as written in the source (escapes not decoded), whitespace runs collapsed to one
  // space and trimmed, so the message quotes what the author typed. For the collapsed and shortcut
  // forms this is the link text.
  label: string;
  kind: "link" | "image";
  // mdast's own names: `full` is `[text][label]`, `collapsed` is `[label][]`, `shortcut` is
  // `[label]`. Every form is recorded; the rule decides which to report.
  referenceType: "full" | "collapsed" | "shortcut";
  // 1-based source position of the opening `[`, or of the `!` for an image.
  line: number;
  column: number;
};

// Link syntax written in the wrong order, `(text)[target]`. micromark leaves it as plain text (or as
// text around an autolink), so it never reaches `links`; it renders on the page as the literal
// parentheses and brackets, and without this field no rule would ever see it.
export type ParsedReversedLink = {
  // The parenthetical as written in the source (escapes not decoded), whitespace runs collapsed to
  // one space and trimmed, so the message quotes what the author typed.
  text: string;
  // The bracket content exactly as written.
  target: string;
  // 1-based source position of the opening `(`.
  line: number;
  column: number;
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

// A front matter value under the failsafe YAML schema: every scalar is a string with no number,
// boolean or date coercion (YAML's own quoting, escapes and block scalars are still decoded), an
// empty value is "", and an empty block is `null`.
export type FrontmatterValue =
  | string
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

// The block parsed as YAML, or why it could not be. A structured error rather than a throw, so one
// malformed block becomes one finding instead of aborting the run. `line` is a 1-based file line.
export type FrontmatterParseResult =
  | { ok: true; value: FrontmatterValue }
  | { ok: false; error: { message: string; line: number } };

// A YAML frontmatter block: the raw text plus its one YAML parse, done in the parse pass so no
// consumer parses it again.
export type ParsedFrontmatter = {
  // Text between the fences, fences excluded, line endings normalised to "\n" so a CRLF checkout
  // of the same committed file exposes the identical string.
  raw: string;
  // 1-based line of the opening fence. Always 1 in practice: the block is only recognised when the
  // fence opens the file.
  startLine: number;
  // 1-based line of the closing fence; the range is inclusive of both fences.
  endLine: number;
  parsed: FrontmatterParseResult;
};

// The first top-level block that renders something, by its mdast node type (`heading`,
// `paragraph`, `html`, `list`, `blockquote`, …) and 1-based line. Only the type and line are kept,
// not the node, so the contract stays small and serialisable while still saying *what* came first.
export type ParsedFirstBlock = {
  type: string;
  line: number;
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
  // Document order.
  undefinedReferences: ParsedUndefinedReference[];
  // Document order.
  reversedLinks: ParsedReversedLink[];
  imports: ParsedImport[];
  directives: InlineDirective[];
  // Required and `null` when absent, rather than optional: the key is always present, so absence is
  // explicit and survives `JSON.stringify`, which would silently drop an `undefined`.
  frontmatter: ParsedFrontmatter | null;
  // `null` when nothing renders (an empty file, or front matter alone); required for the same
  // reason as `frontmatter`.
  firstBlock: ParsedFirstBlock | null;
  content: string;
};
