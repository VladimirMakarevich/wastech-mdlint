import type { ParsedDocument } from "../markdown/document-types.js";

// Shared fragment resolution. REF-002 and the graph's `anchor` edges both decide "does `#x` resolve
// in this document" with `anchorResolves`, so under REF-002's default options a rule finding and an
// `impact` edge cannot disagree about a fragment. The slice index reads only `explicitAnchors`, so
// `slice "#x"` agrees with them on heading slugs and HTML anchors; implicit fragments (`#top`, line
// fragments) are deliberately left out of slice queries, since they resolve in every document and
// would match the whole corpus.

// The fragments a document declares itself: heading slugs (github-slugger, already deduplicated
// in document order by the parser) followed by HTML `id`/`name` anchors. This is the one anchor
// set; implicit fragments are kept out of it because they name no particular document.
export function explicitAnchors(document: ParsedDocument): string[] {
  return [
    ...document.headings.map((heading) => heading.slug),
    ...document.htmlAnchors.map((anchor) => anchor.id),
  ];
}

// GitHub line fragments: `L5`, `L5C3`, `L10-L12`, `L10C5-L12C3`. Lines and columns are 1-based,
// so `L0` is rejected; bare `L` and `Lx` are not line fragments at all. No `g` flag, so `test` holds
// no `lastIndex` state across calls. Line numbers are deliberately not checked against the file's
// length: the grammar alone is what separates a line fragment from a mistyped slug, and a range
// check would turn every edit that shortens a file into a finding in some other document.
const LINE_FRAGMENT_PATTERN =
  /^L[1-9]\d*(?:C[1-9]\d*)?(?:-L[1-9]\d*(?:C[1-9]\d*)?)?$/;

// Fragments that resolve in every document without a declaring heading or element. `top` follows
// HTML's rule that a missing `top` fragment scrolls to the start of the document, and HTML compares
// it ASCII-case-insensitively. Line fragments stay case-sensitive, as GitHub's are: `#l5` is not one.
export function isImplicitFragment(fragment: string): boolean {
  return (
    fragment.toLowerCase() === "top" || LINE_FRAGMENT_PATTERN.test(fragment)
  );
}

export type AnchorResolveOptions = {
  // Fold both sides with `toLowerCase`, never `toLocaleLowerCase`: locale-aware folding depends on
  // the host's ICU data and default locale (Turkish dotted/dotless i), so the same config could
  // resolve differently on two machines. Implicit fragments are unaffected.
  ignoreCase?: boolean;
};

export function anchorResolves(
  document: ParsedDocument,
  fragment: string,
  options: AnchorResolveOptions = {},
): boolean {
  if (isImplicitFragment(fragment)) {
    return true;
  }
  if (options.ignoreCase === true) {
    const folded = fragment.toLowerCase();
    return explicitAnchors(document).some(
      (anchor) => anchor.toLowerCase() === folded,
    );
  }
  return explicitAnchors(document).includes(fragment);
}
