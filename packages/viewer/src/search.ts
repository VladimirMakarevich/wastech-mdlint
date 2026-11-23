import MiniSearch, { type SearchOptions } from "minisearch";

import type { ParsedDocument } from "@wastech-mdlint/core";

import {
  documentHref,
  documentTitle,
  headingAbove,
} from "./render-document.js";

export type SearchHit = {
  path: string;
  title: string;
  // The document's page, at the heading nearest the match when there is one.
  href: string;
  snippet: string;
  // The words in the document that matched, for highlighting. Prefix and fuzzy matching mean these
  // can differ from what was typed ("guard" for "guar").
  terms: string[];
};

type IndexedDocument = {
  path: string;
  title: string;
  headings: string;
  text: string;
};

// Queries are capped because fuzzy matching cost grows with every term; nobody types a paragraph
// into a search box, and a request that does should not stall the server.
const MAX_QUERY_LENGTH = 200;
const RESULT_LIMIT = 20;
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 140;

const SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  // Typos are forgiven only in longer words; on short ones a fuzzy match is mostly noise.
  fuzzy: (term) => (term.length > 4 ? 0.2 : false),
  boost: { title: 4, headings: 2, path: 2 },
};

/**
 * Full-text search over the corpus.
 *
 * The index is built on the first query rather than at startup, so a reader who never searches pays
 * nothing, and it is kept in step with the corpus by object identity: the corpus replaces a
 * document's object when its file changes, so each query re-indexes exactly the documents that
 * changed since the last one.
 */
export class DocumentSearch {
  private readonly index = new MiniSearch<IndexedDocument>({
    idField: "path",
    fields: ["title", "headings", "path", "text"],
    storeFields: [],
  });
  private readonly indexed = new Map<string, ParsedDocument>();

  search(
    documents: ReadonlyMap<string, ParsedDocument>,
    query: string,
  ): SearchHit[] {
    const text = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (text.length === 0) {
      return [];
    }
    this.sync(documents);
    // Every word must match when that finds anything; otherwise any word may, so a query with one
    // word the corpus lacks still finds the documents that have the rest.
    let results = this.index.search(text, {
      ...SEARCH_OPTIONS,
      combineWith: "AND",
    });
    if (results.length === 0) {
      results = this.index.search(text, {
        ...SEARCH_OPTIONS,
        combineWith: "OR",
      });
    }
    return results.slice(0, RESULT_LIMIT).flatMap((result) => {
      const document = documents.get(String(result.id));
      return document === undefined ? [] : [toHit(document, result.terms)];
    });
  }

  private sync(documents: ReadonlyMap<string, ParsedDocument>): void {
    for (const relPath of [...this.indexed.keys()]) {
      if (!documents.has(relPath)) {
        this.index.discard(relPath);
        this.indexed.delete(relPath);
      }
    }
    for (const [relPath, document] of documents) {
      const previous = this.indexed.get(relPath);
      if (previous === document) {
        continue;
      }
      if (previous === undefined) {
        this.index.add(toIndexed(document));
      } else {
        this.index.replace(toIndexed(document));
      }
      this.indexed.set(relPath, document);
    }
  }
}

function toIndexed(document: ParsedDocument): IndexedDocument {
  return {
    path: document.path,
    title: documentTitle(document),
    headings: document.headings.map((heading) => heading.text).join("\n"),
    text: document.content.slice(bodyOffset(document)),
  };
}

function toHit(document: ParsedDocument, terms: readonly string[]): SearchHit {
  const content = document.content;
  const bodyStart = bodyOffset(document);
  // The title is already the hit's headline. A match inside it shows the reader nothing new, and its
  // anchor is just the top of the page, so the snippet and the landing place come from the text
  // under the title whenever that has a match too.
  const title = document.headings.find((heading) => heading.depth === 1);
  const belowTitle =
    title === undefined
      ? bodyStart
      : Math.max(bodyStart, lineOffset(content, title.line + 1));
  const below = firstMatch(content, terms, belowTitle);
  const at = below ?? firstMatch(content, terms, bodyStart);
  const floor = below === undefined ? bodyStart : belowTitle;

  // A heading that itself contains a matched word is the best place to land; failing that, the
  // section the first match sits in.
  const landing =
    document.headings.find(
      (heading) =>
        heading !== title &&
        terms.some((term) => heading.text.toLowerCase().includes(term)),
    ) ??
    (at === undefined
      ? undefined
      : headingAbove(document, lineAt(content, at)));
  const anchor = landing === title ? undefined : landing?.slug;

  const from = at === undefined ? floor : Math.max(floor, at - SNIPPET_BEFORE);
  const to =
    at === undefined
      ? floor + SNIPPET_BEFORE + SNIPPET_AFTER
      : at + SNIPPET_AFTER;
  const snippet = plainText(content.slice(from, to));
  return {
    path: document.path,
    title: documentTitle(document),
    href: `${documentHref(document.path)}${anchor === undefined ? "" : `#${anchor}`}`,
    snippet: `${from > floor ? "…" : ""}${snippet}${to < content.length ? "…" : ""}`,
    terms: [...terms],
  };
}

// Offset of the earliest occurrence of any term at or after `from`, case-insensitively.
function firstMatch(
  content: string,
  terms: readonly string[],
  from: number,
): number | undefined {
  const lower = content.toLowerCase();
  let at: number | undefined;
  for (const term of terms) {
    const index = lower.indexOf(term, from);
    if (index !== -1 && (at === undefined || index < at)) {
      at = index;
    }
  }
  return at;
}

// Offset of the start of a 1-based line; the end of the text when the line is past it.
function lineOffset(content: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = content.indexOf("\n", offset);
    if (next === -1) {
      return content.length;
    }
    offset = next + 1;
  }
  return offset;
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let index = content.indexOf("\n"); index !== -1 && index < offset; ) {
    line += 1;
    index = content.indexOf("\n", index + 1);
  }
  return line;
}

// Front matter is metadata, shown as its own card; matching inside it would send readers to the top
// of a page for a word that is not in its text.
function bodyOffset(document: ParsedDocument): number {
  return document.frontmatter === null
    ? 0
    : lineOffset(document.content, document.frontmatter.endLine + 1);
}

// A snippet is read as prose, so the Markdown punctuation around a match goes: link targets,
// emphasis and heading markers, table pipes and backticks.
function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
