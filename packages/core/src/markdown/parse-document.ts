import GithubSlugger from "github-slugger";
import type {
  Definition,
  Emphasis,
  Heading,
  Html,
  Image,
  Paragraph,
  ImageReference,
  Link,
  LinkReference,
  ListItem,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
  Yaml,
} from "mdast";
import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

import { findLineNumber } from "../engine/text-position.js";
import { canonicalizeRuleId } from "../rule-id.js";
import type {
  InlineDirective,
  InlineDirectiveKind,
  ParsedCheckItem,
  ParsedDocument,
  ParsedEmphasisParagraph,
  ParsedFirstBlock,
  ParsedFrontmatter,
  ParsedHeading,
  ParsedHtmlAnchor,
  ParsedImage,
  ParsedImport,
  ParsedLink,
  ParsedLinkKind,
  ParsedReferenceDefinition,
  ParsedReversedLink,
  ParsedTable,
  ParsedTableRow,
  ParsedTextSpan,
  ParsedUndefinedReference,
} from "./document-types.js";
import { parseFrontmatterYaml } from "./parse-frontmatter.js";
import { extractReversedLinks } from "./reversed-links.js";
import { extractUndefinedReferences } from "./undefined-references.js";

// One shared processor: parsing is pure, so a single GFM-enabled instance is reused across every
// document (a fresh slugger per document keeps dedupe state isolated — see parseDocument).
// Frontmatter is recognised here, in the same parse, because without it a YAML block between two
// `---` fences parses as a thematic break plus a setext H2 and invents a heading. Only `yaml` is
// enabled: a TOML `+++` line is not a setext underline, so it never caused that defect, and with
// no TOML consumer recognising it would only hide text from the outline.
const markdownProcessor = remark()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"]);

// Eager `@path.md` import syntax. Kept byte-identical to the legacy llm/imports scanner so the
// import set does not shift across the cutover: leading boundary, `@`, then a `.md` target.
const IMPORT_PATTERN = /(^|[\s(])@(?<target>\/?[^\s@]+?\.md)\b/gm;

// Directive grammar. `disable-next-line` precedes `disable` in the alternation so
// the longer keyword wins; trailing tokens (if any) are the rule IDs.
const DIRECTIVE_PATTERN =
  /^wastech-mdlint-(disable-next-line|disable|enable)(?:\s+([\s\S]*?))?$/;
const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->$/;

// HTML anchor extraction is a deliberately small heuristic over `html` node text, not an HTML
// parser (core takes no HTML-parser dependency for two attributes). Whatever sits inside a quoted
// attribute value is text, never markup, so both patterns below consume a quoted value whole: the
// tag pattern so that `<`/`>` in `title="a <span id='x'> b"` neither ends the tag nor starts a
// ghost `<span>`, and the attribute pattern so that `id=` in a value is not an attribute. Known gap:
// an unterminated quote cannot be skipped as a value, so text after it is scanned as markup.
// The alternatives inside each repetition start with disjoint characters, so matching stays linear
// rather than backtracking.
//
// Comments and open tags are matched by one pattern, in source order, so a commented-out `<a id>`
// is skipped as a whole comment, and a `<!--` written inside a `<script>` is never mistaken for a
// comment that hides the `</script>` closing it. An unterminated comment runs to the end of the
// node, as it does in a browser. Each scan compiles its own copy of this source, so no `lastIndex`
// is shared between nodes or documents.
const HTML_COMMENT_OR_OPEN_TAG_SOURCE =
  /<!--[\s\S]*?(?:-->|$)|<([A-Za-z][A-Za-z0-9-]*)(\s(?:[^<>"']|"[^"]*"|'[^']*')*?)?\/?>/
    .source;
// Elements whose content the HTML parser reads as plain text up to the matching end tag, never as
// markup: the raw-text and escapable raw-text elements, plus the legacy ones it treats the same
// way. `<a id="x">` inside a script string or a textarea's default text is not an anchor on the
// page. `noscript` is left out because its content is markup whenever scripting is disabled.
const RAW_TEXT_ELEMENT_CLOSE_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
  [
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
  ].map(
    // No `g` flag: used only with `String#search`, which ignores and preserves `lastIndex`.
    (element) => [element, new RegExp(`</${element}(?=[\\s/>]|$)`, "i")],
  ),
);
// One attribute (name, then an optional quoted or unquoted value), consumed left to right. The
// sticky `y` flag makes each match start exactly where the previous one ended, so a quoted value is
// always swallowed whole as part of its own attribute: `id='ghost'` written inside
// `title="foo id='ghost'"` can never be read as an attribute of its own, which an unanchored search
// for `id=` would do. Matching whole attribute names is also what keeps `data-id=` and `aid=` from
// counting as an `id`. On markup the tokenizer cannot follow (a stray quote between attributes) it
// stops early and misses later attributes rather than inventing one.
const HTML_ATTRIBUTE_PATTERN =
  /[\s/]*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gy;

type LinkLikeNode = Link | LinkReference;
type ImageLikeNode = Image | ImageReference;

function collectText(node: unknown): string {
  let text = "";

  visit(node as Parameters<typeof visit>[0], (child) => {
    if ("value" in child && typeof child.value === "string") {
      text += child.value;
    }
  });

  return text;
}

// An inline `<br>` tag in any of its spellings: any case, self-closed or not, with or without
// attributes (`<br class="x">`, attribute values spanning lines included), and the stray end tag
// `</br>`, which HTML parsers also render as a line break. The parser only emits an `html` node for
// a single tag CommonMark has already validated, so the tag name followed by whitespace, `/` or
// the closing `>` is enough to identify it; `<brx>` and `<bra>` are other tags and do not match.
// No `g` flag: the pattern is shared across every link of every document, and a `g`-flagged
// `test` would carry `lastIndex` from one call into the next.
const HTML_LINE_BREAK_PATTERN = /^<\/?br(?:[\s/][\s\S]*)?>$/iu;

// What a reader sees of a link label, as opposed to `collectText`, which also gathers the source of
// raw HTML nodes. Only `text` and `inlineCode` values are visible, and other `html` is markup that
// contributes nothing. A Markdown `break` and an inline `<br>` both render as a line break, so they
// contribute whitespace rather than gluing the words either side together: `[click<br>here](a.md)`
// reads as "click here", not "clickhere". An image contributes nothing, matching `collectText`: its
// `alt` describes the image.
function collectVisibleText(node: unknown): string {
  let text = "";

  visit(node as Parameters<typeof visit>[0], (child) => {
    if (
      child.type === "break" ||
      (child.type === "html" &&
        "value" in child &&
        typeof child.value === "string" &&
        HTML_LINE_BREAK_PATTERN.test(child.value))
    ) {
      text += "\n";
    } else if (
      (child.type === "text" || child.type === "inlineCode") &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      text += child.value;
    }
  });

  return text;
}

// Decode a single percent-encoded fragment (anchor) so it matches github-slugger output, which
// operates on decoded Unicode text. Left as-is on malformed input.
function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getReferenceDefinitions(tree: Root): Map<string, string> {
  const definitions = new Map<string, string>();

  visit(tree, "definition", (node: Definition) => {
    definitions.set(node.identifier, node.url);
  });

  return definitions;
}

// Only the first child can be frontmatter: the micromark extension matches the opening fence at
// document offset 0 and nowhere else, so a `---` later in the file stays a thematic break.
function extractFrontmatter(tree: Root): ParsedFrontmatter | null {
  const first = tree.children[0];

  if (first?.type !== "yaml") {
    return null;
  }

  const node = first as Yaml;

  // LF-normalised so a CRLF checkout (`core.autocrlf` on Windows) exposes the same string as the
  // committed file. Only line numbers are exposed, never offsets, so normalising cannot put
  // anything out of step with `content`.
  const raw = node.value.replace(/\r\n?/g, "\n");
  const startLine = node.position?.start.line ?? 1;
  return {
    raw,
    startLine,
    endLine: node.position?.end.line ?? 1,
    parsed: parseFrontmatterYaml(raw, startLine),
  };
}

// Anchored and without the `g` flag, so no `lastIndex` state survives between documents. Matches
// an `html` block made only of comments, which includes every inline-disable directive.
const HTML_COMMENTS_ONLY_PATTERN = /^(?:<!--[\s\S]*?-->\s*)+$/;

// The first top-level child that renders something. Skipped: `yaml` (front matter is metadata, not
// page content), `definition` (a link reference definition renders nothing), and an `html` block
// that is only comments (a directive or a licence banner is invisible on the page, so it must not
// count as prose before the title). An `html` block with real markup — a badge `<img>`, a
// `<p align=center>` — does render, so it counts. Top level only: a heading nested in a blockquote
// or list is not a document title, so the container's own type is what is reported.
function extractFirstBlock(tree: Root): ParsedFirstBlock | null {
  for (const node of tree.children) {
    if (node.type === "yaml" || node.type === "definition") {
      continue;
    }
    if (
      node.type === "html" &&
      HTML_COMMENTS_ONLY_PATTERN.test((node as Html).value.trim())
    ) {
      continue;
    }
    return { type: node.type, line: node.position?.start.line ?? 0 };
  }
  return null;
}

// Top-level paragraphs made of exactly one `strong`/`emphasis` node whose only child is `text`.
// Iterating `tree.children` rather than `visit`ing the tree is what excludes list items,
// blockquotes, footnote definitions and table cells without any ancestor tracking: their paragraphs
// are never direct children of the root. Nested formatting (`***x***`), inline code or a link inside
// the emphasis is not plain text, so it is not recorded — matching markdownlint MD036, which treats
// such a run as styled prose rather than a stand-in heading. A setext-underlined `**x**` is a
// `heading` node and so never reaches here.
function extractEmphasisParagraphs(tree: Root): ParsedEmphasisParagraph[] {
  const found: ParsedEmphasisParagraph[] = [];
  for (const node of tree.children) {
    if (node.type !== "paragraph" || node.children.length !== 1) {
      continue;
    }
    const inline = node.children[0]!;
    if (inline.type !== "strong" && inline.type !== "emphasis") {
      continue;
    }
    const inner = (inline as Strong | Emphasis).children;
    if (inner.length !== 1 || inner[0]!.type !== "text") {
      continue;
    }
    found.push({
      text: (inner[0] as Text).value,
      kind: inline.type,
      line: node.position?.start.line ?? 0,
    });
  }
  return found;
}

function classifyLink(rawTarget: string): {
  kind: ParsedLinkKind;
  anchor?: string;
} {
  if (rawTarget.startsWith("#")) {
    return {
      kind: "same-file-anchor",
      anchor: decodeComponent(rawTarget.slice(1)),
    };
  }

  let parsed: URL | undefined;

  try {
    parsed = new URL(rawTarget);
  } catch {
    parsed = undefined;
  }

  if (parsed?.protocol === "http:" || parsed?.protocol === "https:") {
    return { kind: "external" };
  }

  if (parsed?.protocol === "mailto:") {
    return { kind: "mailto" };
  }

  if (parsed?.protocol !== undefined) {
    return { kind: "other" };
  }

  const [, rawAnchorPart] = rawTarget.split("#", 2);

  return {
    kind: "local-file",
    anchor:
      rawAnchorPart === undefined ? undefined : decodeComponent(rawAnchorPart),
  };
}

function resolveRawLinkTarget(
  node: LinkLikeNode | ImageLikeNode,
  definitions: Map<string, string>,
): string | undefined {
  if ("url" in node) {
    return node.url;
  }

  return definitions.get(node.identifier);
}

// Map a GFM table into headers + rows keyed by header text. Cells missing from a short row default
// to "" so column-based rules (TBL-*, custom columnNotEmpty) never index past the row, and cells
// beyond the header are dropped. remark-gfm itself keeps every cell a row was written with, so the
// written count is recorded as `cellCount` — otherwise this mapping would hide a malformed row from
// TBL-007. The cell split is micromark's, so `\|` (inside a code span too) never counts as a
// separator.
function extractTable(
  node: Table,
  section: string | undefined,
): ParsedTable | undefined {
  const [headerRow, ...bodyRows] = node.children as TableRow[];

  if (headerRow === undefined) {
    return undefined;
  }

  const headers = headerRow.children.map((cell) => collectText(cell).trim());

  const rows: ParsedTableRow[] = bodyRows.map((row) => {
    const cells: Record<string, string> = {};

    headers.forEach((header, index) => {
      const cell = row.children[index];
      cells[header] = cell === undefined ? "" : collectText(cell).trim();
    });

    return {
      line: row.position?.start.line ?? 0,
      cells,
      cellCount: row.children.length,
    };
  });

  return {
    headers,
    rows,
    section,
    line: node.position?.start.line ?? 0,
  };
}

// A GFM task-list item has `checked` set to a boolean (plain list items leave it null/undefined).
// The item text is its own block content excluding nested lists, so a parent item is not polluted
// by its children's text.
function extractCheckItem(
  node: ListItem,
  section: string | undefined,
): ParsedCheckItem | undefined {
  if (node.checked === null || node.checked === undefined) {
    return undefined;
  }

  const text = node.children
    .filter((child) => child.type !== "list")
    .map((child) => collectText(child))
    .join(" ")
    .trim();

  return {
    text,
    checked: node.checked,
    section,
    line: node.position?.start.line ?? 0,
  };
}

function parseDirective(node: Html): InlineDirective | undefined {
  const commentMatch = HTML_COMMENT_PATTERN.exec(node.value.trim());

  if (commentMatch === null) {
    return undefined;
  }

  const directiveMatch = DIRECTIVE_PATTERN.exec((commentMatch[1] ?? "").trim());

  if (directiveMatch === null) {
    return undefined;
  }

  const ruleIds = (directiveMatch[2] ?? "")
    .split(/[\s,]+/)
    .filter((token) => token.length > 0)
    .map(canonicalizeRuleId);

  return {
    kind: directiveMatch[1] as InlineDirectiveKind,
    ruleIds,
    line: node.position?.start.line ?? 0,
  };
}

// `id` counts on any element and `name` only on `<a>`, mirroring HTML itself: `name` is a fragment
// target only on an anchor element, while an `id` anywhere is one (and GitHub keeps it).
//
// `openRawText` is the raw-text element (see `RAW_TEXT_ELEMENT_CLOSE_PATTERNS`) still open when the
// previous `html` node ended, and the return value carries it on to the next one. It has to cross
// nodes because remark splits inline HTML: in `x <script>'<a id="g">'</script>` the opening tag, the
// `<a id="g">` and the closing tag are three separate `html` nodes, so no single node shows that the
// anchor sits inside a script. An element never closed keeps everything after it out of the anchor
// set, which is also how a browser reads the rendered page.
function extractHtmlAnchors(
  node: Html,
  openRawText: string | undefined,
): { anchors: ParsedHtmlAnchor[]; openRawText: string | undefined } {
  const anchors: ParsedHtmlAnchor[] = [];
  const nodeStartLine = node.position?.start.line ?? 0;
  const value = node.value;
  const scanner = new RegExp(HTML_COMMENT_OR_OPEN_TAG_SOURCE, "g");
  let rawText = openRawText;

  for (;;) {
    if (rawText !== undefined) {
      const rest = value.slice(scanner.lastIndex);
      const closeAt = rest.search(
        RAW_TEXT_ELEMENT_CLOSE_PATTERNS.get(rawText)!,
      );
      if (closeAt === -1) {
        return { anchors, openRawText: rawText };
      }
      scanner.lastIndex += closeAt + rawText.length + 2;
      rawText = undefined;
    }

    const tag = scanner.exec(value);
    if (tag === null) {
      return { anchors, openRawText: undefined };
    }
    const tagName = tag[1]?.toLowerCase();
    if (tagName === undefined) {
      // A comment: nothing inside it is markup.
      continue;
    }
    // A trailing `/` does not close a non-void element in HTML, so `<script/>` still opens one.
    if (RAW_TEXT_ELEMENT_CLOSE_PATTERNS.has(tagName)) {
      rawText = tagName;
    }
    const attributes = tag[2];
    if (attributes === undefined) {
      continue;
    }
    const isAnchorElement = tagName === "a";
    // HTML keeps only the first occurrence of an attribute on a tag and drops later duplicates, so
    // `<a id="real" id="ghost">` declares `real` alone. A name is marked seen before its value is
    // checked, because an empty first `id=""` also wins and leaves the element with no anchor.
    const seenAttributes = new Set<string>();

    for (const attribute of attributes.matchAll(HTML_ATTRIBUTE_PATTERN)) {
      const attributeName = (attribute[1] ?? "").toLowerCase();
      if (seenAttributes.has(attributeName)) {
        continue;
      }
      seenAttributes.add(attributeName);
      if (
        attributeName !== "id" &&
        !(attributeName === "name" && isAnchorElement)
      ) {
        continue;
      }
      const id = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      if (id.length === 0) {
        continue;
      }
      // A block html node spans several lines, so the line comes from the newlines before the tag.
      anchors.push({
        id,
        line: nodeStartLine + findLineNumber(value, tag.index) - 1,
      });
    }
  }
}

function extractImports(node: Text): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const nodeStartLine = node.position?.start.line ?? 0;
  const nodeStartColumn = node.position?.start.column ?? 1;

  for (const match of node.value.matchAll(IMPORT_PATTERN)) {
    const rawTarget = match.groups?.target;

    if (rawTarget === undefined) {
      continue;
    }

    // The match may start with a boundary char (space/paren); locate the `@`'s offset within
    // node.value so position tracking anchors on the `@` itself, not the leading boundary.
    const matchIndex = match.index ?? 0;
    const atOffset = match[0].lastIndexOf(`@${rawTarget}`);
    const atCharIndex = matchIndex + atOffset;

    // remark packs consecutive non-blank lines into one `text` node, so a later-line import must not
    // inherit the node's start line. Derive the position from node.value alone: newlines
    // before the `@` give the line delta, and the offset from the start of the `@`'s own physical
    // line gives the column. Column is measured within node.value, which remark reports 1:1 for
    // ordinary paragraphs; mapping a column back through container prefixes and decoded entities
    // needs a full source remapper, which is deliberately not built here.
    const lineDelta = findLineNumber(node.value, atCharIndex) - 1;
    const lastNewlineIndex = node.value.lastIndexOf("\n", atCharIndex - 1);

    imports.push({
      rawTarget: `@${rawTarget}`,
      line: nodeStartLine + lineDelta,
      column:
        lastNewlineIndex === -1
          ? nodeStartColumn + atCharIndex
          : atCharIndex - lastNewlineIndex,
    });
  }

  return imports;
}

// The source offsets of an inline link's fragment, or undefined when they cannot be pinned down
// exactly. mdast gives the link node's span but not the destination's, so the destination is found
// by walking the source after the link text: `](`, optional spaces/tabs and at most one line
// ending, an optional `<`, then the destination itself. Every step must match byte for byte — the
// parsed `url` equals the source only when no escape or entity was used — and any mismatch gives
// up rather than guess, because a fix that writes to a guessed offset corrupts the file.
function locateFragmentRange(
  node: Link,
  rawTarget: string,
  content: string,
): { start: number; end: number } | undefined {
  const hashIndex = rawTarget.indexOf("#");
  const nodeStart = node.position?.start.offset;
  if (hashIndex === -1 || nodeStart === undefined) {
    return undefined;
  }
  const lastChild = node.children[node.children.length - 1];
  const textEnd =
    lastChild === undefined ? nodeStart + 1 : lastChild.position?.end.offset;
  if (textEnd === undefined || !content.startsWith("](", textEnd)) {
    return undefined;
  }
  let cursor = textEnd + 2;
  const skipBlanks = () => {
    while (content[cursor] === " " || content[cursor] === "\t") {
      cursor += 1;
    }
  };
  skipBlanks();
  if (content.startsWith("\r\n", cursor)) {
    cursor += 2;
  } else if (content[cursor] === "\n" || content[cursor] === "\r") {
    cursor += 1;
  }
  skipBlanks();
  if (content[cursor] === "<") {
    cursor += 1;
  }
  if (!content.startsWith(rawTarget, cursor)) {
    return undefined;
  }
  return { start: cursor + hashIndex + 1, end: cursor + rawTarget.length };
}

// A link whose source does not open with `[` is an autolink (`<https://x>` or a GFM literal
// `www.x.com`): its only text child is the URL itself, not prose.
function isAutolink(node: Link, content: string): boolean {
  const start = node.position?.start.offset;
  return start !== undefined && content[start] !== "[";
}

// Offsets of `[` and `]` in `content[start, end)` that are not backslash-escaped. Called on a `text`
// node's own source, where any bracket that is not escaped is literal: one that was link syntax
// would have produced a link node instead of text. An entity such as `&#91;` is not a bracket in
// the source and never becomes syntax, so it is rightly not counted.
function findUnescapedBrackets(
  content: string,
  start: number,
  end: number,
): number[] {
  const found: number[] = [];
  for (let index = start; index < end; index += 1) {
    const char = content[index];
    if (char !== "[" && char !== "]") {
      continue;
    }
    let backslashes = 0;
    while (content[index - 1 - backslashes] === "\\") {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      found.push(index);
    }
  }
  return found;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/**
 * Parse one Markdown document into the full `ParsedDocument` in a single traversal.
 *
 * Section tracking relies on `unist-util-visit` walking in source order (pre-order DFS): a heading
 * updates `currentSection` before any block that follows it, so each table/check-item records the
 * most-recent heading above it regardless of level.
 */
export function parseDocument(params: {
  path: string;
  content: string;
}): ParsedDocument {
  const tree = markdownProcessor.parse(params.content) as Root;
  const definitions = getReferenceDefinitions(tree);
  const slugger = new GithubSlugger();

  const headings: ParsedHeading[] = [];
  const htmlAnchors: ParsedHtmlAnchor[] = [];
  // Raw-text element left open by an earlier `html` node; carried in source order because the
  // visit is a pre-order walk, so `html` nodes arrive in the order a browser would read them.
  let openRawText: string | undefined;
  const sections: string[] = [];
  const tables: ParsedTable[] = [];
  const checkItems: ParsedCheckItem[] = [];
  const links: ParsedLink[] = [];
  const images: ParsedImage[] = [];
  const undefinedReferences: ParsedUndefinedReference[] = [];
  const reversedLinks: ParsedReversedLink[] = [];
  const imports: ParsedImport[] = [];
  const directives: InlineDirective[] = [];
  const referenceDefinitions: ParsedReferenceDefinition[] = [];
  const referencedIdentifiers = new Set<string>();
  const textSpans: ParsedTextSpan[] = [];
  const literalBrackets: number[] = [];
  // Heading text nodes mapped to their heading's slug. Filled when the walk reaches the heading,
  // which a pre-order walk does before any of its descendants, so the `text` case can look its
  // node up without tracking ancestors.
  const headingSlugByText = new Map<Text, string>();
  // Text that is a reference label, not prose: everything inside a shortcut `[label]` or collapsed
  // `[label][]` reference, where the visible text is also the key that finds the definition.
  // Rewriting it would orphan the definition and break the link. A full `[text][label]` reference
  // keeps its label separately, so its text stays prose. Filled the same pre-order way as
  // `headingSlugByText`, so nested formatting such as `[*label*]` is covered too.
  const referenceLabelText = new Set<Text>();

  let currentSection: string | undefined;

  // A `yaml` node is a childless literal, not `text`, `link` or `html`, so it falls through to
  // `default`: nothing inside frontmatter can become a heading, link, `@import` or directive.
  visit(tree, (node, _index, parent) => {
    switch (node.type) {
      case "heading": {
        const heading = node as Heading;
        const text = collectText(heading);
        const slug = slugger.slug(text);
        currentSection = text;
        sections.push(text);
        headings.push({
          text,
          depth: heading.depth,
          slug,
          line: heading.position?.start.line ?? 0,
        });
        visit(heading, "text", (child: Text) => {
          headingSlugByText.set(child, slug);
        });
        undefinedReferences.push(
          ...extractUndefinedReferences(heading, params.content, definitions),
        );
        reversedLinks.push(...extractReversedLinks(heading, params.content));
        return;
      }
      // Paragraphs, headings and table cells are the phrasing containers, and they never nest, so
      // each byte of inline source is scanned for undefined references and for reversed link syntax
      // exactly once per scanner. No `SKIP`:
      // their `text`, `link` and `html` descendants must still be visited below.
      case "paragraph":
      case "tableCell": {
        undefinedReferences.push(
          ...extractUndefinedReferences(
            node as Paragraph | TableCell,
            params.content,
            definitions,
          ),
        );
        reversedLinks.push(
          ...extractReversedLinks(
            node as Paragraph | TableCell,
            params.content,
          ),
        );
        return;
      }
      case "table": {
        const table = extractTable(node as Table, currentSection);
        if (table !== undefined) {
          tables.push(table);
        }
        return;
      }
      case "listItem": {
        const checkItem = extractCheckItem(node as ListItem, currentSection);
        if (checkItem !== undefined) {
          checkItems.push(checkItem);
        }
        return;
      }
      case "link":
      case "linkReference": {
        const linkNode = node as LinkLikeNode;
        if (
          linkNode.type === "linkReference" &&
          linkNode.referenceType !== "full"
        ) {
          visit(linkNode, "text", (child: Text) => {
            referenceLabelText.add(child);
          });
        }
        const rawTarget = resolveRawLinkTarget(linkNode, definitions);
        if (rawTarget === undefined) {
          return;
        }
        if (linkNode.type === "linkReference") {
          referencedIdentifiers.add(linkNode.identifier);
        }
        const classified = classifyLink(rawTarget);
        const label = collectText(linkNode);
        const visibleLabel = collectVisibleText(linkNode);
        const fragmentRange =
          linkNode.type === "link" && classified.anchor !== undefined
            ? locateFragmentRange(linkNode, rawTarget, params.content)
            : undefined;
        links.push({
          rawTarget,
          text: label.length > 0 ? label : undefined,
          ...(visibleLabel === label ? {} : { visibleText: visibleLabel }),
          anchor: classified.anchor,
          kind: classified.kind,
          line: linkNode.position?.start.line ?? 0,
          column: linkNode.position?.start.column,
          ...(fragmentRange === undefined ? {} : { fragmentRange }),
        });
        return;
      }
      case "image":
      case "imageReference": {
        const imageNode = node as ImageLikeNode;
        if (imageNode.type === "imageReference") {
          referencedIdentifiers.add(imageNode.identifier);
        }
        const rawTarget = resolveRawLinkTarget(imageNode, definitions);
        if (rawTarget === undefined) {
          return;
        }
        images.push({
          rawTarget,
          alt: imageNode.alt ?? "",
          line: imageNode.position?.start.line ?? 0,
          column: imageNode.position?.start.column,
        });
        return;
      }
      case "html": {
        const directive = parseDirective(node as Html);
        if (directive !== undefined) {
          directives.push(directive);
        }
        const extracted = extractHtmlAnchors(node as Html, openRawText);
        htmlAnchors.push(...extracted.anchors);
        openRawText = extracted.openRawText;
        return;
      }
      case "definition": {
        const definition = node as Definition;
        const start = definition.position?.start.offset;
        const end = definition.position?.end.offset;
        if (start === undefined || end === undefined) {
          return;
        }
        referenceDefinitions.push({
          label: definition.label ?? definition.identifier,
          identifier: definition.identifier,
          line: definition.position?.start.line ?? 0,
          endLine: definition.position?.end.line ?? 0,
          start,
          end,
          topLevel: parent === tree,
          // Filled in after the walk: a reference may come after its definition.
          referenced: false,
        });
        return;
      }
      case "text": {
        const textNode = node as Text;
        imports.push(...extractImports(textNode));
        const start = textNode.position?.start.offset;
        const end = textNode.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          literalBrackets.push(
            ...findUnescapedBrackets(params.content, start, end),
          );
        }
        if (
          start !== undefined &&
          end !== undefined &&
          !referenceLabelText.has(textNode) &&
          !(
            parent?.type === "link" &&
            isAutolink(parent as Link, params.content)
          ) &&
          normalizeLineEndings(params.content.slice(start, end)) ===
            normalizeLineEndings(textNode.value)
        ) {
          const headingSlug = headingSlugByText.get(textNode);
          textSpans.push(
            headingSlug === undefined
              ? { start, end }
              : { start, end, headingSlug },
          );
        }
        return;
      }
      default:
        return;
    }
  });

  for (const definition of referenceDefinitions) {
    definition.referenced = referencedIdentifiers.has(definition.identifier);
  }

  return {
    path: params.path,
    headings,
    htmlAnchors,
    sections,
    tables,
    checkItems,
    links,
    images,
    undefinedReferences,
    reversedLinks,
    referenceDefinitions,
    textSpans,
    literalBrackets,
    imports,
    directives,
    frontmatter: extractFrontmatter(tree),
    firstBlock: extractFirstBlock(tree),
    emphasisParagraphs: extractEmphasisParagraphs(tree),
    content: params.content,
  };
}
