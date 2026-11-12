import type { Html, Node, Parent } from "mdast";
import { SKIP, visit } from "unist-util-visit";

// Inline HTML elements whose content an author writes to be shown literally, not read as prose.
// remark splits `<code>(text)[./a.md]</code>` into an opening `html` node, a `text` node and a
// closing `html` node, so masking the tags alone would leave the content in the scan; the span
// between them is masked as well. Ordinary inline elements such as `<b>` or `<span>` are left
// alone: their content renders as prose, so a mistake written there is still on the page.
//
// Two kinds, because they close differently. The code-like phrasing elements contain markup, so
// they nest: in `<code>a <code>b</code> c</code>` the first `</code>` closes only the inner element
// and `c` is still code, which is why openings of the same element are counted.
const CODE_LIKE_ELEMENTS: ReadonlySet<string> = new Set([
  "code",
  "kbd",
  "samp",
  "tt",
  "pre",
]);
// The raw-text and escapable raw-text elements (and the legacy ones a browser treats the same way)
// contain no markup at all: a `<script>` inside a script is text, and the first `</script>` ends
// it. Counting openings here would let that text keep the element open past its real end.
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);

// Matched against one inline `html` node's whole value, which remark gives each tag on its own. No
// `g` flag, so neither pattern carries `lastIndex` from one node to the next.
const OPEN_TAG_PATTERN = /^<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/;
const CLOSE_TAG_PATTERN = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>$/;

/**
 * Blank the source of every descendant `shouldMask` selects to spaces, keeping line breaks so line
 * and column arithmetic on the masked string still lines up with `raw` index for index. `raw` is
 * the container's own source slice and `baseOffset` its start offset in the document. The content
 * of a literal-content inline HTML element is blanked too, whatever `shouldMask` says.
 *
 * The source scanners share this one implementation so that "what the AST says is not prose" is
 * decided the same way for each of them; a masked node's descendants are skipped, since their
 * source lies inside a range already blanked.
 */
export function maskSource(
  container: Parent,
  raw: string,
  baseOffset: number,
  shouldMask: (node: Node) => boolean,
): string {
  const chars = raw.split("");
  const blank = (from: number, to: number): void => {
    for (let index = from - baseOffset; index < to - baseOffset; index += 1) {
      const char = chars[index];
      if (char !== undefined && char !== "\n" && char !== "\r") {
        chars[index] = " ";
      }
    }
  };

  // The outermost literal-content element currently open, the offset its content starts at, and
  // how many openings of that same element are still unclosed (always 1 for a raw-text element).
  // The walk is pre-order, so `html` nodes arrive in source order even when emphasis nests one tag
  // deeper than the other, and the span between them is blanked by offset rather than by sibling.
  // An element never closed runs to the end of the container, as an unclosed one does in a
  // browser. A different literal element opened inside it needs no tracking: its whole extent is
  // already inside the span being blanked.
  let literal: { element: string; from: number; depth: number } | undefined;

  visit(container as Node, (node) => {
    if (node === container) {
      return;
    }
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (node.type === "html" && from !== undefined && to !== undefined) {
      const value = (node as Html).value;
      const opened = OPEN_TAG_PATTERN.exec(value)?.[1]?.toLowerCase();
      if (literal === undefined) {
        if (
          opened !== undefined &&
          (CODE_LIKE_ELEMENTS.has(opened) || RAW_TEXT_ELEMENTS.has(opened))
        ) {
          literal = { element: opened, from: to, depth: 1 };
        }
      } else if (opened === literal.element && CODE_LIKE_ELEMENTS.has(opened)) {
        literal.depth += 1;
      } else if (
        CLOSE_TAG_PATTERN.exec(value)?.[1]?.toLowerCase() === literal.element
      ) {
        literal.depth -= 1;
        if (literal.depth === 0) {
          blank(literal.from, from);
          literal = undefined;
        }
      }
    }
    if (!shouldMask(node)) {
      return;
    }
    if (from !== undefined && to !== undefined) {
      blank(from, to);
    }
    return SKIP;
  });

  if (literal !== undefined) {
    blank(literal.from, baseOffset + raw.length);
  }

  return chars.join("");
}
