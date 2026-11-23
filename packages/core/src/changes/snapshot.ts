import { compareStrings } from "../deterministic-sort.js";
import type { ParsedDocument } from "../markdown/document-types.js";

// Another version of a corpus without loading it again: the documents a host already holds, with
// the few a change touched taken out or put in. Every other document is the same object, so a lint
// of the result parses nothing and costs what a lint of the held corpus costs.

/**
 * One document's difference between two versions: `remove` is a path the held corpus has and the
 * other version lacks; `add` is a document the other version has, parsed from its text there. A
 * change in place names the same path in both; a rename names each side's own.
 */
export type DocumentSwap = { remove?: string; add?: ParsedDocument };

/**
 * `documents` with every swap applied, keyed and ordered by path in code-point order, so the result
 * does not depend on the order the swaps were listed in.
 */
export function replaceDocuments(
  documents: ReadonlyMap<string, ParsedDocument>,
  swaps: readonly DocumentSwap[],
): Map<string, ParsedDocument> {
  const result = new Map(documents);
  for (const swap of swaps) {
    if (swap.remove !== undefined) {
      result.delete(swap.remove);
    }
  }
  for (const swap of swaps) {
    if (swap.add !== undefined) {
      result.set(swap.add.path, swap.add);
    }
  }
  return new Map(
    [...result].sort(([left], [right]) => compareStrings(left, right)),
  );
}
