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
      '<a href="/doc/docs/guide.md" aria-current="page">guide.md</a>',
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

  it("serves the page scripts and Mermaid from the package", async () => {
    for (const name of ["viewer.js", "theme.js", "search.js", "viewer.css"]) {
      expect((await get(`/assets/${name}`)).status, name).toBe(200);
    }
    const mermaid = await get("/vendor/mermaid/mermaid.esm.min.mjs");
    expect(mermaid.status).toBe(200);
    expect(mermaid.headers["content-type"]).toBe(
      "text/javascript; charset=utf-8",
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
    expect((await get("/doc/docs/added.md")).status).toBe(200);
  }, 15_000);
});
