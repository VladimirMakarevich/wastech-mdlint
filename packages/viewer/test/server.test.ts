import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { startViewer, type RunningViewer } from "../src/server.js";

// The server loads from source here, but the page script it serves is only ever compiled output.
assertBuilt(
  fileURLToPath(new URL("../dist/client/viewer.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/viewer.ts", import.meta.url)),
);

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

let workDir: string;
let viewer: RunningViewer;
let port: number;

type Response = { status: number; headers: IncomingHttpHeaders; body: string };

// `fetch` normalizes `..` and `%2e%2e` out of a URL before sending it, so the escape attempts below
// would never reach the server as written. `http.request` sends the path verbatim.
function get(
  rawPath: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path: rawPath,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (body += chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

type ChangePayload = { paths: string[]; structural: boolean };

// Subscribes to the event stream and resolves with the first `name` event whose payload satisfies
// `predicate`. `ready` resolves once the stream is open, so a test writes its file only after the
// subscription exists and cannot miss the event it is waiting for.
function nextEvent<T>(
  name: string,
  predicate: (payload: T) => boolean = () => true,
): { ready: Promise<void>; event: Promise<T> } {
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const event = new Promise<T>((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: "/events" },
      (incoming) => {
        let buffer = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          buffer += chunk;
          markReady();
          const pattern = new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`, "g");
          for (const match of buffer.matchAll(pattern)) {
            const payload = JSON.parse(match[1]!) as T;
            if (predicate(payload)) {
              outgoing.destroy();
              resolve(payload);
            }
          }
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
  return { ready, event };
}

// The first lint runs just after the server starts answering; tests about findings wait for it.
async function diagnosticsReady(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { body } = await get("/api/diagnostics");
    if ((JSON.parse(body) as { status: string }).status === "ready") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("diagnostics never became ready");
}

beforeAll(async () => {
  // A copy, because the live-reload tests write into the corpus.
  workDir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-"));
  await cp(fixtureRoot, workDir, { recursive: true });
  viewer = await startViewer({
    cwd: workDir,
    host: "127.0.0.1",
    port: 0,
    portExplicit: true,
    watch: true,
  });
  port = Number(new URL(viewer.url).port);
}, 30_000);

afterAll(async () => {
  await viewer?.close();
  if (workDir !== undefined) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe("pages", () => {
  it("redirects the root to the repository README", async () => {
    const response = await get("/");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/doc/README.md");
  });

  it("serves a document with the tree, the outline and its backlinks", async () => {
    const response = await get("/doc/docs/guide.md");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain(
      '<a href="/doc/docs/guide.md" title="docs/guide.md" aria-current="page"><span class="tree-name">guide.md</span></a>',
    );
    expect(response.body).toContain(
      '<summary title="docs"><span class="tree-name">docs</span></summary>',
    );
    expect(response.body).toContain('<a href="#setup-1">Setup</a>');
    expect(response.body).toContain(
      '<a href="/doc/README.md">README.md</a></li></ul></section>',
    );
    expect(response.body).toContain("<dt>tags</dt><dd>alpha, beta</dd>");
  });

  it("answers HEAD with headers only", async () => {
    const response = await get("/doc/README.md", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
  });

  it("sends a strict policy with every page", async () => {
    const { headers } = await get("/doc/README.md");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("shows a linked source file with line anchors", async () => {
    const response = await get("/file/src/app.ts");
    expect(response.status).toBe(200);
    expect(response.body).toContain('class="source-view"');
    expect(response.body).toContain('id="L2"');
  });

  it("serves an embedded image as-is, sandboxed", async () => {
    const response = await get("/file/images/pic.svg");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/svg+xml");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
  });

  it("serves the page scripts, Mermaid and ECharts from the packages", async () => {
    for (const name of [
      "viewer.js",
      "theme.js",
      "search.js",
      "charts.js",
      "chart-option.js",
      "echarts.js",
      "graph.js",
      "column-resize.js",
      "dashboard.js",
      "tree-state.js",
      "viewer.css",
    ]) {
      expect((await get(`/assets/${name}`)).status, name).toBe(200);
    }
    for (const vendor of [
      "/vendor/mermaid/mermaid.esm.min.mjs",
      "/vendor/echarts/echarts.esm.min.mjs",
    ]) {
      const response = await get(vendor);
      expect(response.status, vendor).toBe(200);
      expect(response.headers["content-type"], vendor).toBe(
        "text/javascript; charset=utf-8",
      );
    }
  });

  it("leaves chart blocks in a document for the page script to draw", async () => {
    const { status, body } = await get("/doc/docs/charts.md");
    expect(status).toBe(200);
    expect(body).toContain(
      '<div class="echarts-chart"><pre class="echarts-source">',
    );
    expect(body).toContain('<div class="echarts-chart" data-state="invalid">');
  });

  // A handle can do nothing without its script, so the server renders it hidden, but already as the
  // focusable separator it becomes. Each sits in its column's frame, on the edge toward the article.
  it("puts a width handle on the edge of each side column", async () => {
    const { body } = await get("/doc/docs/guide.md");
    expect(body).toContain(
      '<div class="sidebar-frame"><nav class="sidebar" aria-label="Documents">',
    );
    expect(body).toContain(
      '<div class="column-resizer" data-column="sidebar" role="separator" aria-orientation="vertical" aria-label="Resize the document tree" tabindex="0" hidden></div></div><main',
    );
    expect(body).toContain('<div class="rail-frame"><aside class="rail">');
    expect(body).toMatch(
      /<\/aside><div class="column-resizer" data-column="rail" role="separator" aria-orientation="vertical" aria-label="Resize the side column" tabindex="0" hidden><\/div><\/div><\/div><\/body>/,
    );
  });

  // The tree's open folders and scroll position have to be back before the tree is painted, so the
  // script that restores them is a classic one placed right after the tree, not a deferred module;
  // it finds each folder by the path it is kept under.
  it("restores the tree's state from a blocking script right after it", async () => {
    const { body } = await get("/doc/docs/guide.md");
    expect(body).toContain(
      '</ul></nav><script src="/assets/tree-state.js"></script><div class="column-resizer" data-column="sidebar"',
    );
    expect(body).toContain('<details open data-folder="docs">');
  });

  // The switch can do nothing until the page script knows the findings, so it starts hidden, above
  // the tree it filters.
  it("puts a hidden findings-only switch above the tree", async () => {
    const { body } = await get("/doc/README.md");
    expect(body).toContain(
      '<nav class="sidebar" aria-label="Documents"><label class="tree-filter" hidden><input type="checkbox"> Only files with findings</label><p class="tree-filter-empty" hidden>No file has findings.</p><ul class="tree">',
    );
  });

  // A page with nothing for the rail has no rail, and so no edge to drag.
  it("leaves the rail and its handle out of a page without one", async () => {
    const { body } = await get("/search?q=x");
    expect(body).not.toContain('class="rail-frame"');
    expect(body).not.toContain('data-column="rail"');
  });

  it("gives a document with neighbors a small graph of them in the rail", async () => {
    // The guide's only neighbor is the README, which links to it.
    expect((await get("/doc/docs/guide.md")).body).toContain(
      '<aside class="rail"><section class="local-graph" aria-label="Linked documents"><h2>Links (1)</h2><div class="local-graph-canvas" data-path="docs/guide.md" hidden></div><a class="local-graph-open" href="/graph?focus=docs%2Fguide.md">Open in the full graph</a></section>',
    );
  });

  // From a document the link opens the graph on that document; elsewhere on the whole graph.
  it("links the header to the graph, focused on the document being read", async () => {
    expect((await get("/doc/docs/guide.md")).body).toContain(
      '<a class="topbar-link" href="/graph?focus=docs%2Fguide.md">Graph</a>',
    );
    expect((await get("/search?q=x")).body).toContain(
      '<a class="topbar-link" href="/graph">Graph</a>',
    );
  });

  // The stored theme must be applied before the stylesheet paints anything, so the classic theme
  // script comes first; the switch itself stays hidden until the module that drives it has run.
  it("puts search and the theme switch in the header", async () => {
    const { body } = await get("/doc/README.md");
    expect(
      body.indexOf('<script src="/assets/theme.js"></script>'),
    ).toBeLessThan(
      body.indexOf('<link rel="stylesheet" href="/assets/viewer.css">'),
    );
    expect(body).toMatch(
      /<form class="search" action="\/search" method="get" role="search"><input type="search" name="q"/,
    );
    expect(body).toContain(
      '<button class="theme-toggle" type="button" hidden>',
    );
  });
});

describe("search", () => {
  it("answers the live search with hits that land on a heading", async () => {
    const response = await get("/api/search?q=setup");
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    const { results } = JSON.parse(response.body) as {
      results: { path: string; href: string }[];
    };
    expect(results[0]).toMatchObject({
      path: "docs/guide.md",
      href: "/doc/docs/guide.md#setup",
    });
  });

  it("renders a results page for the form without script", async () => {
    const { status, body } = await get("/search?q=setup");
    expect(status).toBe(200);
    expect(body).toContain('<ol class="search-page-results">');
    expect(body).toContain("<mark>Setup</mark>");
    expect(body).toContain('value="setup"');
  });

  // The query comes back twice: as heading text, where `<` must be escaped, and as the search box's
  // value, a double-quoted attribute where `<` is inert text and only `"` could break out. The
  // query below tries both.
  it("escapes the query wherever the page repeats it", async () => {
    const { body } = await get(
      `/search?q=${encodeURIComponent('"><script>alert(1)</script>')}`,
    );
    expect(body).toContain(
      '<h1>Search: ">&#x3C;script>alert(1)&#x3C;/script></h1>',
    );
    expect(body).toContain('value="&#x22;><script>alert(1)</script>"');
    expect(body).not.toContain('"><script>');
  });

  it("allows the search form to submit to this server only", async () => {
    const { headers } = await get("/doc/README.md");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
  });
});

describe("diagnostics", () => {
  it("counts findings per file for the tree", async () => {
    await diagnosticsReady();
    const { body } = await get("/api/diagnostics");
    const { files } = JSON.parse(body) as {
      files: Record<string, { errors: number; warnings: number }>;
    };
    expect(files["README.md"]).toEqual({ errors: 1, warnings: 0 });
    expect(files["docs/guide.md"]).toBeUndefined();
  });

  it("lists a document's findings with the heading to jump to", async () => {
    await diagnosticsReady();
    const { body } = await get("/api/diagnostics?path=README.md");
    const { findings } = JSON.parse(body) as {
      findings: { ruleId: string; line: number; anchor?: string }[];
    };
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "REF-001",
        severity: "error",
        line: 5,
        anchor: "fixture-home",
      }),
    ]);
  });
});

type DashboardPayload = {
  query: { severity: string[]; sort: string; dir: string };
  findings: string;
  corpusSize: number;
  totals: { documents: number; errors: number };
  rows: { path: string; errors: number | null; flags: string[] }[];
};

describe("dashboard", () => {
  it("renders the filters and a row per document without script", async () => {
    await diagnosticsReady();
    const { status, body } = await get("/dashboard");
    expect(status).toBe(200);
    expect(body).toContain(
      '<form class="dashboard-filters" action="/dashboard" method="get" aria-label="Filters">',
    );
    expect(body).toContain(
      '<td class="dashboard-path"><a href="/doc/docs/guide.md">docs/guide.md</a></td>',
    );
    expect(body).toContain("4 of 4 documents · 1 error · 0 warnings");
    // The configured rules are the ones to filter by.
    expect(body).toContain('name="rule" value="REF-001"');
    expect(body).toContain('name="rule" value="REF-002"');
  });

  it("links the header to the dashboard", async () => {
    expect((await get("/doc/README.md")).body).toContain(
      '<a class="topbar-link" href="/dashboard">Dashboard</a>',
    );
  });

  it("applies the filters the form sends", async () => {
    await diagnosticsReady();
    const { body } = await get("/dashboard?severity=error&minKb=&path=");
    expect(body).toContain("1 of 4 documents");
    expect(body).toContain('<a href="/doc/README.md">README.md</a>');
    expect(body).not.toContain(
      '<a href="/doc/docs/guide.md">docs/guide.md</a>',
    );
    expect(body).toContain('name="severity" value="error" checked');
  });

  it("answers the same selection as JSON, echoing the query it applied", async () => {
    await diagnosticsReady();
    const response = await get("/api/dashboard?flag=orphan&sort=errors");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers["content-disposition"]).toBeUndefined();
    const data = JSON.parse(response.body) as DashboardPayload;
    expect(data.query).toMatchObject({ sort: "errors", dir: "desc" });
    expect(data.findings).toBe("ready");
    expect(data.corpusSize).toBe(4);
    // Nothing links to either: the README reaches docs/README.md only through a folder link, which
    // the graph does not count as a link to the folder index.
    expect(data.rows.map((row) => row.path)).toEqual([
      "docs/README.md",
      "docs/charts.md",
    ]);
  });

  it("downloads the selection as CSV or JSON", async () => {
    await diagnosticsReady();
    const csv = await get("/api/dashboard?severity=error&format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["content-disposition"]).toBe(
      'attachment; filename="dashboard.csv"',
    );
    expect(csv.body.split("\r\n")[0]).toBe(
      "path,errors,warnings,rules,bytes,lines,tokens,linkedFrom,linksTo,flags",
    );
    expect(csv.body).toMatch(/^README\.md,1,0,REF-001,/m);

    const json = await get("/api/dashboard?format=json");
    expect(json.headers["content-disposition"]).toBe(
      'attachment; filename="dashboard.json"',
    );
    expect((JSON.parse(json.body) as DashboardPayload).rows).toHaveLength(4);
  });

  it.each([
    ["rule=NOPE-001", 'Unknown rule "NOPE-001".'],
    ["minKb=abc", '"minKb" must be a number of zero or more, got "abc".'],
    ["folder=..", 'No folder ".." holds corpus documents.'],
    ["format=xml", 'Unknown format "xml": use csv or json.'],
  ])("refuses /api/dashboard?%s", async (search, message) => {
    const response = await get(`/api/dashboard?${search}`);
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: message });
  });

  // The page keeps the form, filled in as sent, so the reader can fix the value that was refused;
  // the value is escaped both in the field and in the message.
  it("refuses a bad filter on the page with the reason, escaped", async () => {
    const { status, body } = await get(
      `/dashboard?rule=${encodeURIComponent("<img src=x onerror=alert(1)>")}`,
    );
    expect(status).toBe(400);
    expect(body).toContain(
      '<p class="dashboard-error">Unknown rule "&#x3C;img src=x onerror=alert(1)>".</p>',
    );
    expect(body).not.toContain("<img src=x");
    expect(body).toContain('<form class="dashboard-filters"');
  });

  it("does not take a format on the page", async () => {
    expect((await get("/dashboard?format=csv")).status).toBe(400);
  });
});

type GraphPayload = {
  folder: string;
  nodes: { path: string; title: string; group: string }[];
  edges: { from: string; to: string }[];
  focus: { path: string; neighbors: string[] } | null;
};

describe("graph", () => {
  it("answers with the corpus graph, one edge per linked pair", async () => {
    const response = await get("/api/graph");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    const view = JSON.parse(response.body) as GraphPayload;
    expect(view.nodes.map((node) => node.path)).toEqual([
      "README.md",
      "docs/README.md",
      "docs/charts.md",
      "docs/guide.md",
    ]);
    // `docs/charts.md` links to the README twice (a link and an anchor): one line in the picture.
    expect(view.edges).toEqual([
      { from: "README.md", to: "docs/guide.md" },
      { from: "docs/README.md", to: "README.md" },
      { from: "docs/charts.md", to: "README.md" },
    ]);
    expect(view.nodes.find((node) => node.path === "docs/charts.md")).toEqual(
      expect.objectContaining({
        title: 'Charts <b> & "quotes"',
        group: "docs",
      }),
    );
    expect(view.focus).toBeNull();
  });

  it("narrows to a folder and lights a focused document's neighbors", async () => {
    const docs = JSON.parse(
      (await get("/api/graph?folder=docs&focus=README.md")).body,
    ) as GraphPayload;
    expect(docs.nodes.every((node) => node.path.startsWith("docs/"))).toBe(
      true,
    );
    expect(docs.edges).toEqual([]);
    expect(docs.focus).toBeNull();

    const focused = JSON.parse(
      (await get("/api/graph?focus=README.md")).body,
    ) as GraphPayload;
    expect(focused.focus).toEqual({
      path: "README.md",
      neighbors: ["docs/README.md", "docs/charts.md", "docs/guide.md"],
    });
  });

  // A folder must be one that holds documents and a focus must be a document. Neither is ever used
  // as a filesystem path, and neither may answer with an empty graph that looks like a real one.
  it.each([
    "folder=nope",
    "folder=..",
    "folder=docs%2F",
    "folder=%2Fdocs",
    "folder=docs%2F..",
    "focus=secret.txt",
    "focus=src%2Fapp.ts",
    "focus=..%2FREADME.md",
    "focus=docs",
  ])("refuses /api/graph?%s", async (query) => {
    const response = await get(`/api/graph?${query}`);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toHaveProperty("error");
    expect((await get(`/graph?${query}`)).status).toBe(404);
  });

  it("answers a document's neighborhood with the links among it", async () => {
    const response = await get("/api/neighbors?path=docs%2Fguide.md");
    expect(response.status).toBe(200);
    const view = JSON.parse(response.body) as GraphPayload;
    expect(view.nodes.map((node) => node.path)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
    expect(view.edges).toEqual([{ from: "README.md", to: "docs/guide.md" }]);
    expect(view.focus).toEqual({
      path: "docs/guide.md",
      neighbors: ["README.md"],
    });
  });

  // Like the graph's parameters, the path is only ever compared against the corpus's documents.
  it.each(["", "path=", "path=secret.txt", "path=..%2FREADME.md", "path=docs"])(
    "refuses /api/neighbors?%s",
    async (query) => {
      const response = await get(`/api/neighbors?${query}`);
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toHaveProperty("error");
    },
  );

  it("renders the graph page with its folder picker and a list for readers without script", async () => {
    const { status, headers, body } = await get("/graph?focus=README.md");
    expect(status).toBe(200);
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(body).toContain("<title>Link graph · ");
    expect(body).toContain(
      '<option value="" selected>All documents</option><option value="docs">docs</option>',
    );
    expect(body).toContain(
      '<input type="hidden" name="focus" value="README.md">',
    );
    expect(body).toContain(
      '<div class="graph-canvas" data-folder="" data-focus="README.md">',
    );
    expect(body).toContain(
      '<a href="/doc/docs/charts.md">Charts &#x3C;b> &#x26; "quotes"</a>',
    );
    expect(body).toContain("README.md is highlighted with 3 neighbors.");
  });
});

describe("refusals", () => {
  // Each of these is a way to name a file the viewer must not hand out: outside the repository, not
  // linked from any document, or inside the package rather than the asset table. None may succeed,
  // and the unlinked file's text must not appear in any answer.
  it.each([
    "/doc/../secret.txt",
    "/doc/%2e%2e/secret.txt",
    "/doc/docs/..%2f..%2fsecret.txt",
    "/doc/secret.txt",
    "/file/secret.txt",
    "/file/../secret.txt",
    "/file/src/..%2fsecret.txt",
    "/file/docs/guide.md%00.png",
    "/assets/../package.json",
    "/assets/server.js",
    "/assets/viewer.d.ts",
    "/assets/..%2Fserver.js",
    "/assets/Viewer.js",
    "/vendor/mermaid/../package.json",
    "/vendor/mermaid/mermaid.core.mjs",
    "/vendor/mermaid/chunks/mermaid.esm.min/..%2f..%2fmermaid.d.ts",
    "/vendor/echarts/../package.json",
    "/vendor/echarts/%2e%2e/package.json",
    "/vendor/echarts/echarts.js",
    "/vendor/echarts/echarts.esm.min.mjs%00",
    "/vendor/echarts/echarts.esm%2emin.mjs",
  ])("does not serve %s", async (rawPath) => {
    const response = await get(rawPath);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain("not linked from any document");
  });

  it("rejects a request addressed to another host name", async () => {
    const response = await get("/doc/README.md", {
      headers: { Host: `attacker.example:${port}` },
    });
    expect(response.status).toBe(403);
  });

  it("rejects a request from another origin", async () => {
    const response = await get("/doc/README.md", {
      headers: { Origin: "http://attacker.example" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects anything but GET and HEAD", async () => {
    const response = await get("/doc/README.md", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });
});

describe("live reload", () => {
  it("reports an edited document and serves its new text", async () => {
    const { ready, event } = nextEvent<ChangePayload>("change", (payload) =>
      payload.paths.includes("docs/guide.md"),
    );
    await ready;
    await writeFile(
      path.join(workDir, "docs", "guide.md"),
      "# Guide\n\nEdited while the viewer was running.\n",
    );
    const payload = await event;
    expect(payload.structural).toBe(false);
    const response = await get("/doc/docs/guide.md");
    expect(response.body).toContain("Edited while the viewer was running.");
    const { results } = JSON.parse(
      (await get("/api/search?q=edited")).body,
    ) as { results: { path: string }[] };
    expect(results.map((hit) => hit.path)).toEqual(["docs/guide.md"]);
  }, 15_000);

  it("re-lints after an edit and announces the new findings", async () => {
    await diagnosticsReady();
    const { ready, event } = nextEvent("diagnostics");
    await ready;
    await writeFile(
      path.join(workDir, "README.md"),
      "# Fixture home\n\nRead [the docs folder](docs/).\n",
    );
    await event;
    const { body } = await get("/api/diagnostics?path=README.md");
    expect(JSON.parse(body)).toEqual({ status: "ready", findings: [] });
  }, 15_000);

  it("reports a new document as a change to the tree", async () => {
    const { ready, event } = nextEvent<ChangePayload>("change", (payload) =>
      payload.paths.includes("docs/added.md"),
    );
    await ready;
    await writeFile(path.join(workDir, "docs", "added.md"), "# Added\n");
    const payload = await event;
    expect(payload.structural).toBe(true);
    const added = await get("/doc/docs/added.md");
    expect(added.status).toBe(200);
    // It links nowhere and nothing links to it, so there is no neighborhood to draw.
    expect(added.body).not.toContain('class="local-graph"');
  }, 15_000);
});
