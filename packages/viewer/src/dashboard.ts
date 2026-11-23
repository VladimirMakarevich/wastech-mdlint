import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import {
  compareStrings,
  getComponents,
  type GitChange,
  measureDocument,
  ruleRegistry,
  type ContextGraph,
  type DocumentMetrics,
  type LintMessage,
  type ParsedDocument,
  type Severity,
} from "@wastech-mdlint/core";

import { documentHref } from "./render-document.js";

// The dashboard: one row per corpus document, with its findings, its size and its place in the link
// graph, filtered and sorted by what the address asks for. Every number comes from core — findings
// from the lint run, sizes from `measureDocument` (the counts SIZE-001 checks), links from the
// corpus's `ContextGraph` and `getComponents` — and this module only selects, orders and lays them
// out. The page script asks the server for the same page again rather than filtering on its own, so
// the selection a reader sees with script is the one a link without script opens.

export const LINK_FLAGS = ["orphan", "dead-end", "cycle", "detached"] as const;
export type LinkFlag = (typeof LINK_FLAGS)[number];

const LINK_FLAG_LABELS: Record<LinkFlag, string> = {
  orphan: "Orphan: nothing links here",
  "dead-end": "Dead end: links nowhere",
  cycle: "In a link cycle",
  detached: "Detached: outside the main group",
};

const LINK_FLAG_NAMES: Record<LinkFlag, string> = {
  orphan: "orphan",
  "dead-end": "dead end",
  cycle: "cycle",
  detached: "detached",
};

const SEVERITIES = ["error", "warning"] as const satisfies readonly Severity[];

export const SORT_KEYS = [
  "path",
  "errors",
  "warnings",
  "rules",
  "bytes",
  "lines",
  "tokens",
  "linkedFrom",
  "linksTo",
  "flags",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

const NUMERIC_PARAMS = [
  "minKb",
  "maxKb",
  "minLines",
  "maxLines",
  "minTokens",
  "maxTokens",
] as const;
type NumericParam = (typeof NUMERIC_PARAMS)[number];

// Field names are the query parameter names, so the query the JSON echoes back is the one the
// address carries.
export type DashboardQuery = {
  severity: Severity[];
  rule: string[];
  folder: string;
  path: string;
  flag: LinkFlag[];
  sort: SortKey;
  dir: SortDirection;
  // Only the documents the branch changed; set by `changed=1`.
  changed?: boolean;
} & Partial<Record<NumericParam, number>>;

/**
 * What the branch did to a document: its letter, when the branch changed it, and the findings the
 * change gave it and took from it — which an unchanged document can have too, when a link of its
 * broke.
 */
export type DashboardChange = {
  status?: GitChange["status"];
  findingsAdded: number;
  findingsRemoved: number;
};

export type DashboardRow = {
  path: string;
  // `null` until the first lint finishes: unknown, which is not the same as clean.
  errors: number | null;
  warnings: number | null;
  // The rules with at least one finding in the document, in code-point order.
  rules: string[];
  bytes: number;
  lines: number;
  tokens: number;
  // Distinct documents, every kind of link counted once per pair, as the backlinks on a page count.
  linkedFrom: number;
  linksTo: number;
  flags: LinkFlag[];
  // Present only in a review of a branch: what it did to the document, `null` for nothing.
  change?: DashboardChange | null;
};

export type DashboardTotals = {
  documents: number;
  errors: number;
  warnings: number;
  bytes: number;
  lines: number;
  tokens: number;
};

export type DashboardResult = {
  // Whether findings are in yet; until they are, the finding filters select nothing out.
  findings: "pending" | "ready";
  corpusSize: number;
  totals: DashboardTotals;
  rows: DashboardRow[];
};

export type DashboardSource = {
  documents: ReadonlyMap<string, ParsedDocument>;
  graph: ContextGraph;
  // Per file; `undefined` until the first lint finishes.
  findings: ReadonlyMap<string, readonly LintMessage[]> | undefined;
  // The rules a reader can filter by: the configured ones and any other id a finding carries.
  ruleIds: readonly string[];
  folders: readonly string[];
  // By path, in a review of a branch; `undefined` without one, and then the dashboard has no
  // Branch column and refuses the Changed filter.
  changes?: ReadonlyMap<string, DashboardChange>;
};

export type ParsedDashboardQuery =
  | { ok: true; query: DashboardQuery }
  | { ok: false; message: string };

const DEFAULT_SORT: SortKey = "path";

// The direction a column sorts in when its header is first clicked: names read A to Z, while for a
// count the interesting documents are the ones with the most.
function defaultDirection(sort: SortKey): SortDirection {
  return sort === "path" || sort === "rules" || sort === "flags"
    ? "asc"
    : "desc";
}

/**
 * Read a dashboard query from the address.
 *
 * Strict, the way the config is: an unknown parameter, value or rule is refused with a message
 * rather than dropped, because a filter that silently does nothing reads as "no document matches".
 * An empty value is "not set", since that is what a GET form sends for an empty field. `allowed` names
 * extra parameters a caller handles itself, such as the API's `format`.
 */
export function parseDashboardQuery(
  params: URLSearchParams,
  source: Pick<DashboardSource, "ruleIds" | "folders" | "changes">,
  allowed: readonly string[] = [],
): ParsedDashboardQuery {
  const known = new Set<string>([
    "severity",
    "rule",
    "folder",
    "path",
    "flag",
    "sort",
    "dir",
    "changed",
    ...NUMERIC_PARAMS,
    ...allowed,
  ]);
  for (const key of new Set(params.keys())) {
    if (!known.has(key)) {
      return { ok: false, message: `Unknown filter "${key}".` };
    }
  }
  const values = (key: string) =>
    params.getAll(key).filter((value) => value !== "");

  const severity = new Set<Severity>();
  for (const value of values("severity")) {
    if (!(SEVERITIES as readonly string[]).includes(value)) {
      return {
        ok: false,
        message: `Unknown severity "${value}": use error or warning.`,
      };
    }
    severity.add(value as Severity);
  }

  const rule = new Set<string>();
  for (const value of values("rule")) {
    // A built-in rule may be named by its alias, as in the config; it filters by its canonical id.
    const id = ruleRegistry.has(value) ? ruleRegistry.resolveId(value) : value;
    if (!source.ruleIds.includes(id) && !ruleRegistry.has(id)) {
      return { ok: false, message: `Unknown rule "${value}".` };
    }
    rule.add(id);
  }

  const flag = new Set<LinkFlag>();
  for (const value of values("flag")) {
    if (!(LINK_FLAGS as readonly string[]).includes(value)) {
      return {
        ok: false,
        message: `Unknown link filter "${value}": use ${LINK_FLAGS.join(", ")}.`,
      };
    }
    flag.add(value as LinkFlag);
  }

  const folder = values("folder")[0] ?? "";
  if (folder !== "" && !source.folders.includes(folder)) {
    return {
      ok: false,
      message: `No folder "${folder}" holds corpus documents.`,
    };
  }

  const sortValue = values("sort")[0] ?? DEFAULT_SORT;
  if (!(SORT_KEYS as readonly string[]).includes(sortValue)) {
    return {
      ok: false,
      message: `Unknown sort column "${sortValue}": use ${SORT_KEYS.join(", ")}.`,
    };
  }
  const sort = sortValue as SortKey;
  const dirValue = values("dir")[0] ?? defaultDirection(sort);
  if (dirValue !== "asc" && dirValue !== "desc") {
    return {
      ok: false,
      message: `Unknown sort direction "${dirValue}": use asc or desc.`,
    };
  }

  const changed = values("changed")[0];
  if (changed !== undefined && changed !== "1") {
    return {
      ok: false,
      message: `"changed" takes 1, got "${changed}".`,
    };
  }
  if (changed !== undefined && source.changes === undefined) {
    return {
      ok: false,
      message:
        "There is no branch to compare: the Changed filter needs a git work tree and a base branch.",
    };
  }

  const query: DashboardQuery = {
    severity: SEVERITIES.filter((value) => severity.has(value)),
    rule: [...rule].sort(compareStrings),
    folder,
    path: values("path")[0] ?? "",
    flag: LINK_FLAGS.filter((value) => flag.has(value)),
    sort,
    dir: dirValue,
    ...(changed === undefined ? {} : { changed: true }),
  };
  for (const key of NUMERIC_PARAMS) {
    const value = values(key)[0];
    if (value === undefined) {
      continue;
    }
    // Digits with an optional fraction only: `Number` would also take "", " 2 ", "1e3" and "0x10",
    // and a negative bound is a typo rather than a filter.
    if (!/^\d+(\.\d+)?$/.test(value.trim())) {
      return {
        ok: false,
        message: `"${key}" must be a number of zero or more, got "${value}".`,
      };
    }
    query[key] = Number(value);
  }
  return { ok: true, query };
}

/** The query as URL parameters, in a fixed order and without the defaults, for links to share. */
export function dashboardSearchParams(query: DashboardQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const value of query.severity) {
    params.append("severity", value);
  }
  for (const value of query.rule) {
    params.append("rule", value);
  }
  for (const value of query.flag) {
    params.append("flag", value);
  }
  if (query.folder !== "") {
    params.set("folder", query.folder);
  }
  if (query.path !== "") {
    params.set("path", query.path);
  }
  if (query.changed === true) {
    params.set("changed", "1");
  }
  for (const key of NUMERIC_PARAMS) {
    const value = query[key];
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  if (
    query.sort !== DEFAULT_SORT ||
    query.dir !== defaultDirection(query.sort)
  ) {
    params.set("sort", query.sort);
    params.set("dir", query.dir);
  }
  return params;
}

export function dashboardHref(query: DashboardQuery): string {
  const search = dashboardSearchParams(query).toString();
  return search === "" ? "/dashboard" : `/dashboard?${search}`;
}

type GraphFacts = {
  linkedFrom: Map<string, number>;
  linksTo: Map<string, number>;
  onCycle: Set<string>;
  mainComponent: Set<string>;
};

// The graph and each document object are replaced, never mutated, when the corpus changes, so these
// caches are invalidated by identity alone. The page script asks for the dashboard on every
// keystroke, and measuring six hundred documents each time would be the whole cost of a request.
const metricsCache = new WeakMap<ParsedDocument, DocumentMetrics>();
const graphCache = new WeakMap<ContextGraph, GraphFacts>();

function metricsOf(document: ParsedDocument): DocumentMetrics {
  let metrics = metricsCache.get(document);
  if (metrics === undefined) {
    metrics = measureDocument(document.content);
    metricsCache.set(document, metrics);
  }
  return metrics;
}

function graphFacts(graph: ContextGraph): GraphFacts {
  let facts = graphCache.get(graph);
  if (facts !== undefined) {
    return facts;
  }
  const sources = new Map<string, Set<string>>();
  const targets = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    let from = sources.get(edge.to);
    if (from === undefined) {
      sources.set(edge.to, (from = new Set()));
    }
    from.add(edge.from);
    let to = targets.get(edge.from);
    if (to === undefined) {
      targets.set(edge.from, (to = new Set()));
    }
    to.add(edge.to);
  }
  // `getComponents` lists the largest group first, ties broken by path, so "the main group" is one
  // well-defined set even when two groups are the same size.
  const [main = []] = getComponents(graph);
  facts = {
    linkedFrom: new Map([...sources].map(([path, set]) => [path, set.size])),
    linksTo: new Map([...targets].map(([path, set]) => [path, set.size])),
    // The cycles core reports, the ones GRP-001 judges, so a document flagged here is one the rule
    // would name.
    onCycle: new Set(graph.cycles.flat()),
    mainComponent: new Set(main),
  };
  graphCache.set(graph, facts);
  return facts;
}

type Candidate = { row: DashboardRow; messages: readonly LintMessage[] };

export function buildDashboard(
  source: DashboardSource,
  query: DashboardQuery,
): DashboardResult {
  const facts = graphFacts(source.graph);
  const ready = source.findings !== undefined;
  const pathNeedle = query.path.toLowerCase();
  const folderPrefix = query.folder === "" ? "" : `${query.folder}/`;
  const filterFindings =
    ready && (query.severity.length > 0 || query.rule.length > 0);

  const candidates: Candidate[] = [];
  for (const document of source.documents.values()) {
    const messages = source.findings?.get(document.path) ?? [];
    const metrics = metricsOf(document);
    const linkedFrom = facts.linkedFrom.get(document.path) ?? 0;
    const linksTo = facts.linksTo.get(document.path) ?? 0;
    const flags = LINK_FLAGS.filter((flag) =>
      flag === "orphan"
        ? linkedFrom === 0
        : flag === "dead-end"
          ? linksTo === 0
          : flag === "cycle"
            ? facts.onCycle.has(document.path)
            : !facts.mainComponent.has(document.path),
    );
    const errors = messages.filter(
      (message) => message.severity === "error",
    ).length;
    candidates.push({
      messages,
      row: {
        path: document.path,
        errors: ready ? errors : null,
        warnings: ready ? messages.length - errors : null,
        rules: [...new Set(messages.map((message) => message.ruleId))].sort(
          compareStrings,
        ),
        bytes: metrics.bytes,
        lines: metrics.lines,
        tokens: metrics.tokens,
        linkedFrom,
        linksTo,
        flags,
        ...(source.changes === undefined
          ? {}
          : { change: source.changes.get(document.path) ?? null }),
      },
    });
  }

  const rows = candidates
    .filter(({ row, messages }) => {
      if (!row.path.startsWith(folderPrefix)) {
        return false;
      }
      if (query.changed === true && row.change?.status === undefined) {
        return false;
      }
      if (pathNeedle !== "" && !row.path.toLowerCase().includes(pathNeedle)) {
        return false;
      }
      // Severity and rule are judged on one finding together: "errors" with REF-001 is a document
      // holding an error from REF-001, not one with an error from anything and a REF-001 warning.
      if (
        filterFindings &&
        !messages.some(
          (message) =>
            (query.severity.length === 0 ||
              query.severity.includes(message.severity)) &&
            (query.rule.length === 0 || query.rule.includes(message.ruleId)),
        )
      ) {
        return false;
      }
      if (
        query.flag.length > 0 &&
        !query.flag.some((flag) => row.flags.includes(flag))
      ) {
        return false;
      }
      // Both bounds inclusive; a kilobyte is 1024 bytes, the unit SIZE-001's byte budgets divide into.
      return (
        within(row.bytes, query.minKb, query.maxKb, 1024) &&
        within(row.lines, query.minLines, query.maxLines, 1) &&
        within(row.tokens, query.minTokens, query.maxTokens, 1)
      );
    })
    .map(({ row }) => row);

  const direction = query.dir === "asc" ? 1 : -1;
  rows.sort(
    (left, right) =>
      direction * compareBy(query.sort, left, right) ||
      compareStrings(left.path, right.path),
  );

  const totals: DashboardTotals = {
    documents: rows.length,
    errors: 0,
    warnings: 0,
    bytes: 0,
    lines: 0,
    tokens: 0,
  };
  for (const row of rows) {
    totals.errors += row.errors ?? 0;
    totals.warnings += row.warnings ?? 0;
    totals.bytes += row.bytes;
    totals.lines += row.lines;
    totals.tokens += row.tokens;
  }
  return {
    findings: ready ? "ready" : "pending",
    corpusSize: source.documents.size,
    totals,
    rows,
  };
}

function within(
  value: number,
  min: number | undefined,
  max: number | undefined,
  unit: number,
): boolean {
  return (
    (min === undefined || value >= min * unit) &&
    (max === undefined || value <= max * unit)
  );
}

function compareBy(
  sort: SortKey,
  left: DashboardRow,
  right: DashboardRow,
): number {
  switch (sort) {
    case "path":
      return compareStrings(left.path, right.path);
    case "rules":
      return compareStrings(left.rules.join(" "), right.rules.join(" "));
    case "flags":
      return compareStrings(left.flags.join(" "), right.flags.join(" "));
    case "errors":
    case "warnings":
      return (left[sort] ?? 0) - (right[sort] ?? 0);
    default:
      return left[sort] - right[sort];
  }
}

const CSV_COLUMNS = [
  "path",
  "errors",
  "warnings",
  "rules",
  "bytes",
  "lines",
  "tokens",
  "linkedFrom",
  "linksTo",
  "flags",
] as const;

const BRANCH_CSV_COLUMNS = ["change", "findingsAdded", "findingsRemoved"];

/**
 * The selection as CSV: RFC 4180 quoting and CRLF rows, sizes in bytes as measured.
 *
 * A cell a spreadsheet would read as a formula — one starting with `=`, `+`, `-` or `@`, or with a
 * tab or carriage return that some of them skip first — gets a leading apostrophe. A file name is
 * the repository's to choose, and opening an export must not run what someone named a file.
 */
export function dashboardCsv(result: DashboardResult): string {
  // The branch's columns only in a review of one, where every row carries its change.
  const branch = result.rows.some((row) => row.change !== undefined);
  const lines = [
    [...CSV_COLUMNS, ...(branch ? BRANCH_CSV_COLUMNS : [])].join(","),
  ];
  for (const row of result.rows) {
    lines.push(
      [
        csvText(row.path),
        row.errors ?? "",
        row.warnings ?? "",
        csvText(row.rules.join(" ")),
        row.bytes,
        row.lines,
        row.tokens,
        row.linkedFrom,
        row.linksTo,
        csvText(row.flags.join(" ")),
        ...(branch
          ? [
              row.change?.status ?? "",
              row.change?.findingsAdded ?? 0,
              row.change?.findingsRemoved ?? 0,
            ]
          : []),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvText(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export type DashboardPage = {
  // What the address asked for, as written, so the form shows it back even when it was refused.
  params: URLSearchParams;
  source: DashboardSource;
} & (
  | { ok: true; query: DashboardQuery; result: DashboardResult }
  | { ok: false; message: string }
);

export function renderDashboardArticle(page: DashboardPage): ElementContent[] {
  return [
    h("h1", "Dashboard"),
    renderFilters(page.params, page.source, page.ok ? page.query : undefined),
    h(
      "p.dashboard-summary",
      { role: "status" },
      page.ok ? summaryText(page.result) : "These filters cannot be applied.",
    ),
    h(
      "div.dashboard-results",
      page.ok
        ? renderResults(
            page.query,
            page.result,
            page.source.changes !== undefined,
          )
        : [h("p.dashboard-error", page.message)],
    ),
  ];
}

function renderFilters(
  params: URLSearchParams,
  source: DashboardSource,
  query: DashboardQuery | undefined,
): Element {
  const all = (key: string) => params.getAll(key);
  const first = (key: string) => params.get(key) ?? "";
  const checkbox = (
    name: string,
    value: string,
    label: ElementContent | string,
  ) =>
    h("label.filter-check", [
      h("input", {
        type: "checkbox",
        name,
        value,
        checked: all(name).includes(value),
      }),
      " ",
      label,
    ]);
  const range = (
    label: string,
    min: NumericParam,
    max: NumericParam,
    step: string,
  ) =>
    h("div.filter-range", [
      h("span.filter-range-label", label),
      h("label", [
        h("span.visually-hidden", `${label} from`),
        h("input", {
          type: "number",
          name: min,
          value: first(min),
          min: "0",
          step,
          inputMode: "decimal",
          placeholder: "from",
        }),
      ]),
      h("span.filter-range-dash", { ariaHidden: "true" }, "–"),
      h("label", [
        h("span.visually-hidden", `${label} to`),
        h("input", {
          type: "number",
          name: max,
          value: first(max),
          min: "0",
          step,
          inputMode: "decimal",
          placeholder: "to",
        }),
      ]),
    ]);
  const sort = query?.sort ?? first("sort");
  const dir = query?.dir ?? first("dir");
  const sortIsDefault =
    query === undefined
      ? sort === "" && dir === ""
      : query.sort === DEFAULT_SORT &&
        query.dir === defaultDirection(query.sort);

  return h(
    "form.dashboard-filters",
    { action: "/dashboard", method: "get", ariaLabel: "Filters" },
    [
      h("fieldset.filter-group", [
        h("legend", "Findings"),
        h("div.filter-options", [
          checkbox("severity", "error", "Errors"),
          checkbox("severity", "warning", "Warnings"),
        ]),
        source.ruleIds.length === 0
          ? undefined
          : h(
              "div.filter-options.filter-rules",
              source.ruleIds.map((id) => checkbox("rule", id, h("code", id))),
            ),
      ]),
      h("fieldset.filter-group", [
        h("legend", "Size"),
        range("KB", "minKb", "maxKb", "any"),
        range("Lines", "minLines", "maxLines", "1"),
        range("Tokens", "minTokens", "maxTokens", "1"),
      ]),
      h("fieldset.filter-group", [
        h("legend", "Graph"),
        h(
          "div.filter-options.filter-options-column",
          LINK_FLAGS.map((flag) =>
            checkbox("flag", flag, LINK_FLAG_LABELS[flag]),
          ),
        ),
      ]),
      h("fieldset.filter-group", [
        h("legend", "Where"),
        h("label.filter-field", [
          "Folder",
          h("select", { name: "folder" }, [
            h(
              "option",
              { value: "", selected: first("folder") === "" },
              "All documents",
            ),
            ...source.folders.map((folder) =>
              h(
                "option",
                { value: folder, selected: first("folder") === folder },
                folder,
              ),
            ),
          ]),
        ]),
        source.changes === undefined
          ? undefined
          : checkbox("changed", "1", "Changed in this branch"),
        h("label.filter-field", [
          "Path contains",
          h("input", {
            type: "search",
            name: "path",
            value: first("path"),
            autoComplete: "off",
            spellCheck: false,
          }),
        ]),
      ]),
      // Kept across a filter change, so narrowing the list does not also undo the reader's sort.
      sortIsDefault
        ? undefined
        : h("input", { type: "hidden", name: "sort", value: sort }),
      sortIsDefault
        ? undefined
        : h("input", { type: "hidden", name: "dir", value: dir }),
      h("div.filter-actions", [
        h("button", { type: "submit" }, "Apply"),
        h("a", { href: "/dashboard" }, "Reset"),
      ]),
    ],
  );
}

function summaryText(result: DashboardResult): string {
  const parts = [
    `${result.totals.documents} of ${plural(result.corpusSize, "document")}`,
  ];
  if (result.findings === "ready") {
    parts.push(
      plural(result.totals.errors, "error"),
      plural(result.totals.warnings, "warning"),
    );
  }
  parts.push(
    `${kilobytes(result.totals.bytes)} KB`,
    plural(result.totals.lines, "line"),
  );
  return parts.join(" · ");
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "path", label: "Document", numeric: false },
  { key: "errors", label: "Errors", numeric: true },
  { key: "warnings", label: "Warnings", numeric: true },
  { key: "rules", label: "Rules", numeric: false },
  { key: "bytes", label: "KB", numeric: true },
  { key: "lines", label: "Lines", numeric: true },
  { key: "tokens", label: "Tokens", numeric: true },
  { key: "linkedFrom", label: "Linked from", numeric: true },
  { key: "linksTo", label: "Links to", numeric: true },
  { key: "flags", label: "Graph", numeric: false },
];

function renderResults(
  query: DashboardQuery,
  result: DashboardResult,
  branch: boolean,
): (ElementContent | undefined)[] {
  const sortHeader = (column: (typeof COLUMNS)[number]): Element => {
    const active = query.sort === column.key;
    const dir: SortDirection = active
      ? query.dir === "asc"
        ? "desc"
        : "asc"
      : defaultDirection(column.key);
    return h(
      column.numeric ? "th.is-numeric" : "th",
      {
        scope: "col",
        ariaSort: active
          ? query.dir === "asc"
            ? "ascending"
            : "descending"
          : undefined,
      },
      h(
        "a.dashboard-sort",
        { href: dashboardHref({ ...query, sort: column.key, dir }) },
        column.label,
      ),
    );
  };
  const exportParams = (format: string) => {
    const params = dashboardSearchParams(query);
    params.set("format", format);
    return `/api/dashboard?${params.toString()}`;
  };
  return [
    h("p.dashboard-export", [
      "Download this selection: ",
      h("a", { href: exportParams("csv"), download: "" }, "CSV"),
      " · ",
      h("a", { href: exportParams("json"), download: "" }, "JSON"),
    ]),
    result.findings === "pending" &&
    (query.severity.length > 0 || query.rule.length > 0)
      ? h(
          "p.dashboard-notice",
          "The linter is still checking the corpus, so the finding filters are not applied yet.",
        )
      : undefined,
    h("div.dashboard-table-wrap", [
      h("table.dashboard-table", [
        h("thead", [
          h("tr", [
            ...COLUMNS.slice(0, 1).map(sortHeader),
            branch
              ? h(
                  "th",
                  {
                    scope: "col",
                    title: "What this branch did to the document",
                  },
                  "Branch",
                )
              : undefined,
            ...COLUMNS.slice(1).map(sortHeader),
          ]),
        ]),
        h(
          "tbody",
          result.rows.length === 0
            ? [
                h("tr", [
                  h(
                    "td.dashboard-empty",
                    { colSpan: COLUMNS.length + (branch ? 1 : 0) },
                    "No documents match these filters.",
                  ),
                ]),
              ]
            : result.rows.map((row) => renderRow(row)),
        ),
      ]),
    ]),
  ];
}

function renderRow(row: DashboardRow): Element {
  const count = (value: number | null, className: string) =>
    h(
      value !== null && value > 0
        ? `td.is-numeric.${className}`
        : "td.is-numeric",
      value === null ? "—" : String(value),
    );
  return h("tr", [
    h("td.dashboard-path", h("a", { href: documentHref(row.path) }, row.path)),
    row.change === undefined ? undefined : renderChange(row.change),
    count(row.errors, "has-errors"),
    count(row.warnings, "has-warnings"),
    h("td.dashboard-rules", [
      ...row.rules.flatMap((id, index) =>
        index === 0 ? [h("code", id)] : [" ", h("code", id)],
      ),
      // Copies a prompt that answers every finding in the document; its menu is the page script's,
      // so it is hidden without it.
      row.rules.length === 0
        ? undefined
        : h(
            "button.prompt-menu",
            {
              type: "button",
              hidden: true,
              dataPath: row.path,
              title: "Copy a prompt that answers this document's findings",
            },
            "Prompt",
          ),
    ]),
    h("td.is-numeric", { title: `${row.bytes} bytes` }, kilobytes(row.bytes)),
    h("td.is-numeric", String(row.lines)),
    h("td.is-numeric", String(row.tokens)),
    h("td.is-numeric", String(row.linkedFrom)),
    h("td.is-numeric", String(row.linksTo)),
    h(
      "td.dashboard-flags",
      row.flags.map((flag) => LINK_FLAG_NAMES[flag]).join(", "),
    ),
  ]);
}

// The branch's column: the document's letter, then the findings it gained and lost, as the Changes
// page words them.
function renderChange(change: DashboardChange | null): Element {
  if (change === null) {
    return h("td.dashboard-change");
  }
  const findings = [
    change.findingsAdded > 0 ? `+${change.findingsAdded}` : undefined,
    change.findingsRemoved > 0 ? `−${change.findingsRemoved}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
  return h("td.dashboard-change", [
    change.status === undefined
      ? undefined
      : h(`span.change-status.change-status-${change.status}`, change.status),
    findings === ""
      ? undefined
      : h(
          "span.change-findings",
          { title: "Findings this branch added and removed" },
          findings,
        ),
  ]);
}

function kilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
