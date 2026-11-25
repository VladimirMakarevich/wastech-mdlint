import { compareStrings } from "../deterministic-sort.js";
import type { LintResult } from "../engine/lint-corpus.js";
import type { LintMessage } from "../engine/types.js";
import type { GitBaseSource } from "../git/git-repository.js";
import {
  type ChangeImpact,
  classifyChangeImpact,
} from "../graph/impact-analysis.js";
import type { SinceAnalysis } from "./branch-review.js";

// What `lint` and `impact` answer "since" a ref: the findings a branch adds, and the documents its
// changes reach. Built here rather than in each host, so the CLI's `--since` and the MCP tools'
// `since` cannot report different findings for one branch — the comparison is the same one the
// viewer's Changes page shows.

/** Which comparison a "since" answer describes. */
export type SinceSummary = {
  /**
   * The ref compared with — as given, else the config's `git.base`, else the detected base branch —
   * and the commit it named.
   */
  ref: string;
  /**
   * Where `ref` came from: named for the run, the config's `git.base`, or detected. Reported so a
   * comparison nobody chose — a bare `--since`, an unquoted empty variable after it — never passes
   * for one somebody did.
   */
  source: GitBaseSource;
  base: string;
  /** Where the branch left it: the base side of every comparison. */
  mergeBase: string;
  head: string;
  /** The corpus documents the branch changed, uncommitted work included, by path. */
  changed: string[];
  /** Findings the change removes, at their base path and line. */
  removed: LintMessage[];
};

/** Only the findings the branch adds — anywhere in the corpus, unchanged documents included. */
export type SinceLintResult = LintResult & { since: SinceSummary };

export type SinceImpact = ChangeImpact & { since: SinceSummary };

function summaryOf(analysis: SinceAnalysis): SinceSummary {
  const { set } = analysis.review;
  return {
    ref: set.base.ref,
    source: set.base.source,
    base: set.base.commit,
    mergeBase: set.mergeBase,
    head: set.head,
    changed: analysis.review.documents
      .map((document) => document.path)
      .sort(compareStrings),
    removed: analysis.context.delta.findings.removed,
  };
}

/**
 * The findings the branch adds, as a lint result a host formats and gates on as it would any lint
 * run: a CI job can fail on new errors and stay green on old ones. `files` are the changed
 * documents that still exist; a finding on an unchanged document — a link the change broke — is
 * still reported, since the change caused it.
 */
export function sinceLintResult(analysis: SinceAnalysis): SinceLintResult {
  const messages = analysis.context.delta.findings.added;
  const errorCount = messages.filter(
    (message) => message.severity === "error",
  ).length;
  return {
    messages,
    files: analysis.review.documents
      .filter((document) => document.status !== "D")
      .map((document) => document.path)
      .sort(compareStrings),
    errorCount,
    warningCount: messages.length - errorCount,
    since: summaryOf(analysis),
  };
}

/** The blast radius of every document the branch changed, on the corpus as it is now. */
export function sinceImpact(analysis: SinceAnalysis): SinceImpact {
  return {
    ...classifyChangeImpact(
      analysis.snapshot.graph,
      analysis.review.documents.map((document) => document.path),
    ),
    since: summaryOf(analysis),
  };
}

/**
 * The line a human report starts with, naming the comparison, so a reader of "No problems found."
 * knows it means "nothing new since this commit" and not "nothing at all". A base the run did not
 * name says where it came from — a guess also says how to choose another — since it may not be the
 * branch the reader meant.
 */
export function renderSinceHeader(summary: SinceSummary): string {
  const changed = summary.changed.length;
  const removed = summary.removed.length;
  return `since ${summary.ref} (${SOURCE_NOTE[summary.source]}merge-base ${summary.mergeBase.slice(0, 7)}): ${changed} changed document${
    changed === 1 ? "" : "s"
  }, ${removed} finding${removed === 1 ? "" : "s"} removed\n`;
}

const SOURCE_NOTE: Record<GitBaseSource, string> = {
  given: "",
  config: "git.base, ",
  detected: "found by default, set git.base to choose another; ",
};
