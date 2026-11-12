import type { Link, Node, Parent } from "mdast";

import type { ParsedReversedLink } from "./document-types.js";
import { maskSource } from "./mask-source.js";
import { createSourceCursor } from "./source-cursor.js";

// `(text)[target]` is link syntax written in the wrong order. micromark has no construct for it, so
// it leaves no node of its own: it is spread over `text` nodes, around an autolink when the target
// is a URL, around emphasis when the text has some. This module recovers it by scanning the source
// of each phrasing container (paragraph, heading, table cell) the single parse already produced —
// it reads the existing tree plus `content` and never parses Markdown again.
//
// The AST decides what is prose; the source decides what is syntax. Only phrasing containers are
// scanned, so a fenced or indented code block (never a phrasing container) is never read, and every
// descendant that is not prose is blanked out first. The scan then reads the *source slice*, not
// `text` node values: by the time a value reaches the tree its escapes and entities are decoded, so
// `\(text\)[./a.md]` and `&#40;text&#41;[./a.md]` would both look like reversed syntax. It covers the
// whole container rather than one `text` node, because `(text)[https://example.com]` and
// `(*em*)[./a.md]` are split across several nodes and no single one holds both the parens and the
// brackets.

// Descendants whose source must never be scanned: code spans and inline HTML are not Markdown,
// images and resolved references (and footnote calls) are real constructs whose brackets are not a
// reversed target, and inline links carry their own `](`. A resolved shortcut reference is what
// keeps `(see the guide)[guide]` with a `[guide]: …` definition silent: its brackets are masked, so
// nothing follows the `)`.
const MASKED_TYPES: ReadonlySet<string> = new Set([
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "linkReference",
  "footnoteReference",
]);

const ASCII_PUNCTUATION_PATTERN = /[!-/:-@[-`{-~]/;

const WHITESPACE_PATTERN = /\s/;

// Bracketed prose is common — `(see below)[1]`, `(sic)[WIP]`, a citation marker after a
// parenthetical — and is indistinguishable from reversed syntax by shape alone. So the bracket
// content must look like a link target before anything is reported: a URI scheme, a leading `/`,
// `./`, `../`, `#` or `www.`, any `/`, or a trailing file extension (optionally with a fragment).
// Run over the extracted bracket token only, never over the document, and without the `g` flag, so
// it carries no `lastIndex` from one test to the next.
const TARGET_LIKE_PATTERN =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\.\.?\/|#|www\.)|\/|\.[A-Za-z][A-Za-z0-9]*(?:#.*)?$/;

/**
 * Report every `(text)[target]` run in one phrasing container whose bracket content looks like a
 * link target, in source order.
 */
export function extractReversedLinks(
  container: Parent,
  content: string,
): ParsedReversedLink[] {
  const start = container.position?.start;
  const end = container.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) {
    return [];
  }

  const raw = content.slice(start.offset, end.offset);
  // An inline link `[x](u)` is masked so its `)` and brackets never pair with prose around it, but
  // an autolink (a GFM literal or `<url>`, whose source does not open with `[`) stays visible: it is
  // the bracket content of `(text)[https://example.com]`.
  const masked = maskSource(
    container,
    raw,
    start.offset,
    (node: Node) =>
      MASKED_TYPES.has(node.type) ||
      (node.type === "link" &&
        content[(node as Link).position?.start.offset ?? -1] === "["),
  );
  const length = masked.length;

  // Pair unescaped parens with a stack in one pass, so nesting balances (`(a (b) c)[./x.md]`) and a
  // run of openers with no closer stays linear. `openOf[i]` is the matching `(` for the `)` at `i`
  // (or -1). `escaped[i]` marks a character written after a backslash, which is literal text.
  const openOf = new Int32Array(length).fill(-1);
  const escaped = new Uint8Array(length);
  const openers: number[] = [];

  for (let index = 0; index < length; index += 1) {
    const char = masked[index]!;
    if (
      char === "\\" &&
      ASCII_PUNCTUATION_PATTERN.test(masked[index + 1] ?? "")
    ) {
      escaped[index + 1] = 1;
      index += 1;
      continue;
    }
    if (char === "(") {
      openers.push(index);
    } else if (char === ")") {
      const open = openers.pop();
      if (open !== undefined) {
        openOf[index] = open;
      }
    }
  }

  const candidates: { open: number; text: string; target: string }[] = [];

  for (let close = 0; close < length; close += 1) {
    const open = openOf[close]!;
    if (open === -1 || masked[close + 1] !== "[") {
      continue;
    }

    // Find the `]` closing the target. A link target cannot hold unescaped whitespace, and stopping
    // at the next `[` as well keeps every forward scan disjoint from the next one, so the whole
    // container is still read in linear time.
    let bracketClose = -1;
    for (let index = close + 2; index < length; index += 1) {
      const char = masked[index]!;
      if (WHITESPACE_PATTERN.test(char) || char === "[") {
        break;
      }
      if (char === "]" && escaped[index] === 0) {
        bracketClose = index;
        break;
      }
    }
    if (bracketClose === -1) {
      continue;
    }
    // `(note)[x](u)` and `(note)[x][label]` are an inline link and a full reference after a
    // parenthetical; when they did not resolve, that is REF-001's or REF-007's concern.
    const after = masked[bracketClose + 1];
    if (after === "(" || after === "[") {
      continue;
    }

    const text = raw
      .slice(open + 1, close)
      .replace(/[\t\n\r ]+/g, " ")
      .trim();
    const target = raw.slice(close + 2, bracketClose);
    if (text.length === 0 || !TARGET_LIKE_PATTERN.test(target)) {
      continue;
    }

    candidates.push({ open, text, target });
    close = bracketClose;
  }

  // Candidates are found in order of their `)`, and a nested one — `((a)[./x.md] b)[./y.md]` —
  // closes before the parenthetical around it opens, so they are put in `(` order first: that is
  // the document order the field promises, and the source cursor only moves forward.
  candidates.sort((left, right) => left.open - right.open);
  const positionOf = createSourceCursor(raw, start);

  return candidates.map(({ open, text, target }) => ({
    text,
    target,
    ...positionOf(open),
  }));
}
