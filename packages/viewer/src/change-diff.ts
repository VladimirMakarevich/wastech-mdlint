import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import {
  contextGaps,
  type DiffGap,
  type DiffLine,
  type GitChange,
  type TextDiff,
} from "@wastech-mdlint/core";

// A diff drawn as HTML, and the small pieces every view of a change shares: the status badge and the
// `+added −removed` count. Kept apart from the Changes page and a document's banner, which both draw
// diffs, so the two can never draw the same diff two ways.

const STATUS_NAMES: Record<GitChange["status"], string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
};

/** The word a status letter stands for, as the badge's title and the banner's sentence say it. */
export function statusName(status: GitChange["status"]): string {
  return STATUS_NAMES[status];
}

export function statusBadge(status: GitChange["status"]): Element {
  return h(
    `span.change-status.change-status-${status}`,
    { title: STATUS_NAMES[status] },
    status,
  );
}

export function stats(diff: TextDiff): string {
  return `+${diff.added} −${diff.removed}`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Each hunk of a diff on its own, inert inside a `<template>` until the page script shows one beside
 * the block it changed. Rendered here, by the code that renders the Changes page, so the browser
 * never draws a diff of its own that could disagree with it.
 */
export function renderHunkTemplate(diff: TextDiff): Element {
  return h(
    "template.change-hunks",
    diff.hunks.map((hunk, index) =>
      h(
        "div.change-hunk",
        { dataHunk: index },
        renderDiff({
          hunks: [hunk],
          added: 0,
          removed: 0,
          newlineAtEndChanged: false,
        }),
      ),
    ),
  );
}

/**
 * A diff as a table: base and head line numbers, a marker, the line. A paired line's changed words -
 * or cells - are `del` and `ins`, so they read as changes to assistive technology as well as by color.
 * A line moved elsewhere says where to, and the line it became says where from.
 *
 * With `headText`, the unchanged lines between the hunks are in the table too, hidden, each run in a
 * body of its own behind a button the page script shows: the context a reader opens around a change
 * comes from the server that drew the diff, so the browser never computes a line of its own.
 */
export function renderDiff(diff: TextDiff, headText?: string): Element {
  if (diff.hunks.length === 0) {
    return h(
      "p.diff-empty",
      diff.newlineAtEndChanged
        ? "Only the final line break changed."
        : "The text is the same on both sides.",
    );
  }
  const gaps = new Map(
    (headText === undefined ? [] : contextGaps(diff, headText)).map((gap) => [
      gap.before,
      gap,
    ]),
  );
  const bodies: Element[] = [];
  let rows: Element[] = [];
  const close = () => {
    if (rows.length > 0) {
      bodies.push(h("tbody", rows));
      rows = [];
    }
  };
  const gapBody = (index: number) => {
    const gap = gaps.get(index);
    if (gap !== undefined) {
      close();
      // Above the first hunk the lines nearest the change are the last ones, so they open from the
      // bottom; everywhere else from the top, following the hunk above.
      bodies.push(renderGap(gap, index === 0 ? "end" : "start"));
    }
  };
  diff.hunks.forEach((hunk, index) => {
    gapBody(index);
    rows.push(
      h("tr.diff-hunk", [
        h(
          "td",
          { colSpan: 4 },
          `@@ −${hunk.baseStart},${hunk.baseLines} +${hunk.headStart},${hunk.headLines} @@`,
        ),
      ]),
    );
    for (const line of hunk.lines) {
      rows.push(diffRow(line));
    }
  });
  gapBody(diff.hunks.length);
  if (diff.newlineAtEndChanged) {
    rows.push(
      h("tr.diff-note", [
        h("td", { colSpan: 4 }, "The final line break changed too."),
      ]),
    );
  }
  close();
  return h("div.diff-wrap", h("table.diff", bodies));
}

// How many unchanged lines one press of a gap's button opens.
const GAP_STEP = 20;

function renderGap(gap: DiffGap, from: "start" | "end"): Element {
  return h("tbody.diff-gap", { dataFrom: from, dataStep: GAP_STEP }, [
    h(
      "tr.diff-expand",
      { hidden: true },
      h(
        "td",
        { colSpan: 4 },
        h(
          "button.diff-expand-button",
          { type: "button" },
          gap.lines.length <= GAP_STEP
            ? `Show ${plural(gap.lines.length, "unchanged line")}`
            : `Show ${GAP_STEP} of ${gap.lines.length} unchanged lines`,
        ),
      ),
    ),
    ...gap.lines.map((line) => {
      const row = diffRow({ kind: "context", ...line });
      row.properties.hidden = true;
      return row;
    }),
  ]);
}

const MARKERS: Record<DiffLine["kind"], string> = {
  added: "+",
  removed: "−",
  context: "",
};

// Where a moved line went or came from; `undefined` for a line that did not move.
function movedNote(line: DiffLine): string | undefined {
  if (line.kind === "removed" && line.movedTo !== undefined) {
    return `moved to line ${line.movedTo}`;
  }
  if (line.kind === "added" && line.movedFrom !== undefined) {
    return `moved from line ${line.movedFrom}`;
  }
  return undefined;
}

function diffRow(line: DiffLine): Element {
  const moved = movedNote(line);
  const base = line.kind === "added" ? "" : String(line.baseLine);
  const head = line.kind === "removed" ? "" : String(line.headLine);
  const tag = line.kind === "removed" ? "del" : "ins";
  const code: ElementContent[] =
    line.kind !== "context" && line.segments !== undefined
      ? line.segments.map((segment) =>
          segment.changed
            ? h(tag, segment.text)
            : { type: "text", value: segment.text },
        )
      : [{ type: "text", value: line.text }];
  return h(
    `tr.diff-line.diff-${line.kind}${moved === undefined ? "" : ".diff-moved"}`,
    [
      h("td.diff-number", base),
      h("td.diff-number", head),
      h("td.diff-marker", MARKERS[line.kind]),
      h("td.diff-code", [
        ...code,
        moved === undefined ? undefined : h("span.diff-move", moved),
      ]),
    ],
  );
}
