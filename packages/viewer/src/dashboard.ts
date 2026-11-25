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

// The dashboard: one row per corpus document, with its findings, its size and its place in the link
// graph, filtered and sorted by what the address asks for. Every number comes from core - findings
// from the lint run, sizes from `measureDocument` (the counts SIZE-001 checks), links from the
// corpus's `ContextGraph` and `getComponents` - and this module only selects and orders them, and
// writes them as CSV; `dashboard-article.ts` lays them out as a page. The page script asks the server for the same page again rather than filtering on its own, so
// the selection a reader sees with script is the one a link without script opens.

export const LINK_FLAGS = ["orphan", "dead-end", "cycle", "detached"] as const;
export type LinkFlag = (typeof LINK_FLAGS)[number];

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
export type NumericParam = (typeof NUMERIC_PARAMS)[number];

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
 * change gave it and took from it - which an unchanged document can have too, when a link of its
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

// One parameter read from the address: its value, or why it is refused.
type Read<T> = { ok: true; value: T } | { ok: false; message: string };

export const DEFAULT_SORT: SortKey = "path";

// The direction a column sorts in when its header is first clicked: names read A to Z, while for a
// count the interesting documents are the ones with the most.
export function defaultDirection(sort: SortKey): SortDirection {
  return sort === "path" || sort === "rules" || sort === "flags"
    ? "asc"
    : "desc";
}

const KNOWN_PARAMS = [
  "severity",
  "rule",
  "folder",
  "path",
  "flag",
  "sort",
  "dir",
  "changed",
  ...NUMERIC_PARAMS,
];

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
  const known = new Set<string>([...KNOWN_PARAMS, ...allowed]);
  for (const key of new Set(params.keys())) {
    if (!known.has(key)) {
      return { ok: false, message: `Unknown filter "${key}".` };
    }
  }
  const values = (key: string) =>
    params.getAll(key).filter((value) => value !== "");

  const severity = readSeverities(values("severity"));
  if (!severity.ok) {
    return severity;
  }
  const rule = readRules(values("rule"), source.ruleIds);
  if (!rule.ok) {
    return rule;
  }
  const flag = readFlags(values("flag"));
  if (!flag.ok) {
    return flag;
  }
  const folder = values("folder")[0] ?? "";
  if (folder !== "" && !source.folders.includes(folder)) {
    return {
      ok: false,
      message: `No folder "${folder}" holds corpus documents.`,
    };
  }
  const order = readSort(values("sort")[0], values("dir")[0]);
  if (!order.ok) {
    return order;
  }
  const changed = readChanged(values("changed")[0], source.changes);
  if (!changed.ok) {
    return changed;
  }
  const query: DashboardQuery = {
    severity: severity.value,
    rule: rule.value,
    folder,
    path: values("path")[0] ?? "",
    flag: flag.value,
    ...order.value,
    ...(changed.value ? { changed: true } : {}),
  };
  const bounds = readBounds(values);
  if (!bounds.ok) {
    return bounds;
  }
  return { ok: true, query: { ...query, ...bounds.value } };
}

// In the order `SEVERITIES` lists them, whatever order the address gave.
function readSeverities(values: readonly string[]): Read<Severity[]> {
  const severity = new Set<Severity>();
  for (const value of values) {
    if (!(SEVERITIES as readonly string[]).includes(value)) {
      return {
        ok: false,
        message: `Unknown severity "${value}": use error or warning.`,
      };
    }
    severity.add(value as Severity);
  }
  return { ok: true, value: SEVERITIES.filter((value) => severity.has(value)) };
}

function readRules(
  values: readonly string[],
  ruleIds: readonly string[],
): Read<string[]> {
  const rule = new Set<string>();
  for (const value of values) {
    // A built-in rule may be named by its alias, as in the config; it filters by its canonical id.
    const id = ruleRegistry.has(value) ? ruleRegistry.resolveId(value) : value;
    if (!ruleIds.includes(id) && !ruleRegistry.has(id)) {
      return { ok: false, message: `Unknown rule "${value}".` };
    }
    rule.add(id);
  }
  return { ok: true, value: [...rule].sort(compareStrings) };
}

// In the order `LINK_FLAGS` lists them, whatever order the address gave.
function readFlags(values: readonly string[]): Read<LinkFlag[]> {
  const flag = new Set<LinkFlag>();
  for (const value of values) {
    if (!(LINK_FLAGS as readonly string[]).includes(value)) {
      return {
        ok: false,
        message: `Unknown link filter "${value}": use ${LINK_FLAGS.join(", ")}.`,
      };
    }
    flag.add(value as LinkFlag);
  }
  return { ok: true, value: LINK_FLAGS.filter((value) => flag.has(value)) };
}

// The sort column and direction; a direction left out is the column's own first one.
function readSort(
  sortParam: string | undefined,
  dirValue: string | undefined,
): Read<{ sort: SortKey; dir: SortDirection }> {
  const sortValue = sortParam ?? DEFAULT_SORT;
  if (!(SORT_KEYS as readonly string[]).includes(sortValue)) {
    return {
      ok: false,
      message: `Unknown sort column "${sortValue}": use ${SORT_KEYS.join(", ")}.`,
    };
  }
  const sort = sortValue as SortKey;
  const dir = dirValue ?? defaultDirection(sort);
  if (dir !== "asc" && dir !== "desc") {
    return {
      ok: false,
      message: `Unknown sort direction "${dir}": use asc or desc.`,
    };
  }
  return { ok: true, value: { sort, dir } };
}

function readChanged(
  changed: string | undefined,
  changes: DashboardSource["changes"],
): Read<boolean> {
  if (changed !== undefined && changed !== "1") {
    return {
      ok: false,
      message: `"changed" takes 1, got "${changed}".`,
    };
  }
  if (changed !== undefined && changes === undefined) {
    return {
      ok: false,
      message:
        "There is no branch to compare: the Changed filter needs a git work tree and a base branch.",
    };
  }
  return { ok: true, value: changed !== undefined };
}

function readBounds(
  values: (key: string) => string[],
): Read<Partial<Record<NumericParam, number>>> {
  const bounds: Partial<Record<NumericParam, number>> = {};
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
    bounds[key] = Number(value);
  }
  return { ok: true, value: bounds };
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
  const filter = rowFilter(query, ready);
  const rows = [...source.documents.values()]
    .map((document) => candidateOf(document, source, facts))
    .filter(filter)
    .map(({ row }) => row);

  const direction = query.dir === "asc" ? 1 : -1;
  rows.sort(
    (left, right) =>
      direction * compareBy(query.sort, left, right) ||
      compareStrings(left.path, right.path),
  );
  return {
    findings: ready ? "ready" : "pending",
    corpusSize: source.documents.size,
    totals: totalsOf(rows),
    rows,
  };
}

// One document's row, with the findings it was counted from for the finding filters to judge.
function candidateOf(
  document: ParsedDocument,
  source: DashboardSource,
  facts: GraphFacts,
): Candidate {
  const ready = source.findings !== undefined;
  const messages = source.findings?.get(document.path) ?? [];
  const metrics = metricsOf(document);
  const linkedFrom = facts.linkedFrom.get(document.path) ?? 0;
  const linksTo = facts.linksTo.get(document.path) ?? 0;
  const errors = messages.filter(
    (message) => message.severity === "error",
  ).length;
  return {
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
      flags: LINK_FLAGS.filter((flag) =>
        hasFlag(flag, { path: document.path, linkedFrom, linksTo }, facts),
      ),
      ...(source.changes === undefined
        ? {}
        : { change: source.changes.get(document.path) ?? null }),
    },
  };
}

function hasFlag(
  flag: LinkFlag,
  links: { path: string; linkedFrom: number; linksTo: number },
  facts: GraphFacts,
): boolean {
  switch (flag) {
    case "orphan":
      return links.linkedFrom === 0;
    case "dead-end":
      return links.linksTo === 0;
    case "cycle":
      return facts.onCycle.has(links.path);
    case "detached":
      return !facts.mainComponent.has(links.path);
  }
}

// Whether a document's row is in the selection the query asks for.
function rowFilter(
  query: DashboardQuery,
  ready: boolean,
): (candidate: Candidate) => boolean {
  const pathNeedle = query.path.toLowerCase();
  const folderPrefix = query.folder === "" ? "" : `${query.folder}/`;
  const filterFindings =
    ready && (query.severity.length > 0 || query.rule.length > 0);
  return ({ row, messages }) => {
    if (!row.path.startsWith(folderPrefix)) {
      return false;
    }
    if (query.changed === true && row.change?.status === undefined) {
      return false;
    }
    if (pathNeedle !== "" && !row.path.toLowerCase().includes(pathNeedle)) {
      return false;
    }
    if (
      filterFindings &&
      !messages.some((message) => matchesFinding(query, message))
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
  };
}

// Severity and rule are judged on one finding together: "errors" with REF-001 is a document holding
// an error from REF-001, not one with an error from anything and a REF-001 warning.
function matchesFinding(query: DashboardQuery, message: LintMessage): boolean {
  return (
    (query.severity.length === 0 ||
      query.severity.includes(message.severity)) &&
    (query.rule.length === 0 || query.rule.includes(message.ruleId))
  );
}

function totalsOf(rows: readonly DashboardRow[]): DashboardTotals {
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
  return totals;
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
 * A cell a spreadsheet would read as a formula - one starting with `=`, `+`, `-` or `@`, or with a
 * tab or carriage return that some of them skip first - gets a leading apostrophe. A file name is
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
