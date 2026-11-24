import { type BlameLine, compareStrings } from "@wastech-mdlint/core";

import type { LineAnnotator } from "./render-document.js";

// Blame in the margin: for each block, the commit that last touched any of its lines, from core's
// `git blame`. A block is one unit to a reader, so the newest of its lines speaks for it — a paragraph
// edited yesterday reads as edited yesterday, however old its other lines are.

/**
 * The margin note of each block, from one blame of the file. A block with a line not yet committed
 * says so, since that is the newest change of all. `showAuthor` is off where the page is read from
 * other machines: an author's name is a person's, kept to this machine as absolute paths are.
 */
export function blameAnnotator(
  lines: readonly (BlameLine | undefined)[],
  showAuthor: boolean,
): LineAnnotator {
  return (start, end) => {
    const newest = newestLine(lines, start, end);
    if (newest === "uncommitted") {
      return { text: "uncommitted", title: "Not committed yet" };
    }
    if (newest?.commit === undefined) {
      return undefined;
    }
    const short = newest.short ?? newest.commit.slice(0, 7);
    const date = newest.date ?? "";
    const author =
      showAuthor && newest.author !== undefined && newest.author !== ""
        ? ` · ${newest.author}`
        : "";
    return {
      text: `${short} ${date}`.trim(),
      title: `${short} · ${date}${author} — ${newest.subject ?? ""}`,
    };
  };
}

// The newest blamed line from `start` to `end`, one-based and inclusive, or "uncommitted" as soon as
// one line is not committed yet.
function newestLine(
  lines: readonly (BlameLine | undefined)[],
  start: number,
  end: number,
): BlameLine | "uncommitted" | undefined {
  let newest: BlameLine | undefined;
  for (let line = start; line <= end; line += 1) {
    const entry = lines[line - 1];
    if (entry === undefined) {
      continue;
    }
    if (entry.commit === undefined) {
      return "uncommitted";
    }
    if (isNewer(entry, newest)) {
      newest = entry;
    }
  }
  return newest;
}

// By date, then by commit name, so two commits of one day always pick the same one.
function isNewer(entry: BlameLine, newest: BlameLine | undefined): boolean {
  return (
    newest === undefined ||
    compareStrings(entry.date ?? "", newest.date ?? "") > 0 ||
    (entry.date === newest.date &&
      compareStrings(entry.commit ?? "", newest.commit ?? "") > 0)
  );
}
