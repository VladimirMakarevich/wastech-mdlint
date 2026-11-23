import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";

import {
  buildContextGraph,
  parseDocument,
  type LintMessage,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import {
  buildDashboard,
  dashboardCsv,
  dashboardHref,
  parseDashboardQuery,
  renderDashboardArticle,
  type DashboardQuery,
  type DashboardSource,
} from "../src/dashboard.js";
import { graphFolders } from "../src/graph-view.js";

// Rows come in code-point order, where an upper-case name sorts before a lower-case one, so
// `README.md` leads. `big.md` is exactly 2048 bytes — two kilobytes — so the size bounds can be checked on both sides
// of the boundary. The rest are linked so that every link flag has a document that carries it:
// `README.md` and `docs/a.md` link to each other (a cycle), `docs/b.md` is linked to and links
// nowhere (a dead end), `notes/x.md` and `notes/y.md` form a group of their own (detached), and
// `big.md` is linked from nothing (an orphan, and alone a group of one).
const bigContent = `# Big\n\n${"x".repeat(2048 - "# Big\n\n".length - 1)}\n`;
const documents = new Map<string, ParsedDocument>(
  Object.entries({
    "README.md": "# Home\n\n[a](docs/a.md) [b](docs/b.md)\n",
    "docs/a.md": "# A\n\n[home](../README.md)\n",
    "docs/b.md": "# B\n",
    "notes/x.md": "# X\n\n[y](y.md)\n",
    "notes/y.md": "# Y\n",
    "big.md": bigContent,
  }).map(([path, content]) => [path, parseDocument({ path, content })]),
);
const graph = buildContextGraph(documents, {});

function message(
  filePath: string,
  ruleId: string,
  severity: "error" | "warning",
): LintMessage {
  return { filePath, ruleId, severity, message: `${ruleId} finding`, line: 1 };
}

const findings = new Map<string, LintMessage[]>([
  [
    "README.md",
    [
      message("README.md", "REF-001", "error"),
      message("README.md", "SIZE-001", "warning"),
    ],
  ],
  ["docs/a.md", [message("docs/a.md", "SIZE-001", "error")]],
  ["docs/b.md", [message("docs/b.md", "REF-001", "warning")]],
]);

const source: DashboardSource = {
  documents,
  graph,
  findings,
  ruleIds: ["REF-001", "SIZE-001"],
  folders: graphFolders(documents.keys()),
};

function query(search: string): DashboardQuery {
  const parsed = parseDashboardQuery(new URLSearchParams(search), source);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.query;
}

function paths(search: string, from: DashboardSource = source): string[] {
  return buildDashboard(from, query(search)).rows.map((row) => row.path);
}

describe("buildDashboard rows", () => {
  it("lists every document in path order by default, with core's measurements", () => {
    const result = buildDashboard(source, query(""));
    expect(result.rows.map((row) => row.path)).toEqual([
      "README.md",
      "big.md",
      "docs/a.md",
      "docs/b.md",
      "notes/x.md",
      "notes/y.md",
    ]);
    expect(result.rows[1]).toMatchObject({
      path: "big.md",
      bytes: 2048,
      lines: 3,
    });
    expect(result.corpusSize).toBe(6);
  });

  it("counts findings, the rules behind them and the distinct documents on each side", () => {
    const readme = buildDashboard(source, query("")).rows.find(
      (row) => row.path === "README.md",
    );
    expect(readme).toMatchObject({
      errors: 1,
      warnings: 1,
      rules: ["REF-001", "SIZE-001"],
      linkedFrom: 1,
      linksTo: 2,
      flags: ["cycle"],
    });
  });

  it("flags orphans, dead ends, cycles and documents outside the main group", () => {
    const flags = Object.fromEntries(
      buildDashboard(source, query("")).rows.map((row) => [
        row.path,
        row.flags,
      ]),
    );
    expect(flags).toEqual({
      "big.md": ["orphan", "dead-end", "detached"],
      "docs/a.md": ["cycle"],
      "docs/b.md": ["dead-end"],
      "notes/x.md": ["orphan", "detached"],
      "notes/y.md": ["dead-end", "detached"],
      "README.md": ["cycle"],
    });
  });

  it("totals the selection, not the corpus", () => {
    expect(buildDashboard(source, query("folder=docs")).totals).toMatchObject({
      documents: 2,
      errors: 1,
      warnings: 1,
    });
  });
});

describe("buildDashboard filters", () => {
  it("keeps documents with errors, with warnings, or with either", () => {
    expect(paths("severity=error")).toEqual(["README.md", "docs/a.md"]);
    expect(paths("severity=warning")).toEqual(["README.md", "docs/b.md"]);
    expect(paths("severity=error&severity=warning")).toEqual([
      "README.md",
      "docs/a.md",
      "docs/b.md",
    ]);
  });

  // `docs/b.md` holds a REF-001 warning and no error at all, and `docs/a.md` an error from another
  // rule: neither holds an error from REF-001.
  it("judges severity and rule on the same finding", () => {
    expect(paths("rule=REF-001")).toEqual(["README.md", "docs/b.md"]);
    expect(paths("severity=error&rule=REF-001")).toEqual(["README.md"]);
  });

  it("accepts a built-in rule by its alias", () => {
    expect(query("rule=no-broken-links").rule).toEqual(["REF-001"]);
  });

  it("includes both size bounds, in kilobytes of 1024 bytes", () => {
    expect(paths("minKb=2")).toEqual(["big.md"]);
    expect(paths("maxKb=2")).toContain("big.md");
    expect(paths("minKb=2&maxKb=2")).toEqual(["big.md"]);
    expect(paths("minKb=2.001")).toEqual([]);
    expect(paths("maxKb=1.999")).not.toContain("big.md");
    expect(paths("minKb=0.5&maxKb=1")).toEqual([]);
  });

  it("filters by lines and tokens, both bounds inclusive", () => {
    expect(paths("minLines=3")).toEqual([
      "README.md",
      "big.md",
      "docs/a.md",
      "notes/x.md",
    ]);
    expect(paths("maxLines=1")).toEqual(["docs/b.md", "notes/y.md"]);
    expect(paths("minLines=2&maxLines=2")).toEqual([]);
    expect(paths("minTokens=512&maxTokens=512")).toEqual(["big.md"]);
  });

  it("keeps a document carrying any of the chosen link flags", () => {
    expect(paths("flag=orphan")).toEqual(["big.md", "notes/x.md"]);
    expect(paths("flag=orphan&flag=cycle")).toEqual([
      "README.md",
      "big.md",
      "docs/a.md",
      "notes/x.md",
    ]);
  });

  it("narrows to a folder and to paths containing a text, ignoring case", () => {
    expect(paths("folder=notes")).toEqual(["notes/x.md", "notes/y.md"]);
    expect(paths("path=READ")).toEqual(["README.md"]);
    expect(paths("folder=docs&path=b")).toEqual(["docs/b.md"]);
  });

  it("returns an empty selection rather than an error when nothing matches", () => {
    const result = buildDashboard(source, query("minKb=5&maxKb=1"));
    expect(result.rows).toEqual([]);
    expect(result.totals.documents).toBe(0);
    const html = toHtml(
      renderDashboardArticle({
        params: new URLSearchParams("minKb=5&maxKb=1"),
        source,
        ok: true,
        query: query("minKb=5&maxKb=1"),
        result,
      }),
    );
    expect(html).toContain("No documents match these filters.");
    expect(html).toContain("0 of 6 documents");
  });

  it("treats an empty field as not set, the way a GET form sends one", () => {
    expect(paths("minKb=&severity=&rule=&folder=&path=")).toHaveLength(6);
  });

  // Until the first lint is in, nothing is known about findings: the counts are unknown rather than
  // zero, and the finding filters do not empty the table.
  it("leaves finding filters unapplied while findings are pending", () => {
    const pending = { ...source, findings: undefined };
    const result = buildDashboard(pending, query("severity=error"));
    expect(result.findings).toBe("pending");
    expect(result.rows).toHaveLength(6);
    expect(result.rows[0]).toMatchObject({ errors: null, warnings: null });
  });
});

describe("buildDashboard sorting", () => {
  it("sorts a count biggest first when its column is first chosen", () => {
    expect(query("sort=bytes")).toMatchObject({ sort: "bytes", dir: "desc" });
    expect(paths("sort=bytes")[0]).toBe("big.md");
  });

  it("breaks ties by path, whatever the direction", () => {
    expect(paths("sort=errors&dir=desc")).toEqual([
      "README.md",
      "docs/a.md",
      "big.md",
      "docs/b.md",
      "notes/x.md",
      "notes/y.md",
    ]);
    expect(paths("sort=errors&dir=asc").slice(0, 2)).toEqual([
      "big.md",
      "docs/b.md",
    ]);
  });
});

describe("parseDashboardQuery", () => {
  it.each([
    ["severity=fatal", 'Unknown severity "fatal": use error or warning.'],
    ["rule=NOPE-001", 'Unknown rule "NOPE-001".'],
    [
      "flag=lonely",
      'Unknown link filter "lonely": use orphan, dead-end, cycle, detached.',
    ],
    ["folder=elsewhere", 'No folder "elsewhere" holds corpus documents.'],
    [
      "sort=color",
      'Unknown sort column "color": use path, errors, warnings, rules, bytes, lines, tokens, linkedFrom, linksTo, flags.',
    ],
    ["sort=bytes&dir=up", 'Unknown sort direction "up": use asc or desc.'],
    ["minKb=-1", '"minKb" must be a number of zero or more, got "-1".'],
    ["maxLines=1e3", '"maxLines" must be a number of zero or more, got "1e3".'],
    [
      "minTokens=ten",
      '"minTokens" must be a number of zero or more, got "ten".',
    ],
    ["colour=red", 'Unknown filter "colour".'],
  ])("refuses %s", (search, message) => {
    expect(parseDashboardQuery(new URLSearchParams(search), source)).toEqual({
      ok: false,
      message,
    });
  });

  it("accepts a parameter the caller handles itself", () => {
    expect(
      parseDashboardQuery(new URLSearchParams("format=csv"), source, ["format"])
        .ok,
    ).toBe(true);
  });

  it("writes a query back in one order, without its defaults", () => {
    expect(
      dashboardHref(
        query("rule=SIZE-001&severity=warning&rule=REF-001&sort=path&dir=asc"),
      ),
    ).toBe("/dashboard?severity=warning&rule=REF-001&rule=SIZE-001");
    expect(dashboardHref(query(""))).toBe("/dashboard");
    expect(dashboardHref(query("sort=bytes"))).toBe(
      "/dashboard?sort=bytes&dir=desc",
    );
  });
});

describe("dashboardCsv", () => {
  it("writes one row per document, sizes in bytes", () => {
    const csv = dashboardCsv(buildDashboard(source, query("path=README")));
    expect(csv).toBe(
      "path,errors,warnings,rules,bytes,lines,tokens,linkedFrom,linksTo,flags\r\n" +
        `README.md,1,1,REF-001 SIZE-001,${Buffer.byteLength("# Home\n\n[a](docs/a.md) [b](docs/b.md)\n")},3,10,1,2,cycle\r\n`,
    );
  });

  // A spreadsheet runs a cell starting with `=` as a formula; a file may be named that way. Both
  // documents stand alone, and the first by path counts as the main group.
  it("quotes and defuses cells a spreadsheet would read as formulas", () => {
    const hostile = new Map<string, ParsedDocument>([
      [
        '=HYPERLINK("x").md',
        parseDocument({ path: '=HYPERLINK("x").md', content: "# A\n" }),
      ],
      ["-1,2.md", parseDocument({ path: "-1,2.md", content: "# B\n" })],
    ]);
    const csv = dashboardCsv(
      buildDashboard(
        {
          documents: hostile,
          graph: buildContextGraph(hostile, {}),
          findings: new Map(),
          ruleIds: [],
          folders: [],
        },
        query(""),
      ),
    );
    expect(csv.split("\r\n").slice(1, 3)).toEqual([
      `"'-1,2.md",0,0,,4,1,1,0,0,orphan dead-end`,
      `"'=HYPERLINK(""x"").md",0,0,,4,1,1,0,0,orphan dead-end detached`,
    ]);
  });
});

describe("renderDashboardArticle", () => {
  // The path filter comes back as the field's value and every document path as text, both escaped
  // by the hast serializer; a refused query is repeated in its message the same way.
  it("escapes what the address and the repository put on the page", () => {
    const hostile = '"><script>alert(1)</script>';
    const params = new URLSearchParams({ path: hostile });
    const html = toHtml(
      renderDashboardArticle({
        params,
        source,
        ok: true,
        query: query(params.toString()),
        result: buildDashboard(source, query(params.toString())),
      }),
    );
    expect(html).toContain('value="&#x22;><script>alert(1)</script>"');
    expect(html).not.toContain('"><script>');

    const refused = toHtml(
      renderDashboardArticle({
        params: new URLSearchParams({ rule: "<b>x</b>" }),
        source,
        ok: false,
        message: 'Unknown rule "<b>x</b>".',
      }),
    );
    expect(refused).toContain('Unknown rule "&#x3C;b>x&#x3C;/b>".');
    expect(refused).not.toContain("<b>x</b>");
  });

  it("marks the sorted column and links its header to the opposite direction", () => {
    const html = toHtml(
      renderDashboardArticle({
        params: new URLSearchParams("sort=bytes"),
        source,
        ok: true,
        query: query("sort=bytes"),
        result: buildDashboard(source, query("sort=bytes")),
      }),
    );
    expect(html).toContain(
      '<th class="is-numeric" scope="col" aria-sort="descending"><a class="dashboard-sort" href="/dashboard?sort=bytes&#x26;dir=asc">KB</a></th>',
    );
    // The form carries the sort, so a filter change keeps it.
    expect(html).toContain('<input type="hidden" name="sort" value="bytes">');
  });
});
