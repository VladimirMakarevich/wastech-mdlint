// A document's link to a span of a file is written the GitHub way, `file.ts#L12-L20`. Single lines
// work without script because each line has an `id`; a range names no element, so it is resolved
// here: the lines are marked and the first one is scrolled into view.

export function initSourceLines(): void {
  if (document.querySelector(".source-view") === null) {
    return;
  }
  highlightLineRange();
  window.addEventListener("hashchange", highlightLineRange);
}

/**
 * The lines a `#L<n>` or `#L<n>-L<m>` fragment selects in a file of `lineCount` lines, first to last,
 * or `undefined` when it selects none. Either end may be written first, and either may name a column
 * (`#L5C3-L9C1`), which selects its whole line. The range is cut to the file, so a fragment naming
 * line 999999999 — in a link or typed into the address — costs as many steps as the file has lines,
 * not a billion.
 *
 * The grammar is the one core reads line fragments with (`parseLineFragment`), which a module served
 * to the browser cannot import; a viewer test runs both through one table of fragments, so a link
 * the review calls a line range is one this page marks, and the reverse.
 */
export function lineRange(
  hash: string,
  lineCount: number,
): { first: number; last: number } | undefined {
  const match =
    /^#L([1-9]\d*)(?:C[1-9]\d*)?(?:-L([1-9]\d*)(?:C[1-9]\d*)?)?$/.exec(hash);
  if (match === null) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  const first = Math.max(1, Math.min(start, end));
  const last = Math.min(lineCount, Math.max(start, end));
  return first <= last ? { first, last } : undefined;
}

function highlightLineRange(): void {
  for (const line of document.querySelectorAll(".line.is-selected")) {
    line.classList.remove("is-selected");
  }
  const range = lineRange(
    location.hash,
    document.querySelectorAll(".source-view .line").length,
  );
  if (range === undefined) {
    return;
  }
  for (let number = range.first; number <= range.last; number += 1) {
    document.getElementById(`L${number}`)?.classList.add("is-selected");
  }
  document
    .getElementById(`L${range.first}`)
    ?.scrollIntoView({ block: "center" });
}
