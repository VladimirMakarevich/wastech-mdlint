import GithubSlugger from "github-slugger";
import type {
  Definition,
  Heading,
  Html,
  Image,
  ImageReference,
  Link,
  LinkReference,
  ListItem,
  Root,
  Table,
  TableRow,
  Text
} from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

import { canonicalizeRuleId } from "../rule-id.js";
import type {
  InlineDirective,
  InlineDirectiveKind,
  ParsedCheckItem,
  ParsedDocument,
  ParsedHeading,
  ParsedImage,
  ParsedImport,
  ParsedLink,
  ParsedLinkKind,
  ParsedTable,
  ParsedTableRow
} from "./document-types.js";

// One shared processor: parsing is pure, so a single GFM-enabled instance is reused across every
// document (a fresh slugger per document keeps dedupe state isolated — see parseDocument).
const markdownProcessor = remark().use(remarkParse).use(remarkGfm);

// Eager `@path.md` import syntax (D3). Kept byte-identical to the legacy llm/imports scanner so the
// import set does not shift across the cutover: leading boundary, `@`, then a `.md` target.
const IMPORT_PATTERN = /(^|[\s(])@(?<target>\/?[^\s@]+?\.md)\b/gm;

// Directive grammar (R8 / audit 2.4). `disable-next-line` precedes `disable` in the alternation so
// the longer keyword wins; trailing tokens (if any) are the rule IDs.
const DIRECTIVE_PATTERN =
  /^wastech-mdlint-(disable-next-line|disable|enable)(?:\s+([\s\S]*?))?$/;
const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->$/;

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

function classifyLink(rawTarget: string): { kind: ParsedLinkKind; anchor?: string } {
  if (rawTarget.startsWith("#")) {
    return { kind: "same-file-anchor", anchor: decodeComponent(rawTarget.slice(1)) };
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
    anchor: rawAnchorPart === undefined ? undefined : decodeComponent(rawAnchorPart)
  };
}

function resolveRawLinkTarget(
  node: LinkLikeNode | ImageLikeNode,
  definitions: Map<string, string>
): string | undefined {
  if ("url" in node) {
    return node.url;
  }

  return definitions.get(node.identifier);
}

// Map a GFM table into headers + rows keyed by header text. Cells missing from a short row default
// to "" so column-based rules (TBL-*, custom columnNotEmpty) never index past the row.
function extractTable(node: Table, section: string | undefined): ParsedTable | undefined {
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

    return { line: row.position?.start.line ?? 0, cells };
  });

  return {
    headers,
    rows,
    section,
    line: node.position?.start.line ?? 0
  };
}

// A GFM task-list item has `checked` set to a boolean (plain list items leave it null/undefined).
// The item text is its own block content excluding nested lists, so a parent item is not polluted
// by its children's text.
function extractCheckItem(
  node: ListItem,
  section: string | undefined
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
    line: node.position?.start.line ?? 0
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
    line: node.position?.start.line ?? 0
  };
}

function extractImports(node: Text): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const match of node.value.matchAll(IMPORT_PATTERN)) {
    const rawTarget = match.groups?.target;

    if (rawTarget === undefined) {
      continue;
    }

    // The match may start with a boundary char (space/paren); locate the `@` to report its column.
    const matchIndex = match.index ?? 0;
    const atOffset = match[0].lastIndexOf(`@${rawTarget}`);
    const startColumn = (node.position?.start.column ?? 1) + matchIndex + atOffset;

    imports.push({
      rawTarget: `@${rawTarget}`,
      line: node.position?.start.line ?? 0,
      column: startColumn
    });
  }

  return imports;
}

/**
 * Parse one Markdown document into the full `ParsedDocument` in a single traversal (P1.02–P1.04).
 *
 * Section tracking relies on `unist-util-visit` walking in source order (pre-order DFS): a heading
 * updates `currentSection` before any block that follows it, so each table/check-item records the
 * most-recent heading above it regardless of level (audit 5.3).
 */
export function parseDocument(params: { path: string; content: string }): ParsedDocument {
  const tree = markdownProcessor.parse(params.content) as Root;
  const definitions = getReferenceDefinitions(tree);
  const slugger = new GithubSlugger();

  const headings: ParsedHeading[] = [];
  const sections: string[] = [];
  const tables: ParsedTable[] = [];
  const checkItems: ParsedCheckItem[] = [];
  const links: ParsedLink[] = [];
  const images: ParsedImage[] = [];
  const imports: ParsedImport[] = [];
  const directives: InlineDirective[] = [];

  let currentSection: string | undefined;

  visit(tree, (node) => {
    switch (node.type) {
      case "heading": {
        const heading = node as Heading;
        const text = collectText(heading);
        currentSection = text;
        sections.push(text);
        headings.push({
          text,
          depth: heading.depth,
          slug: slugger.slug(text),
          line: heading.position?.start.line ?? 0
        });
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
        const rawTarget = resolveRawLinkTarget(linkNode, definitions);
        if (rawTarget === undefined) {
          return;
        }
        const classified = classifyLink(rawTarget);
        const label = collectText(linkNode);
        links.push({
          rawTarget,
          text: label.length > 0 ? label : undefined,
          anchor: classified.anchor,
          kind: classified.kind,
          line: linkNode.position?.start.line ?? 0,
          column: linkNode.position?.start.column
        });
        return;
      }
      case "image":
      case "imageReference": {
        const imageNode = node as ImageLikeNode;
        const rawTarget = resolveRawLinkTarget(imageNode, definitions);
        if (rawTarget === undefined) {
          return;
        }
        images.push({ rawTarget, line: imageNode.position?.start.line ?? 0 });
        return;
      }
      case "html": {
        const directive = parseDirective(node as Html);
        if (directive !== undefined) {
          directives.push(directive);
        }
        return;
      }
      case "text": {
        imports.push(...extractImports(node as Text));
        return;
      }
      default:
        return;
    }
  });

  return {
    path: params.path,
    headings,
    sections,
    tables,
    checkItems,
    links,
    images,
    imports,
    directives,
    content: params.content
  };
}
