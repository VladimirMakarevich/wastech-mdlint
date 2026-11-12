import type { Node, Parent, ReferenceType } from "mdast";
import { SKIP, visit } from "unist-util-visit";

import type { ParsedUndefinedReference } from "./document-types.js";

// micromark only creates a `linkReference`/`imageReference` when the label has a definition; an
// undefined `[text][missing]` is left as plain `text`, so the AST alone cannot show it. This module
// recovers those attempts by scanning the source of each phrasing container (paragraph, heading,
// table cell) the single parse already produced — it reads the existing tree plus `content` and
// never parses Markdown again.
//
// The scan reads the *source slice*, not `text` node values: by the time a value reaches the tree
// its escapes and entities are decoded, so `\[a\]\[b\]` and `&#91;a&#93;&#91;b&#93;` would both look
// like a reference. It covers the whole container rather than one `text` node, because emphasis
// splits `[*em*][missing]` into three nodes and no single one holds both brackets.

// Descendants whose source must never be scanned: code spans and inline HTML are not Markdown,
// autolinks and inline links carry brackets that are not reference syntax, and resolved references
// (and footnote calls) are already accounted for by the parser. Each is blanked out of the scan.
const MASKED_TYPES: ReadonlySet<string> = new Set([
  "inlineCode",
  "html",
  "link",
  "image",
  "linkReference",
  "imageReference",
  "footnoteReference",
]);

// GitHub alert markers (`> [!NOTE]`) are syntactically a shortcut reference but render as an alert
// box on GitHub, so reporting them would be a false positive on every alert.
const ALERT_MARKER_PATTERN = /^!(?:note|tip|important|warning|caution)$/i;

// CommonMark caps a link label at 999 characters; anything longer is never a reference attempt.
const MAX_LABEL_LENGTH = 999;

const ASCII_PUNCTUATION_PATTERN = /[!-/:-@[-`{-~]/;

// The key mdast stores as a definition's `identifier`: micromark's `normalizeIdentifier` (collapse
// whitespace runs, trim one space, fold case through lower then upper) followed by mdast's own
// `toLowerCase`. Reimplemented rather than imported because the micromark helper is only a
// transitive dependency; matching it exactly is what makes `[t][DEF]` find `[def]: u`.
function definitionKey(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase()
    .toLowerCase();
}

function hasUnescapedBracket(label: string): boolean {
  for (let index = 0; index < label.length; index += 1) {
    const char = label[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "[" || char === "]") {
      return true;
    }
  }
  return false;
}

function displayLabel(label: string): string {
  return label.replace(/[\t\n\r ]+/g, " ").trim();
}

/**
 * Report every reference-shaped bracket run in one phrasing container whose label has no
 * definition, in source order. All three forms are returned; which ones a rule reports is the
 * rule's decision, so an option can widen it without a second parse.
 */
export function extractUndefinedReferences(
  container: Parent,
  content: string,
  definitions: ReadonlyMap<string, string>,
): ParsedUndefinedReference[] {
  const start = container.position?.start;
  const end = container.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) {
    return [];
  }

  const raw = content.slice(start.offset, end.offset);
  const masked = maskSource(container, raw, start.offset);
  const length = masked.length;

  // Pair unescaped brackets with a stack in one pass. Searching forward from every `[` on its own
  // would be quadratic on a run like `[[[[` with no closer. `closeOf[i]` is the matching `]` for the
  // `[` at `i` (or -1), and `nested[i]` says whether that pair contains another pair.
  const closeOf = new Int32Array(length).fill(-1);
  const nested = new Uint8Array(length);
  const imageOpener = new Uint8Array(length);
  const openers: number[] = [];
  // Index of the last unescaped `!`, so an escaped `\!` before a bracket never makes an image.
  let bangAt = -1;

  for (let index = 0; index < length; index += 1) {
    const char = masked[index]!;
    if (
      char === "\\" &&
      ASCII_PUNCTUATION_PATTERN.test(masked[index + 1] ?? "")
    ) {
      index += 1;
      continue;
    }
    if (char === "!") {
      bangAt = index;
    } else if (char === "[") {
      imageOpener[index] = bangAt !== -1 && bangAt === index - 1 ? 1 : 0;
      openers.push(index);
    } else if (char === "]") {
      const open = openers.pop();
      if (open !== undefined) {
        closeOf[open] = index;
        const parentOpen = openers[openers.length - 1];
        if (parentOpen !== undefined) {
          nested[parentOpen] = 1;
        }
      }
    }
  }

  const found: ParsedUndefinedReference[] = [];
  // Line bookkeeping is carried forward from one recorded reference to the next instead of
  // recounting newlines from the start of the container each time, which would make a paragraph
  // with many undefined references quadratic. Records arrive in increasing source order (the walk
  // below only moves forward), so each character is examined once.
  let lineCursor = 0;
  let linesBefore = 0;
  let lastNewline = -1;
  const record = (
    open: number,
    label: string,
    referenceType: ReferenceType,
  ): void => {
    const trimmed = displayLabel(label);
    if (
      trimmed.length === 0 ||
      label.length > MAX_LABEL_LENGTH ||
      // `[^1]` (and `[^1][]`, which GitHub renders as a footnote call followed by `[]` once the
      // footnote exists) is GFM footnote syntax, not a link reference. Only those forms: in
      // `[text][^x]` the brackets are written as a full reference, which never becomes a footnote
      // call when undefined, so it stays reportable.
      (referenceType !== "full" && trimmed.startsWith("^")) ||
      // A label cannot contain unescaped brackets. The pairing runs on masked source, so a resolved
      // link inside the brackets (`[[a](u)]`) hides its own; checking the source catches those.
      hasUnescapedBracket(label) ||
      (referenceType === "shortcut" && ALERT_MARKER_PATTERN.test(trimmed)) ||
      // Safety net: whatever shape the brackets take around it, a label that has a definition is
      // never reported, so "defined" always means "silent".
      definitions.has(definitionKey(label))
    ) {
      return;
    }
    const isImage = imageOpener[open] === 1;
    const at = isImage ? open - 1 : open;
    for (; lineCursor < at; lineCursor += 1) {
      if (raw[lineCursor] === "\n") {
        linesBefore += 1;
        lastNewline = lineCursor;
      }
    }
    found.push({
      label: trimmed,
      kind: isImage ? "image" : "link",
      referenceType,
      line: start.line + linesBefore,
      // Columns come from offsets in the source itself, so a `> ` blockquote prefix or table pipe
      // before the bracket is counted exactly as an editor counts it.
      column: lastNewline === -1 ? start.column + at : at - lastNewline,
    });
  };

  let position = 0;
  while (position < length) {
    const close = closeOf[position]!;
    if (close === -1) {
      position += 1;
      continue;
    }
    const next = close + 1;
    const nextChar = masked[next];

    // `[a](<bad)` is a failed inline link, not a reference attempt.
    if (nextChar === "(") {
      position += 1;
      continue;
    }

    if (nextChar === "[") {
      const labelClose = closeOf[next]!;
      if (labelClose === next + 1) {
        // Collapsed `[label][]`: the label is the first pair, which may not contain brackets.
        if (nested[position] === 0) {
          record(position, raw.slice(position + 1, close), "collapsed");
          position = labelClose + 1;
          continue;
        }
      } else if (labelClose !== -1 && nested[next] === 0) {
        // Full `[text][label]`: link text may hold balanced brackets, the label may not.
        record(position, raw.slice(next + 1, labelClose), "full");
        position = labelClose + 1;
        continue;
      }
      position += 1;
      continue;
    }

    if (nested[position] === 0) {
      record(position, raw.slice(position + 1, close), "shortcut");
      position = close + 1;
      continue;
    }
    position += 1;
  }

  return found;
}

// Blank every masked descendant's source to spaces, keeping line breaks so line and column
// arithmetic on the masked string still lines up with `raw` index for index.
function maskSource(
  container: Parent,
  raw: string,
  baseOffset: number,
): string {
  const chars = raw.split("");

  visit(container as Node, (node) => {
    if (node === container || !MASKED_TYPES.has(node.type)) {
      return;
    }
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from !== undefined && to !== undefined) {
      for (let index = from - baseOffset; index < to - baseOffset; index += 1) {
        const char = chars[index];
        if (char !== undefined && char !== "\n" && char !== "\r") {
          chars[index] = " ";
        }
      }
    }
    return SKIP;
  });

  return chars.join("");
}
