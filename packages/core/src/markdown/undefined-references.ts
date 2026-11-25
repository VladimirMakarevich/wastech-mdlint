import type { Parent, ReferenceType } from "mdast";

import type { ParsedUndefinedReference } from "./document-types.js";
import { maskSource } from "./mask-source.js";
import { createSourceCursor } from "./source-cursor.js";

// micromark only creates a `linkReference`/`imageReference` when the label has a definition; an
// undefined `[text][missing]` is left as plain `text`, so the AST alone cannot show it. This module
// recovers those attempts by scanning the source of each phrasing container (paragraph, heading,
// table cell) the single parse already produced - it reads the existing tree plus `content` and
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

// The bracket structure of one masked container. `closeOf[i]` is the matching `]` for the `[` at
// `i` (or -1), `nested[i]` says whether that pair contains another pair, and `imageOpener[i]` whether
// the `[` at `i` directly follows an unescaped `!`.
type BracketPairs = {
  readonly closeOf: Int32Array;
  readonly nested: Uint8Array;
  readonly imageOpener: Uint8Array;
};

// Pair unescaped brackets with a stack in one pass. Searching forward from every `[` on its own
// would be quadratic on a run like `[[[[` with no closer.
function pairBrackets(masked: string): BracketPairs {
  const length = masked.length;
  const pairs: BracketPairs = {
    closeOf: new Int32Array(length).fill(-1),
    nested: new Uint8Array(length),
    imageOpener: new Uint8Array(length),
  };
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
      pairs.imageOpener[index] = bangAt !== -1 && bangAt === index - 1 ? 1 : 0;
      openers.push(index);
    } else if (char === "]") {
      closeBracketPair(pairs, openers, index);
    }
  }
  return pairs;
}

function closeBracketPair(
  pairs: BracketPairs,
  openers: number[],
  index: number,
): void {
  const open = openers.pop();
  if (open === undefined) {
    return;
  }
  pairs.closeOf[open] = index;
  const parentOpen = openers[openers.length - 1];
  if (parentOpen !== undefined) {
    pairs.nested[parentOpen] = 1;
  }
}

// Whether a reference-shaped label is reported: shapes that only look like a reference, and labels
// that do resolve, are filtered out here.
function isReportableLabel(
  label: string,
  trimmed: string,
  referenceType: ReferenceType,
  definitions: ReadonlyMap<string, string>,
): boolean {
  return !(
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
  );
}

// A reference attempt opening at one `[`, and the index the scan resumes from after it - past the
// whole attempt whether or not it ends up reported.
type ReferenceAttempt = {
  readonly label: string;
  readonly referenceType: ReferenceType;
  readonly resumeAt: number;
};

function attempt(
  label: string,
  referenceType: ReferenceType,
  resumeAt: number,
): ReferenceAttempt {
  return { label, referenceType, resumeAt };
}

// The reference attempt opening at `position`, or undefined when the bracket pair there is not
// one, in which case the scan moves on by a single character.
function referenceAttemptAt(
  pairs: BracketPairs,
  masked: string,
  raw: string,
  position: number,
): ReferenceAttempt | undefined {
  const close = pairs.closeOf[position]!;
  if (close === -1) {
    return undefined;
  }
  const next = close + 1;
  const nextChar = masked[next];

  // `[a](<bad)` is a failed inline link, not a reference attempt.
  if (nextChar === "(") {
    return undefined;
  }

  if (nextChar === "[") {
    const labelClose = pairs.closeOf[next]!;
    if (labelClose === next + 1) {
      // Collapsed `[label][]`: the label is the first pair, which may not contain brackets.
      if (pairs.nested[position] !== 0) {
        return undefined;
      }
      return attempt(
        raw.slice(position + 1, close),
        "collapsed",
        labelClose + 1,
      );
    }
    // Full `[text][label]`: link text may hold balanced brackets, the label may not.
    if (labelClose === -1 || pairs.nested[next] !== 0) {
      return undefined;
    }
    return attempt(raw.slice(next + 1, labelClose), "full", labelClose + 1);
  }

  if (pairs.nested[position] !== 0) {
    return undefined;
  }
  return attempt(raw.slice(position + 1, close), "shortcut", close + 1);
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
  const masked = maskSource(container, raw, start.offset, (node) =>
    MASKED_TYPES.has(node.type),
  );
  const pairs = pairBrackets(masked);

  const found: ParsedUndefinedReference[] = [];
  // Records arrive in increasing source order (the walk below only moves forward), which is what
  // the forward-only source cursor requires.
  const positionOf = createSourceCursor(raw, start);

  let position = 0;
  while (position < masked.length) {
    const reference = referenceAttemptAt(pairs, masked, raw, position);
    if (reference === undefined) {
      position += 1;
      continue;
    }
    const { label, referenceType } = reference;
    const trimmed = displayLabel(label);
    if (isReportableLabel(label, trimmed, referenceType, definitions)) {
      const isImage = pairs.imageOpener[position] === 1;
      found.push({
        label: trimmed,
        kind: isImage ? "image" : "link",
        referenceType,
        ...positionOf(isImage ? position - 1 : position),
      });
    }
    position = reference.resumeAt;
  }

  return found;
}
