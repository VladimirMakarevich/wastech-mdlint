import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // The copy is not a repository; the ceiling keeps git from finding one around the temporary
    // directory - a home directory kept under git - and giving these pages a Changes section.
    gitEnv: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: path.dirname(workDir),
    },
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

  // Headings get core's slugs as ids, unprefixed; an id of the viewer's own that a heading could also
  // have (`content` for "Content") would send that heading's outline entry to the viewer's element.
  it("gives the viewer's own elements ids no heading slug can have", async () => {
    const { body } = await get("/doc/README.md");
    expect(body).toContain('<a class="skip-link" href="#viewer.content">');
    expect(body).toContain('<main class="content" id="viewer.content">');
    expect(body).not.toContain('id="content"');
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

  // The copy button carries the path relative to the repository and, the viewer being bound to
  // loopback here, the absolute one in the platform's own form - for a document, a linked file and
  // the config file alike.
  it("offers each shown file's relative and absolute path to copy", async () => {
    const button = (relPath: string, absolute: string): string =>
      `<button class="copy-path" type="button" hidden title="Copy the path" aria-label="Copy the path of ${relPath}" data-path="${relPath}" data-absolute-path="${absolute}">`;
    expect((await get("/doc/docs/guide.md")).body).toContain(
      button("docs/guide.md", path.join(workDir, "docs", "guide.md")),
    );
    expect((await get("/file/src/app.ts")).body).toContain(
      button("src/app.ts", path.join(workDir, "src", "app.ts")),
    );
    expect((await get("/config")).body).toContain(
      button(
        "wastech-mdlint.config.json",
        path.join(workDir, "wastech-mdlint.config.json"),
      ),
    );
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

  // A browser asks for /favicon.ico whatever the page says; both that request and the page's own
  // link must reach the viewer's icon, byte for byte, so the tab shows it rather than a blank.
  it("serves the tab icon and links it from every page", async () => {
    const icon = await readFile(
      fileURLToPath(new URL("../assets/favicon.ico", import.meta.url)),
    );
    const response = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/x-icon");
    expect(Buffer.from(await response.arrayBuffer()).equals(icon)).toBe(true);
    for (const page of ["/doc/README.md", "/graph", "/dashboard", "/config"]) {
      expect((await get(page)).body, page).toContain(
        '<link rel="icon" href="/favicon.ico">',
      );
    }
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

  // Every page loads the stylesheet, the page scripts and, beside a document, ECharts. Sent in full on
  // every navigation, the page waited for the stylesheet and the graph for ECharts to be compiled
  // again; a browser holding the current version is told so instead, and keeps what it compiled.
  it("tells a browser holding the current version of a file that it is current", async () => {
    for (const address of [
      "/assets/viewer.css",
      "/assets/viewer.js",
      "/vendor/echarts/echarts.esm.min.mjs",
    ]) {
      const first = await get(address);
      const etag = first.headers.etag;
      expect(etag, address).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      expect(first.headers["cache-control"], address).toBe("no-cache");
      const again = await get(address, {
        headers: { "If-None-Match": etag ?? "" },
      });
      expect(again.status, address).toBe(304);
      expect(again.body, address).toBe("");
      const other = await get(address, {
        headers: { "If-None-Match": 'W/"0-0"' },
      });
      expect(other.status, address).toBe(200);
      expect(other.body, address).toBe(first.body);
    }
    expect((await get("/assets/nope.js")).status).toBe(404);
  });

  // A link to a document is fetched as the pointer rests on it, so the click is answered from that
  // copy rather than waiting for the server. The rules are a file the pages name in a header, since
  // the CSP refuses inline script, and they only fetch: rendering ahead would run a page's scripts
  // before the reader opened it. A request a browser makes to fetch ahead is answered like a click.
  it("lets the browser fetch a document's page ahead of the click", async () => {
    const page = await get("/doc/README.md");
    expect(page.headers["speculation-rules"]).toBe('"/speculation-rules.json"');
    const rules = await get("/speculation-rules.json");
    expect(rules.status).toBe(200);
    expect(rules.headers["content-type"]).toBe(
      "application/speculationrules+json",
    );
    expect(JSON.parse(rules.body)).toEqual({
      prefetch: [
        {
          where: {
            and: [
              { href_matches: "/doc/*" },
              { not: { selector_matches: 'a[href^="#"]' } },
              { not: { selector_matches: ".blame-toggle" } },
            ],
          },
          eagerness: "moderate",
        },
        {
          where: { selector_matches: ".section-nav a" },
          eagerness: "moderate",
        },
      ],
    });
    const ahead = await get("/doc/docs/guide.md", {
      headers: {
        "Sec-Purpose": "prefetch",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
    });
    expect(ahead.status).toBe(200);
    expect(ahead.body).toContain(
      '<meta name="wastech-doc" content="docs/guide.md">',
    );
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
    // `data-marked` is there once the first lint is in, which this test does not wait for.
    expect(body).toMatch(
      /<div class="sidebar-frame"><nav class="sidebar" aria-label="Documents"( data-marked="[a-z ]*")?>/,
    );
    expect(body).toContain(
      '<div class="column-resizer" data-column="sidebar" role="separator" aria-orientation="vertical" aria-label="Resize the document tree" tabindex="0" hidden></div></div><main',
    );
    expect(body).toContain('<div class="rail-frame"><aside class="rail">');
    expect(body).toMatch(
      /<\/aside><div class="column-resizer" data-column="rail" role="separator" aria-orientation="vertical" aria-label="Resize the side column" tabindex="0" hidden><\/div><\/div><\/div><div id="viewer\.end" hidden><\/div><\/body>/,
    );
  });

  // The blocking script after the tree stops the parser while it is fetched, and a browser drew the
  // header and the tree over an empty article for one frame. Every page is held until its last
  // element is read; that element is an empty one of its own at the very end, since a browser stops
  // waiting for an element at its start tag, and the layout's start tag comes before the tree. The
  // dashboard and the Changes page are long, and wait only for their first screen.
  it("is not drawn before all of it has been read", async () => {
    for (const address of ["/doc/docs/guide.md", "/search?q=x", "/dashboard"]) {
      const { body } = await get(address);
      const awaited =
        address === "/dashboard" ? "viewer.first-screen" : "viewer.end";
      expect(body, address).toContain(
        `<link rel="expect" href="#${awaited}" blocking="render"></head>`,
      );
      expect(body, address).toMatch(
        /<div id="viewer\.end" hidden><\/div><\/body>/,
      );
    }
  });

  // The tree's open folders and scroll position have to be back before the tree is painted, so the
  // script that restores them is a classic one placed right after the tree, not a deferred module;
  // it finds each folder by the path it is kept under.
  it("restores the tree's state from a blocking script right after it", async () => {
    const { body } = await get("/doc/docs/guide.md");
    expect(body).toContain(
      '</ul></details></nav><script src="/assets/tree-state.js"></script><div class="column-resizer" data-column="sidebar"',
    );
    expect(body).toContain('<details open data-folder="docs">');
  });

  // The switch can do nothing until the page script knows the findings, so it starts hidden, above
  // the tree it filters. Both sit inside the disclosure a phone folds the tree behind, which is open
  // as served, so a page without script shows the tree at every width.
  it("puts a hidden findings-only switch above the tree, in an open disclosure", async () => {
    const { body } = await get("/doc/README.md");
    expect(body).toContain(
      '<details class="sidebar-disclosure" open><summary class="sidebar-summary">Documents</summary><label class="tree-filter tree-filter-findings switch-row" hidden><span>Only files with findings</span><input class="switch" type="checkbox" role="switch"></label><p class="tree-filter-empty tree-filter-findings-empty" hidden>No file has findings.</p><ul class="tree">',
    );
  });

  // Outside a git work tree there is no branch to review, so nothing offers a review.
  it("has no Changes section outside a git work tree", async () => {
    const { body } = await get("/doc/README.md");
    expect(body).not.toContain('href="/changes"');
    expect(body).not.toContain("tree-filter-changes");
    expect((await get("/changes")).status).toBe(404);
    expect((await get("/api/changes")).status).toBe(404);
    expect((await get("/api/changes/diff?path=README.md")).status).toBe(404);
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
      '<aside class="rail"><section class="local-graph" aria-label="Linked documents"><h2>Links (1)</h2><div class="local-graph-canvas" data-path="docs/guide.md" hidden></div><p class="local-graph-hint" hidden>Ctrl or ⌘ + scroll to zoom, drag to move</p><a class="local-graph-open" href="/graph?focus=docs%2Fguide.md">Open in the full graph</a></section>',
    );
  });

  // From a document the link opens the graph on that document; elsewhere on the whole graph.
  it("links the header to the graph, focused on the document being read", async () => {
    expect((await get("/doc/docs/guide.md")).body).toContain(
      '<a class="segment" href="/graph?focus=docs%2Fguide.md">Graph</a>',
    );
    expect((await get("/search?q=x")).body).toContain(
      '<a class="segment" href="/graph">Graph</a>',
    );
  });

  // The stored theme must be applied before the stylesheet paints anything, so the classic theme
  // script comes first. The switch is hidden for a page without script, and is a radio group with a
  // segment for every choice, so the stylesheet can mark the chosen one before any module has run.
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
      '<div class="theme-switch segmented" role="radiogroup" aria-label="Theme" hidden>',
    );
    const segments = [
      ...body.matchAll(
        /<button class="segment" type="button" role="radio" data-choice="([a-z]+)" title="([A-Za-z]+)" aria-label="\2"><svg /g,
      ),
    ].map((match) => `${match[1]}:${match[2]}`);
    expect(segments).toEqual(["system:Auto", "light:Light", "dark:Dark"]);
  });

  // The three sections are one segmented control of plain links, in one named navigation landmark,
  // so they work without script and a screen reader finds them as the page's sections.
  it("groups the section links into one navigation segment", async () => {
    const { body } = await get("/doc/docs/guide.md");
    expect(body).toContain(
      '<nav class="section-nav segmented" aria-label="Sections"><a class="segment" href="/graph?focus=docs%2Fguide.md">Graph</a><a class="segment" href="/dashboard">Dashboard</a><a class="segment" href="/config">Config</a></nav>',
    );
  });

  // Moving between the header's sections must leave the bar where it was. The pages are full loads,
  // so the only way to guarantee that is for every one of them to render the same header: a control
  // present on one and not another, or a label of another width, moves everything after it. The one
  // permitted difference is which link is marked as the current section.
  it("renders the same header on every section page, marking only its own link", async () => {
    const sections = {
      graph: "/graph",
      dashboard: "/dashboard",
      config: "/config",
    };
    const headers = new Map<string, string>();
    for (const [name, address] of Object.entries(sections)) {
      const header = /<header[\s\S]*?<\/header>/.exec(
        (await get(address)).body,
      )?.[0];
      expect(header, address).toBeDefined();
      const marked = [
        ...header!.matchAll(
          /<a class="segment" href="([^"]*)" aria-current="page">/g,
        ),
      ];
      expect(
        marked.map((match) => match[1]),
        address,
      ).toEqual([address]);
      headers.set(name, header!.replace(' aria-current="page"', ""));
    }
    expect(new Set(headers.values()).size).toBe(1);
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

  // Fetched by the page script, the counts and the panel appeared a moment after every page was
  // drawn and pushed the article down. Drawn into the page, they are there from its first frame, and
  // the tree says so, so the script does not ask for them again.
  it("draws the tree's counts and the findings panel into the page", async () => {
    await diagnosticsReady();
    const { body } = await get("/doc/README.md");
    expect(body).toContain(
      '<nav class="sidebar" aria-label="Documents" data-marked="findings">',
    );
    // What the page includes, so its event stream sends it what came after.
    expect(body).toMatch(
      /<meta name="wastech-events" content="[0-9a-f]{8}\.\d+">/,
    );
    expect(body).toContain(
      '<li data-findings=""><a href="/doc/README.md" title="README.md" aria-current="page"><span class="tree-name">README.md</span><span class="tree-badge tree-badge-error" title="1 error">1</span></a></li>',
    );
    // First in the article, above the document's own text.
    expect(body).toMatch(
      /<article class="markdown-body"><details class="diagnostics has-errors" open><summary><span class="diagnostics-title">wastech-mdlint: 1 error<\/span><\/summary><ul><li class="diagnostic diagnostic-error"><span class="diagnostic-severity">error<\/span><a class="diagnostic-rule" href="https:[^"]+" target="_blank" rel="noopener noreferrer">REF-001<\/a>/,
    );
    expect(body).toContain(
      '<a class="diagnostic-line" href="#fixture-home">line 5</a><button class="prompt-menu" type="button" hidden title="Copy a prompt that answers this finding" data-path="README.md" data-rule="REF-001" data-finding-line="5">Prompt</button>',
    );
    const clean = await get("/doc/docs/guide.md");
    expect(clean.body).not.toContain('class="diagnostics');
  });

  // After a lint the page script puts the server's panel in place of its own, so the panel has one
  // renderer: the answer is the very markup the page was drawn with, and nothing for a clean document.
  it("answers a document's panel as the page draws it", async () => {
    await diagnosticsReady();
    const page = (await get("/doc/README.md")).body;
    const drawn = /<details class="diagnostics[\s\S]*?<\/details>/.exec(
      page,
    )?.[0];
    const panel = await get("/api/diagnostics/panel?path=README.md");
    expect(panel.status).toBe(200);
    expect(panel.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(panel.body).toBe(drawn);
    for (const relPath of ["docs/guide.md", "nope.md"]) {
      const empty = await get(
        `/api/diagnostics/panel?path=${encodeURIComponent(relPath)}`,
      );
      expect(empty.status, relPath).toBe(200);
      expect(empty.body, relPath).toBe("");
    }
  });
});

// The route the "Prompt" menus fetch from. What the prompts say is core's; this pins that the page
// can reach them, and that a request names a finding only by what the page shows of it.
describe("fix prompts", () => {
  it("answers a finding with a prompt to copy", async () => {
    await diagnosticsReady();
    const response = await get(
      "/api/prompts?path=README.md&rule=REF-001&line=5",
    );
    expect(response.status).toBe(200);
    const { prompts } = JSON.parse(response.body) as {
      prompts: { strategy: string; label: string; text: string }[];
    };
    expect(prompts.map(({ strategy, label }) => ({ strategy, label }))).toEqual(
      [{ strategy: "fix", label: "Fix it" }],
    );
    expect(prompts[0]!.text).toContain(
      "# Fix the wastech-mdlint findings in `README.md`",
    );
    expect(prompts[0]!.text).toContain("- **error** `REF-001` (line 5):");
  });

  it("refuses a finding that is not reported and a path outside the corpus", async () => {
    await diagnosticsReady();
    expect(
      (await get("/api/prompts?path=README.md&rule=REF-002&line=5")).status,
    ).toBe(409);
    expect((await get("/api/prompts?path=secret.txt")).status).toBe(404);
    expect((await get("/api/prompts?path=..%2Fsecret.txt")).status).toBe(404);
  });

  it("puts a prompt button on each dashboard row with findings", async () => {
    await diagnosticsReady();
    const { body } = await get("/dashboard");
    expect(body).toContain(
      '<button class="prompt-menu" type="button" hidden data-path="README.md"',
    );
    expect(body).not.toContain('data-path="docs/guide.md"');
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
      '<a class="segment" href="/dashboard">Dashboard</a>',
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
