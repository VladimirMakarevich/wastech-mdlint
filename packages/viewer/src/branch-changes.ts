import type { Review } from "./changes.js";
import type { DashboardChange } from "./dashboard.js";
import type { GraphChanges } from "./graph-view.js";
import type { ReviewContext } from "./review-context.js";

// The review of a branch, restated for the pages that show it beside everything else: the dashboard's
// Branch column and the graph's marks. Both read the work-tree review, as they show the files on
// disk, and take every fact from it and its context rather than comparing anything again.

/** Per document on disk: its letter when the branch changed it, and the findings it gained and lost. */
export function dashboardChanges(
  review: Review,
  context: ReviewContext,
): Map<string, DashboardChange> {
  const renamed = renames(review);
  const changes = new Map<string, DashboardChange>();
  const entry = (relPath: string) => {
    let change = changes.get(relPath);
    if (change === undefined) {
      change = { findingsAdded: 0, findingsRemoved: 0 };
      changes.set(relPath, change);
    }
    return change;
  };
  for (const document of review.documents) {
    if (document.status !== "D") {
      entry(document.path).status = document.status;
    }
  }
  for (const message of context.delta.findings.added) {
    entry(message.filePath).findingsAdded += 1;
  }
  for (const message of context.delta.findings.removed) {
    const relPath = renamed.get(message.filePath) ?? message.filePath;
    // A finding in a document the branch deleted has no row to go on.
    if (review.snapshot.documents.has(relPath)) {
      entry(relPath).findingsRemoved += 1;
    }
  }
  return changes;
}

/** The changed and affected documents and the links the branch made and broke. */
export function graphChanges(
  review: Review,
  context: ReviewContext,
): GraphChanges {
  const { affected } = context.delta;
  return {
    status: new Map(
      review.documents.flatMap((document) =>
        document.status === "D" ? [] : [[document.path, document.status]],
      ),
    ),
    affected: new Set([
      ...affected.findings.map((entry) => entry.path),
      ...affected.codeLinks.map((link) => link.from),
      ...affected.linking.map((entry) => entry.path),
    ]),
    links: context.delta.links,
    renamed: renames(review),
  };
}

function renames(review: Review): Map<string, string> {
  return new Map(
    review.documents.flatMap((document) =>
      document.oldPath === undefined ? [] : [[document.oldPath, document.path]],
    ),
  );
}
