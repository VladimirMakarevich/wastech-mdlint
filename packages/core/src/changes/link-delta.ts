import { compareStrings } from "../deterministic-sort.js";
import { parseLineFragment } from "../engine/anchor-resolve.js";
import { filePart, resolveTargetCandidates } from "../engine/path-resolve.js";
import type { SiteRouterSettings } from "../engine/types.js";
import type {
  ContextGraph,
  ContextGraphEdge,
} from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import {
  lineCorrespondence,
  lineRangeKept,
  type LineRun,
} from "./text-diff.js";

// What a change does to the links between files: the links it adds and removes between documents,
// and the links that still read the same but now point at other code.

export type EdgesDelta = {
  /** Edges of the later graph beyond as many equal ones as the earlier graph had. */
  added: ContextGraphEdge[];
  /** Edges of the earlier graph, as it held them, that the later graph lacks. */
  removed: ContextGraphEdge[];
};

/**
 * The edges two graphs of one corpus differ by, as multisets keyed by source, target and type: a
 * document that links to another twice and now once has lost one link. `renamed` maps an earlier
 * path to its later one, so a document that only moved keeps its links instead of losing every one
 * and gaining them back.
 */
export function compareEdges(
  before: ContextGraph,
  after: ContextGraph,
  renamed: ReadonlyMap<string, string> = new Map(),
): EdgesDelta {
  const moved = (relPath: string) => renamed.get(relPath) ?? relPath;
  const key = (from: string, to: string, type: string) =>
    `${from}\u0000${to}\u0000${type}`;
  const beforeKeys = before.edges.map((edge) =>
    key(moved(edge.from), moved(edge.to), edge.type),
  );
  const afterKeys = after.edges.map((edge) =>
    key(edge.from, edge.to, edge.type),
  );
  return {
    added: beyond(after.edges, afterKeys, beforeKeys),
    removed: beyond(before.edges, beforeKeys, afterKeys),
  };
}

function beyond(
  edges: readonly ContextGraphEdge[],
  keys: readonly string[],
  otherKeys: readonly string[],
): ContextGraphEdge[] {
  const remaining = new Map<string, number>();
  for (const key of otherKeys) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return edges.filter((_edge, index) => {
    const key = keys[index]!;
    const left = remaining.get(key) ?? 0;
    remaining.set(key, left - 1);
    return left <= 0;
  });
}

/** A document's link to a span of lines in a file, `file.ts#L12-L20`. */
export type CodeLineLink = {
  from: string;
  /** The line of the link in `from`. */
  line: number;
  target: string;
  start: number;
  end: number;
};

/**
 * The links to a span of lines in a changed file whose lines no longer show what they showed: a
 * line in the span was edited, or a change above it moved the span. Such a link was written against
 * the base, so it now points at other code while every check of its file and fragment still passes.
 * A change below the span leaves it alone.
 *
 * `files` holds each changed file's text at the base and now; only those are looked at. A span
 * reaching past the base file's end is cut there, since the lines beyond it never existed for the
 * link to point at.
 */
export function linksIntoChangedLines(
  documents: Iterable<ParsedDocument>,
  files: ReadonlyMap<string, { baseText: string; headText: string }>,
  siteRouter?: SiteRouterSettings,
): CodeLineLink[] {
  const runs = new Map<string, { runs: LineRun[]; baseLines: number }>();
  const correspondence = (target: string) => {
    let known = runs.get(target);
    if (known === undefined) {
      const texts = files.get(target)!;
      known = {
        runs: lineCorrespondence(texts.baseText, texts.headText),
        baseLines: lineCount(texts.baseText),
      };
      runs.set(target, known);
    }
    return known;
  };

  const found: CodeLineLink[] = [];
  for (const document of documents) {
    for (const link of document.links) {
      const span =
        link.kind === "local-file" && link.anchor !== undefined
          ? parseLineFragment(link.anchor)
          : undefined;
      if (span === undefined) {
        continue;
      }
      const target = resolveTargetCandidates(
        document.path,
        filePart(link.rawTarget),
        siteRouter,
      ).find((candidate) => files.has(candidate));
      if (target === undefined) {
        continue;
      }
      const { runs: fileRuns, baseLines } = correspondence(target);
      const end = Math.min(span.end, baseLines);
      if (span.start > end || lineRangeKept(fileRuns, span.start, end)) {
        continue;
      }
      found.push({
        from: document.path,
        line: link.line,
        target,
        start: span.start,
        end: span.end,
      });
    }
  }
  return found.sort(
    (left, right) =>
      compareStrings(left.from, right.from) ||
      left.line - right.line ||
      compareStrings(left.target, right.target) ||
      left.start - right.start,
  );
}

// Lines as the diff counts them: a final line without a line break is still a line.
function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  const breaks = text.match(/\r\n?|\n/g)?.length ?? 0;
  return /(?:\r\n?|\n)$/.test(text) ? breaks : breaks + 1;
}
