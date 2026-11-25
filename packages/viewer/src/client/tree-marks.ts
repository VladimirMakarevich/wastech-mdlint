// The marks beside the tree's files and on the header's Changes section, as the page script redraws
// them when an event says they changed. The server draws the same marks into every page
// (`tree-marks.ts` beside the server's modules), and these builders produce exactly its markup - a
// test renders both and holds them equal - so a mark redrawn here looks like the one it replaces.
// They describe a mark rather than build it, so that test can read them without a page.

export type ReviewStatus = "unreviewed" | "reviewed" | "changed";

export type ChangeLetter = "A" | "M" | "D" | "R";

/** A `<span>` as a mark is drawn: its classes, its text and its other attributes. */
export type MarkSpec = {
  className: string;
  text: string;
  attributes: Record<string, string>;
};

const STATUS_NAMES: Record<ChangeLetter, string> = {
  A: "Added in this branch",
  M: "Modified in this branch",
  D: "Deleted in this branch",
  R: "Renamed in this branch",
};

const REVIEW_NAMES: Record<Exclude<ReviewStatus, "reviewed">, string> = {
  unreviewed: "Not reviewed yet",
  changed: "Changed since your review",
};

/** A file's count of findings, red when any is an error. */
export function findingsBadge(counts: {
  errors: number;
  warnings: number;
}): MarkSpec {
  return {
    className: counts.errors > 0 ? "tree-badge tree-badge-error" : "tree-badge",
    text: String(counts.errors + counts.warnings),
    attributes: {
      title: [
        counts.errors > 0 ? plural(counts.errors, "error") : "",
        counts.warnings > 0 ? plural(counts.warnings, "warning") : "",
      ]
        .filter((part) => part !== "")
        .join(", "),
    },
  };
}

/** The letter of what the branch did to a file, naming where a renamed one came from. */
export function changeLetter(entry: {
  status: ChangeLetter;
  oldPath?: string;
}): MarkSpec {
  return {
    className: `tree-change tree-change-${entry.status}`,
    text: entry.status,
    attributes: {
      title:
        entry.oldPath === undefined
          ? STATUS_NAMES[entry.status]
          : `${STATUS_NAMES[entry.status]}, from ${entry.oldPath}`,
    },
  };
}

/** The dot beside a changed file left to review: never reviewed, or changed since. */
export function reviewDot(status: ReviewStatus | null): MarkSpec | undefined {
  if (status === null || status === "reviewed") {
    return undefined;
  }
  return {
    className: `tree-review-dot tree-review-${status}`,
    text: "",
    attributes: {
      role: "img",
      "aria-label": REVIEW_NAMES[status],
      title: REVIEW_NAMES[status],
    },
  };
}

/**
 * The count on the header's Changes section: what is left against everything that changed, or only
 * how many changed where marks cannot be read. Nothing when nothing changed.
 */
export function changesCount(
  changed: number,
  review: { left: number; total: number } | null,
): MarkSpec | undefined {
  if (changed === 0) {
    return undefined;
  }
  if (review === null) {
    return {
      className: "segment-count",
      text: String(changed),
      attributes: { title: `${changed} changed ${documents(changed)}` },
    };
  }
  return {
    className: review.left === 0 ? "segment-count is-done" : "segment-count",
    text: `${review.left}/${review.total}`,
    attributes: {
      title: `${review.left} of ${review.total} changed ${documents(review.total)} left to review`,
    },
  };
}

export function markElement(spec: MarkSpec): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = spec.className;
  if (spec.text !== "") {
    element.textContent = spec.text;
  }
  for (const [name, value] of Object.entries(spec.attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

/** Whether the server drew these marks into the page as they are now, so none need asking for. */
export function drawnByServer(marks: "findings" | "changes"): boolean {
  const marked =
    document.querySelector<HTMLElement>(".sidebar")?.dataset.marked ?? "";
  return marked.split(" ").includes(marks);
}

function documents(count: number): string {
  return count === 1 ? "document" : "documents";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
