import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import type {
  ContextDelta,
  ContextGraphEdge,
  DocumentContextDelta,
  DocumentMetrics,
  EagerContextChange,
  FindingsDelta,
  LintMessage,
} from "@wastech-mdlint/core";

import { documentHref, fileHref } from "./render-document.js";
import type { ReviewContext } from "./changes.js";

// The context delta laid out: in the summary of the Changes page, on each document's card, as the
// group of unchanged documents the change reaches, on the config's card, and as JSON. Everything
// shown is computed by core; this module only words it and draws it.

// A list of findings on the page stops here, with how many more there are; the JSON lists them all.
const LISTED_FINDINGS = 50;

export type FindingCounts = { errors: number; warnings: number };

export function countFindings(messages: readonly LintMessage[]): FindingCounts {
  const errors = messages.filter(
    (message) => message.severity === "error",
  ).length;
  return { errors, warnings: messages.length - errors };
}

/**
 * What the change does to findings, in words: "+1 error, +2 warnings, −3 findings", or nothing when
 * it adds and removes none. The same wording on the summary and on every row, so a reader learns it
 * once - and a test reads the page's numbers back from it.
 */
export function findingsText(delta: FindingsDelta): string | undefined {
  const added = countFindings(delta.added);
  const parts = [
    added.errors > 0 ? `+${plural(added.errors, "error")}` : undefined,
    added.warnings > 0 ? `+${plural(added.warnings, "warning")}` : undefined,
    delta.removed.length > 0
      ? `−${plural(delta.removed.length, "finding")}`
      : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(", ");
}

/** The summary's lines about the context: findings, every session's budget, and what is approximate. */
export function renderContextSummary(context: ReviewContext): Element[] {
  const { delta } = context;
  const findings = findingsText(delta.findings);
  return [
    h(
      "p.changes-findings",
      findings === undefined
        ? "Findings: none added or removed."
        : `Findings: ${findings}.`,
    ),
    ...delta.eager.map(renderEagerChange),
    ...contextNotes(context).map((note) => h("p.changes-note", note)),
  ];
}

/**
 * The approximations behind the numbers, said where the numbers are. Links to files other than
 * documents are checked against the files on disk on both sides, because a lint needs a real
 * directory to look in; and a config whose scope changed is still read through the current scope.
 */
export function contextNotes(context: ReviewContext): string[] {
  return [
    "Links to files other than documents are checked against the files as they are now on both sides, so a link to a file the change deleted still reads as fine on the side before it.",
    ...(context.delta.scopeChanged
      ? [
          "The config's include, exclude or respectGitignore changed; the side before the change is still read as the documents the current config selects.",
        ]
      : []),
    ...context.configProblems,
  ];
}

function renderEagerChange(change: EagerContextChange): Element {
  const over = change.head !== undefined && change.head > change.maxTokens;
  return h(
    over ? "p.changes-eager.changes-eager-over" : "p.changes-eager",
    eagerText(change),
  );
}

/** "CLAUDE.md eager context 8921 → 10.7k tokens (+1856, budget 10k)". */
export function eagerText(change: EagerContextChange): string {
  const budget = `budget ${tokens(change.maxTokens)}`;
  if (change.base === undefined) {
    return `${change.entrypoint} eager context, new: ${tokens(change.head ?? 0)} tokens (${budget})`;
  }
  if (change.head === undefined) {
    return `${change.entrypoint} eager context, gone: was ${tokens(change.base)} tokens (${budget})`;
  }
  return `${change.entrypoint} eager context ${tokens(change.base)} → ${tokens(change.head)} tokens (${signed(change.head - change.base, tokens)}, ${budget})`;
}

/** A changed document's context on its card: its size, its findings and its links, each when moved. */
export function renderDocumentContext(
  delta: DocumentContextDelta,
): Element | undefined {
  const size = sizeText(delta.base, delta.head);
  const parts: ElementContent[] = [
    size === undefined ? undefined : h("p.change-size", size),
    renderFindingList(delta.findings),
    renderLinkList(delta.links),
  ].filter((part): part is Element => part !== undefined);
  return parts.length === 0 ? undefined : h("div.change-context", parts);
}

function sizeText(
  base: DocumentMetrics | undefined,
  head: DocumentMetrics | undefined,
): string | undefined {
  if (base === undefined && head === undefined) {
    return undefined;
  }
  const measure = (
    pick: (metrics: DocumentMetrics) => number,
    unit: string,
    format: (value: number) => string,
  ) => {
    if (base === undefined) {
      return `${format(pick(head!))} ${unit}`;
    }
    if (head === undefined) {
      return `was ${format(pick(base))} ${unit}`;
    }
    // Compared and subtracted as shown, so a few bytes that round to the same tenth of a KB read as
    // no change, and the difference is the difference of the two numbers on screen.
    const before = pick(base);
    const after = pick(head);
    return before === after
      ? `${format(after)} ${unit}`
      : `${format(before)} → ${format(after)} ${unit} (${signed(after - before, format)})`;
  };
  return [
    measure((metrics) => metrics.tokens, "tokens", String),
    measure((metrics) => metrics.lines, "lines", String),
    measure(
      (metrics) => tenthsOfKilobytes(metrics.bytes),
      "KB",
      (value) => value.toFixed(1),
    ),
  ].join(" · ");
}

function renderFindingList(delta: FindingsDelta): Element | undefined {
  if (delta.added.length === 0 && delta.removed.length === 0) {
    return undefined;
  }
  const entries = [
    ...delta.added.map((message) => ({ message, sign: "added" as const })),
    ...delta.removed.map((message) => ({ message, sign: "removed" as const })),
  ];
  return h("div.change-findings-list", [
    h("p.change-context-title", `Findings: ${findingsText(delta)}`),
    h(
      "ul",
      entries
        .slice(0, LISTED_FINDINGS)
        .map(({ message, sign }) =>
          h(`li.change-finding.change-finding-${sign}`, [
            h("span.change-finding-sign", sign === "added" ? "+" : "−"),
            " ",
            findingLine(message),
          ]),
        ),
    ),
    entries.length > LISTED_FINDINGS
      ? h(
          "p.change-more",
          `And ${entries.length - LISTED_FINDINGS} more, listed in /api/changes.`,
        )
      : undefined,
  ]);
}

function findingLine(message: LintMessage): (Element | string)[] {
  return [
    h(`span.severity-${message.severity}`, message.severity),
    " ",
    h("code", message.ruleId),
    message.line > 0 ? ` line ${message.line}: ` : ": ",
    message.message,
  ];
}

function renderLinkList(links: {
  added: ContextGraphEdge[];
  removed: ContextGraphEdge[];
}): Element | undefined {
  if (links.added.length === 0 && links.removed.length === 0) {
    return undefined;
  }
  const row = (edge: ContextGraphEdge, sign: "added" | "removed") =>
    h(`li.change-link.change-link-${sign}`, [
      h("span.change-finding-sign", sign === "added" ? "+" : "−"),
      ` ${edge.type} → `,
      h("code", edge.to),
    ]);
  return h("div.change-links-list", [
    h(
      "p.change-context-title",
      `Links: ${[
        links.added.length > 0 ? `+${links.added.length}` : undefined,
        links.removed.length > 0 ? `−${links.removed.length}` : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(", ")}`,
    ),
    h("ul", [
      ...links.added.map((edge) => row(edge, "added")),
      ...links.removed.map((edge) => row(edge, "removed")),
    ]),
  ]);
}

/**
 * The unchanged documents the change reaches: those with findings they did not have, those linking
 * into code lines that moved under them, and - folded, since a much-linked document would flood the
 * page - those linking to a changed document.
 */
export function renderAffected(delta: ContextDelta): Element | undefined {
  const { findings, codeLinks, linking } = delta.affected;
  if (findings.length === 0 && codeLinks.length === 0 && linking.length === 0) {
    return undefined;
  }
  return h("section.changes-affected", { ariaLabel: "Affected documents" }, [
    h("h2", "Affected documents"),
    h(
      "p.changes-note",
      "Documents the change left as they were, which it still reaches.",
    ),
    findings.length === 0
      ? undefined
      : h("div.affected-group", [
          h("h3", "With new findings"),
          h(
            "ul.affected-findings",
            findings.map((entry) =>
              h("li", [
                h("a", { href: documentHref(entry.path) }, entry.path),
                h(
                  "ul",
                  entry.added
                    .slice(0, LISTED_FINDINGS)
                    .map((message) => h("li", findingLine(message))),
                ),
              ]),
            ),
          ),
        ]),
    codeLinks.length === 0
      ? undefined
      : h("div.affected-group", [
          h("h3", "Linking into changed code lines"),
          h(
            "ul.affected-code",
            codeLinks.map((link) => {
              const fragment =
                link.start === link.end
                  ? `L${link.start}`
                  : `L${link.start}-L${link.end}`;
              return h("li", [
                h("a", { href: documentHref(link.from) }, link.from),
                ` line ${link.line} → `,
                h(
                  "a",
                  { href: `${fileHref(link.target)}#${fragment}` },
                  `${link.target}#${fragment}`,
                ),
              ]);
            }),
          ),
        ]),
    linking.length === 0
      ? undefined
      : h("details.affected-linking", [
          h(
            "summary",
            `${plural(linking.length, "document")} link to changed documents`,
          ),
          h(
            "ul",
            linking.map((entry) =>
              h("li", [
                h("a", { href: documentHref(entry.path) }, entry.path),
                " → ",
                ...entry.targets.flatMap((target, index) => [
                  index === 0 ? "" : ", ",
                  h("code", target),
                ]),
              ]),
            ),
          ),
        ]),
  ]);
}

/** On the config's card: what the config change alone does to findings over the head's documents. */
export function renderConfigOnly(delta: FindingsDelta | undefined): Element {
  if (delta === undefined) {
    return h(
      "p.change-note",
      "Both sides are linted with the same rules, so the config change alone changes no finding.",
    );
  }
  const text = findingsText(delta);
  return h("div.change-context", [
    h(
      "p.change-context-title",
      text === undefined
        ? "The config change alone adds and removes no finding over the current documents."
        : `The config change alone, over the current documents: ${text}`,
    ),
    text === undefined ? undefined : renderFindingList(delta),
  ]);
}

/** A finding as JSON carries it: its place and its words, without the rule's internal data. */
export function findingPayload(message: LintMessage): unknown {
  return {
    filePath: message.filePath,
    line: message.line,
    ruleId: message.ruleId,
    severity: message.severity,
    message: message.message,
  };
}

export function findingsPayload(delta: FindingsDelta): unknown {
  return {
    added: delta.added.map(findingPayload),
    removed: delta.removed.map(findingPayload),
  };
}

/** One changed document's context, as JSON. */
export function documentContextPayload(delta: DocumentContextDelta): unknown {
  return {
    findings: findingsPayload(delta.findings),
    size: { base: delta.base ?? null, head: delta.head ?? null },
    links: {
      added: delta.links.added.map(edgePayload),
      removed: delta.links.removed.map(edgePayload),
    },
  };
}

function edgePayload(edge: ContextGraphEdge): unknown {
  return { from: edge.from, to: edge.to, type: edge.type };
}

/** The whole review's context, as JSON, beside what `/api/changes` already lists. */
export function contextPayload(context: ReviewContext): unknown {
  const { delta } = context;
  return {
    findings: {
      added: countFindings(delta.findings.added),
      removed: countFindings(delta.findings.removed),
    },
    eagerContext: delta.eager,
    affected: {
      findings: delta.affected.findings.map((entry) => ({
        path: entry.path,
        added: entry.added.map(findingPayload),
      })),
      codeLinks: delta.affected.codeLinks,
      linking: delta.affected.linking,
    },
    notes: contextNotes(context),
  };
}

// Token counts as a reader compares them with a budget: exact below ten thousand, then in thousands
// to one decimal, cut down rather than rounded, so a total just under its budget never reads as the
// budget itself (9,994 would round to "10k"). Written out by hand rather than with a locale's number
// format, which would differ between machines. Only ever handed a count of zero or more.
function tokens(value: number): string {
  if (value < 10_000) {
    return String(value);
  }
  return `${(Math.floor(value / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
}

// KB to the tenth shown, as a number, so two sizes are compared and subtracted at that precision.
function tenthsOfKilobytes(bytes: number): number {
  return Math.round(bytes / 102.4) / 10;
}

function signed(value: number, format: (value: number) => string): string {
  return value < 0 ? `−${format(-value)}` : `+${format(value)}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
