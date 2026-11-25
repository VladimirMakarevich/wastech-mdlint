import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import {
  type DashboardChange,
  dashboardHref,
  type DashboardQuery,
  type DashboardResult,
  type DashboardRow,
  dashboardSearchParams,
  type DashboardSource,
  DEFAULT_SORT,
  defaultDirection,
  LINK_FLAGS,
  type LinkFlag,
  type NumericParam,
  type SortDirection,
  type SortKey,
} from "./dashboard.js";
import { FIRST_SCREEN_ID } from "./page.js";
import { documentHref } from "./render-document.js";

// The dashboard page's article: the filter form, the summary line and the table of rows `dashboard.ts`
// selected and ordered. Nothing here filters or counts; it lays out what it is given.

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

// The form's controls, each showing back the value the address carries, as written.
class FilterControls {
  constructor(private readonly params: URLSearchParams) {}

  first(key: string): string {
    return this.params.get(key) ?? "";
  }

  checkbox(
    name: string,
    value: string,
    label: ElementContent | string,
  ): Element {
    return h("label.filter-check", [
      h("input", {
        type: "checkbox",
        name,
        value,
        checked: this.params.getAll(name).includes(value),
      }),
      " ",
      label,
    ]);
  }

  range(
    label: string,
    min: NumericParam,
    max: NumericParam,
    step: string,
  ): Element {
    return h("div.filter-range", [
      h("span.filter-range-label", label),
      h("label", [
        h("span.visually-hidden", `${label} from`),
        this.bound(min, step, "from"),
      ]),
      h("span.filter-range-dash", { ariaHidden: "true" }, "–"),
      h("label", [
        h("span.visually-hidden", `${label} to`),
        this.bound(max, step, "to"),
      ]),
    ]);
  }

  private bound(
    name: NumericParam,
    step: string,
    placeholder: string,
  ): Element {
    return h("input", {
      type: "number",
      name,
      value: this.first(name),
      min: "0",
      step,
      inputMode: "decimal",
      placeholder,
    });
  }
}

function renderFilters(
  params: URLSearchParams,
  source: DashboardSource,
  query: DashboardQuery | undefined,
): Element {
  const controls = new FilterControls(params);
  return h(
    "form.dashboard-filters",
    { action: "/dashboard", method: "get", ariaLabel: "Filters" },
    [
      h("fieldset.filter-group", [
        h("legend", "Findings"),
        h("div.filter-options", [
          controls.checkbox("severity", "error", "Errors"),
          controls.checkbox("severity", "warning", "Warnings"),
        ]),
        source.ruleIds.length === 0
          ? undefined
          : h(
              "div.filter-options.filter-rules",
              source.ruleIds.map((id) =>
                controls.checkbox("rule", id, h("code", id)),
              ),
            ),
      ]),
      h("fieldset.filter-group", [
        h("legend", "Size"),
        controls.range("KB", "minKb", "maxKb", "any"),
        controls.range("Lines", "minLines", "maxLines", "1"),
        controls.range("Tokens", "minTokens", "maxTokens", "1"),
      ]),
      h("fieldset.filter-group", [
        h("legend", "Graph"),
        h(
          "div.filter-options.filter-options-column",
          LINK_FLAGS.map((flag) =>
            controls.checkbox("flag", flag, LINK_FLAG_LABELS[flag]),
          ),
        ),
      ]),
      renderWhere(controls, source),
      ...sortInputs(controls, query),
      h("div.filter-actions", [
        h("button", { type: "submit" }, "Apply"),
        h("a", { href: "/dashboard" }, "Reset"),
      ]),
    ],
  );
}

function renderWhere(
  controls: FilterControls,
  source: DashboardSource,
): Element {
  const folder = controls.first("folder");
  return h("fieldset.filter-group", [
    h("legend", "Where"),
    h("label.filter-field", [
      "Folder",
      h("select", { name: "folder" }, [
        h("option", { value: "", selected: folder === "" }, "All documents"),
        ...source.folders.map((value) =>
          h("option", { value, selected: folder === value }, value),
        ),
      ]),
    ]),
    source.changes === undefined
      ? undefined
      : controls.checkbox("changed", "1", "Changed in this branch"),
    h("label.filter-field", [
      "Path contains",
      h("input", {
        type: "search",
        name: "path",
        value: controls.first("path"),
        autoComplete: "off",
        spellCheck: false,
      }),
    ]),
  ]);
}

// Kept across a filter change, so narrowing the list does not also undo the reader's sort.
function sortInputs(
  controls: FilterControls,
  query: DashboardQuery | undefined,
): (Element | undefined)[] {
  const sort = query?.sort ?? controls.first("sort");
  const dir = query?.dir ?? controls.first("dir");
  const sortIsDefault =
    query === undefined
      ? sort === "" && dir === ""
      : query.sort === DEFAULT_SORT &&
        query.dir === defaultDirection(query.sort);
  if (sortIsDefault) {
    return [undefined, undefined];
  }
  return [
    h("input", { type: "hidden", name: "sort", value: sort }),
    h("input", { type: "hidden", name: "dir", value: dir }),
  ];
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

type Column = { key: SortKey; label: string; numeric: boolean };

const COLUMNS: Column[] = [
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

const OPPOSITE: Record<SortDirection, SortDirection> = {
  asc: "desc",
  desc: "asc",
};

const ARIA_SORT: Record<SortDirection, string> = {
  asc: "ascending",
  desc: "descending",
};

// A column's header links to the table sorted by it: the other way round when it is the sorted
// column already, else in the column's own first direction.
function sortHeader(query: DashboardQuery, column: Column): Element {
  const active = query.sort === column.key;
  const dir = active ? OPPOSITE[query.dir] : defaultDirection(column.key);
  return h(
    column.numeric ? "th.is-numeric" : "th",
    { scope: "col", ariaSort: active ? ARIA_SORT[query.dir] : undefined },
    h(
      "a.dashboard-sort",
      { href: dashboardHref({ ...query, sort: column.key, dir }) },
      column.label,
    ),
  );
}

function renderResults(
  query: DashboardQuery,
  result: DashboardResult,
  branch: boolean,
): (ElementContent | undefined)[] {
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
    h("div.dashboard-table-wrap", renderTable(query, result, branch)),
  ];
}

function renderTable(
  query: DashboardQuery,
  result: DashboardResult,
  branch: boolean,
): Element {
  const header = (column: Column) => sortHeader(query, column);
  return h("table.dashboard-table", [
    h("thead", [
      h("tr", [
        ...COLUMNS.slice(0, 1).map(header),
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
        ...COLUMNS.slice(1).map(header),
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
        : result.rows.map((row, index) =>
            renderRow(row, index === FIRST_SCREEN_ROWS),
          ),
    ),
  ]);
}

// The rows a first screen holds, on the tallest of screens, below the filters: the page is drawn once
// they are read, and the row after them carries the id that says so. The other rows of a corpus of
// hundreds follow out of sight.
const FIRST_SCREEN_ROWS = 40;

function renderRow(row: DashboardRow, belowFirstScreen: boolean): Element {
  const count = (value: number | null, className: string) =>
    h(
      value !== null && value > 0
        ? `td.is-numeric.${className}`
        : "td.is-numeric",
      value === null ? "-" : String(value),
    );
  return h("tr", belowFirstScreen ? { id: FIRST_SCREEN_ID } : {}, [
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
