import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ElementContent } from "hast";
import { h } from "hastscript";

import type { ParsedDocument } from "@wastech-mdlint/core";

import { Corpus } from "./corpus.js";
import { Diagnostics } from "./diagnostics.js";
import { highlight, languageForPath } from "./highlight.js";
import { rawHtml, renderPage, type PageParams } from "./page.js";
import {
  renderDocument,
  documentHref,
  type RenderedDocument,
} from "./render-document.js";
import { decodeRequestPath } from "./request-path.js";
import { DocumentSearch } from "./search.js";
import {
  assetHeaders,
  isAllowedHostHeader,
  isForeignRequest,
  pageHeaders,
  rawFileHeaders,
} from "./security.js";
import { watchRepository } from "./watch.js";

export type ViewerOptions = {
  cwd: string;
  configPath?: string;
  host: string;
  port: number;
  // An explicit port is a promise to the user; only the default may move to the next free one.
  portExplicit: boolean;
  watch: boolean;
};

export type RunningViewer = {
  url: string;
  documentCount: number;
  close(): Promise<void>;
};

// How many ports above the default to try before giving up, so a second viewer started beside a
// first one simply lands next to it.
const PORT_ATTEMPTS = 20;

// A source file larger than this is a generated or vendored file, not something a document links to
// for a reader; highlighting it would stall the page for nothing.
const MAX_SOURCE_BYTES = 1024 * 1024;

// Repository files served as-is. Everything else a document links to is shown as highlighted source,
// so no repository file is ever handed to the browser as HTML or script.
const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

// The viewer's own files. Both paths climb one level first, so they resolve to the same files from
// `dist/` when installed and from `src/` when the tests load the sources.
const STYLESHEET = fileURLToPath(
  new URL("../assets/viewer.css", import.meta.url),
);
const CLIENT_DIR = fileURLToPath(new URL("../dist/client/", import.meta.url));
// The page scripts are the compiled client modules, which import one another by file name. A name
// is one lowercase segment ending in `.js`, so a request can reach nothing but a compiled module.
const CLIENT_SCRIPT_NAME = /^[a-z][a-z0-9-]*\.js$/;

// Mermaid is served from the installed package rather than a CDN: the viewer works offline, behind
// a proxy, and under a CSP that allows scripts from this origin only. Located through `require`
// resolution rather than `import.meta.resolve`, which test runners that transform modules do not
// provide; the package's `default` export condition makes both land on the same file.
const MERMAID_DIST = path.dirname(
  createRequire(import.meta.url).resolve("mermaid"),
);
const MERMAID_ENTRY = "mermaid.esm.min.mjs";
const MERMAID_CHUNKS = "chunks/mermaid.esm.min/";
// ECharts, for the same reasons. Its browser build is one self-contained module, so that one file
// is the only thing served from the package; any other name under the prefix is not looked up.
const ECHARTS_SCRIPT = path.join(
  path.dirname(createRequire(import.meta.url).resolve("echarts")),
  "echarts.esm.min.mjs",
);

export async function startViewer(
  options: ViewerOptions,
): Promise<RunningViewer> {
  const corpus = await Corpus.load({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  const siteName = path.basename(corpus.rootDir) || "repository";
  const bound = { host: options.host, port: options.port };
  const eventClients = new Set<ServerResponse>();
  const search = new DocumentSearch();
  const diagnostics = new Diagnostics();

  // Keyed by the document object, which the corpus replaces whenever the file changes, so an edit
  // misses the cache without any explicit invalidation. Link targets also depend on which other
  // files exist, so a change to the set of documents starts a fresh cache.
  let rendered = new WeakMap<ParsedDocument, Promise<RenderedDocument>>();

  function render(document: ParsedDocument): Promise<RenderedDocument> {
    let pending = rendered.get(document);
    if (pending === undefined) {
      pending = renderDocument(document, (fromPath, target, isImage) =>
        corpus.resolve(fromPath, target, isImage),
      );
      rendered.set(document, pending);
      // A failed render is not cached, so fixing the file (or a transient read error) recovers.
      pending.catch(() => rendered.delete(document));
    }
    return pending;
  }

  function page(
    params: Omit<PageParams, "siteName" | "documentPaths">,
  ): string {
    return renderPage({
      ...params,
      siteName,
      documentPaths: [...corpus.documents.keys()],
    });
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isAllowedHostHeader(request.headers.host, bound)) {
      sendText(
        response,
        403,
        "Forbidden: this server answers only to localhost.",
      );
      return;
    }
    if (
      isForeignRequest(
        request.headers as Parameters<typeof isForeignRequest>[0],
      )
    ) {
      sendText(response, 403, "Forbidden: cross-site request.");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(response, 405, "Method not allowed: the viewer is read-only.");
      return;
    }

    const [target = "", queryString = ""] = (request.url ?? "")
      .split("#", 1)[0]!
      .split("?", 2);
    const params = new URLSearchParams(queryString);
    if (target === "/") {
      redirectToIndex(response);
    } else if (target === "/search") {
      sendSearchPage(request, response, params.get("q") ?? "");
    } else if (target === "/api/search") {
      const query = params.get("q") ?? "";
      sendJson(response, {
        query,
        results: search.search(corpus.documents, query),
      });
    } else if (target === "/api/diagnostics") {
      sendDiagnostics(response, params);
    } else if (target === "/events") {
      openEventStream(request, response);
    } else if (target === "/favicon.ico") {
      response.writeHead(204, assetHeaders()).end();
    } else if (target.startsWith("/assets/")) {
      await sendPackageAsset(
        request,
        response,
        target.slice("/assets/".length),
      );
    } else if (target === "/vendor/echarts/echarts.esm.min.mjs") {
      await sendScript(request, response, ECHARTS_SCRIPT);
    } else if (target.startsWith("/vendor/mermaid/")) {
      await sendMermaid(
        request,
        response,
        target.slice("/vendor/mermaid/".length),
      );
    } else if (target.startsWith("/doc/")) {
      await sendDocument(
        request,
        response,
        decodeRequestPath(target.slice("/doc/".length)),
      );
    } else if (target.startsWith("/file/")) {
      await sendLinkedFile(
        request,
        response,
        decodeRequestPath(target.slice("/file/".length)),
      );
    } else {
      sendNotFound(request, response, "There is no page at this address.");
    }
  }

  function redirectToIndex(response: ServerResponse): void {
    const index = ["README.md", "readme.md", "index.md"].find((name) =>
      corpus.documents.has(name),
    );
    const first = index ?? corpus.documents.keys().next().value;
    if (first === undefined) {
      sendHtml(
        response,
        200,
        page({
          title: "No documents",
          article: [
            h("h1", "No documents"),
            h(
              "p",
              "The configured include patterns match no Markdown files in this directory.",
            ),
          ],
        }),
      );
      return;
    }
    response
      .writeHead(302, { ...pageHeaders(), Location: documentHref(first) })
      .end();
  }

  async function sendDocument(
    request: IncomingMessage,
    response: ServerResponse,
    relPath: string | undefined,
  ): Promise<void> {
    const document =
      relPath === undefined ? undefined : corpus.documents.get(relPath);
    if (relPath === undefined || document === undefined) {
      sendNotFound(
        request,
        response,
        "This path is not a document in the corpus. The viewer shows the Markdown files the wastech-mdlint config includes.",
      );
      return;
    }
    const { html, title } = await render(document);
    sendHtml(
      response,
      200,
      page({
        title,
        displayPath: relPath,
        documentPath: relPath,
        article: rawHtml(html),
        headings: document.headings,
        backlinks: corpus.backlinks(relPath),
        frontmatter: document.frontmatter,
      }),
      request.method === "HEAD",
    );
  }

  async function sendLinkedFile(
    request: IncomingMessage,
    response: ServerResponse,
    relPath: string | undefined,
  ): Promise<void> {
    const absolutePath =
      relPath !== undefined && corpus.isLinkedFile(relPath)
        ? await corpus.resolveFile(relPath)
        : undefined;
    if (relPath === undefined || absolutePath === undefined) {
      sendNotFound(
        request,
        response,
        "The viewer serves only the repository files a document links to, and no document links here.",
      );
      return;
    }
    const extension = path.extname(relPath).slice(1).toLowerCase();
    const imageType = IMAGE_TYPES[extension];
    if (imageType !== undefined) {
      const bytes = await readFile(absolutePath);
      response.writeHead(200, {
        ...rawFileHeaders(),
        "Content-Type": imageType,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
      return;
    }

    const { size } = await stat(absolutePath);
    let article: ElementContent[];
    if (size > MAX_SOURCE_BYTES) {
      article = [
        h("h1", relPath),
        h("p", "This file is too large to display."),
      ];
    } else {
      const bytes = await readFile(absolutePath);
      // A NUL byte in the first block is the same heuristic git uses to call a file binary.
      if (bytes.subarray(0, 8000).includes(0)) {
        article = [
          h("h1", relPath),
          h("p", "This is a binary file and cannot be displayed."),
        ];
      } else {
        const code = await highlight(
          bytes.toString("utf8"),
          languageForPath(relPath),
          {
            lineAnchors: true,
          },
        );
        article = [h("h1.source-title", relPath), h("div.source-view", [code])];
      }
    }
    sendHtml(
      response,
      200,
      page({ title: relPath, article, displayPath: relPath }),
      request.method === "HEAD",
    );
  }

  async function sendPackageAsset(
    request: IncomingMessage,
    response: ServerResponse,
    name: string,
  ): Promise<void> {
    const asset =
      name === "viewer.css"
        ? { file: STYLESHEET, type: "text/css; charset=utf-8" }
        : CLIENT_SCRIPT_NAME.test(name)
          ? {
              file: path.join(CLIENT_DIR, name),
              type: "text/javascript; charset=utf-8",
            }
          : undefined;
    const body =
      asset === undefined
        ? undefined
        : await readFile(asset.file).catch(() => undefined);
    if (asset === undefined || body === undefined) {
      sendText(response, 404, "Not found.");
      return;
    }
    response.writeHead(200, { ...assetHeaders(), "Content-Type": asset.type });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function sendSearchPage(
    request: IncomingMessage,
    response: ServerResponse,
    query: string,
  ): void {
    const hits = search.search(corpus.documents, query);
    const article: ElementContent[] =
      query.trim().length === 0
        ? [h("h1", "Search"), h("p", "Type a word or phrase to search for.")]
        : [
            h("h1", `Search: ${query}`),
            hits.length === 0
              ? h("p", "No documents match.")
              : h(
                  "ol.search-page-results",
                  hits.map((hit) =>
                    h("li", [
                      h("a.search-hit-title", { href: hit.href }, [
                        ...markTerms(hit.title, hit.terms),
                      ]),
                      h("div.search-hit-path", hit.path),
                      h("p.search-hit-snippet", [
                        ...markTerms(hit.snippet, hit.terms),
                      ]),
                    ]),
                  ),
                ),
          ];
    sendHtml(
      response,
      200,
      page({ title: query ? `Search: ${query}` : "Search", article, query }),
      request.method === "HEAD",
    );
  }

  function sendDiagnostics(
    response: ServerResponse,
    params: URLSearchParams,
  ): void {
    if (!diagnostics.ready) {
      sendJson(response, { status: "pending" });
      return;
    }
    const relPath = params.get("path");
    if (relPath === null) {
      sendJson(response, { status: "ready", files: diagnostics.summary() });
      return;
    }
    const document = corpus.documents.get(relPath);
    sendJson(response, {
      status: "ready",
      findings: document === undefined ? [] : diagnostics.findings(document),
    });
  }

  async function sendMermaid(
    request: IncomingMessage,
    response: ServerResponse,
    encoded: string,
  ): Promise<void> {
    const relPath = decodeRequestPath(encoded);
    const allowed =
      relPath === MERMAID_ENTRY ||
      (relPath?.startsWith(MERMAID_CHUNKS) === true &&
        relPath.endsWith(".mjs"));
    await sendScript(
      request,
      response,
      allowed && relPath !== undefined
        ? path.join(MERMAID_DIST, ...relPath.split("/"))
        : undefined,
    );
  }

  // A script from an installed package; `file` is undefined when the request named nothing the
  // caller allows.
  async function sendScript(
    request: IncomingMessage,
    response: ServerResponse,
    file: string | undefined,
  ): Promise<void> {
    const body =
      file === undefined
        ? undefined
        : await readFile(file).catch(() => undefined);
    if (body === undefined) {
      sendText(response, 404, "Not found.");
      return;
    }
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/javascript; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function sendNotFound(
    request: IncomingMessage,
    response: ServerResponse,
    message: string,
  ): void {
    sendHtml(
      response,
      404,
      page({
        title: "Not found",
        article: [h("h1", "Not found"), h("p", message)],
      }),
      request.method === "HEAD",
    );
  }

  function openEventStream(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    // Reconnect quickly after a restart, so the page notices the new server within a second.
    response.write("retry: 1000\n\n");
    eventClients.add(response);
    request.on("close", () => eventClients.delete(response));
  }

  function broadcast(name: string, data: unknown): void {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      client.write(message);
    }
  }

  // Runs on the event loop: `lintContext` is synchronous and takes a few hundred milliseconds on a
  // corpus of hundreds of documents, which is cheaper than handing the corpus to a worker and short
  // enough that the requests it holds up do not notice.
  function relint(): void {
    try {
      diagnostics.update(corpus.lint());
      broadcast("diagnostics", {});
    } catch (error) {
      // The previous results stay; the terminal says why they did not refresh.
      process.stderr.write(
        `wastech-mdlint-viewer: linting failed: ${(error as Error).message}\n`,
      );
    }
  }

  // Idle connections are closed by some proxies and by browsers after a while; a comment line every
  // so often keeps the stream open without the client seeing an event.
  const keepAlive = setInterval(() => {
    for (const client of eventClients) {
      client.write(": keep-alive\n\n");
    }
  }, 25_000);
  keepAlive.unref();

  // Changes are applied one batch at a time, in order: two overlapping updates could otherwise
  // finish out of order and leave the older corpus in place.
  let updates = Promise.resolve();
  const stopWatching = options.watch
    ? watchRepository(corpus.rootDir, (paths) => {
        updates = updates
          .then(async () => {
            const change = await corpus.applyChanges(paths);
            if (change.structural) {
              rendered = new WeakMap();
            }
            if (change.changed.length > 0 || change.structural) {
              broadcast("change", {
                paths: change.changed,
                structural: change.structural,
              });
              relint();
            }
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `wastech-mdlint-viewer: could not apply changes: ${(error as Error).message}\n`,
            );
          });
      })
    : () => {};

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      // Logged locally with the request path only; the response stays generic so an error message
      // carrying an absolute path never reaches the page.
      process.stderr.write(
        `wastech-mdlint-viewer: ${request.url ?? ""}: ${(error as Error).message}\n`,
      );
      if (!response.headersSent) {
        sendText(
          response,
          500,
          "The viewer could not build this page; see the terminal for details.",
        );
      } else {
        response.end();
      }
    });
  });

  bound.port = await listen(
    server,
    options.host,
    options.port,
    options.portExplicit,
  );
  // The first lint runs once the server is answering, so the address is printed without waiting for
  // it; pages opened before it finishes show their findings when the `diagnostics` event arrives.
  const initialLint = setImmediate(relint);

  return {
    url: `http://${displayHost(options.host)}:${bound.port}/`,
    documentCount: corpus.documents.size,
    async close() {
      clearImmediate(initialLint);
      stopWatching();
      clearInterval(keepAlive);
      for (const client of eventClients) {
        client.end();
      }
      eventClients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function listen(
  server: Server,
  host: string,
  port: number,
  portExplicit: boolean,
): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = port === 0 ? 0 : port + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      const inUse = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (
        !inUse ||
        portExplicit ||
        port === 0 ||
        attempt + 1 >= PORT_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}

// The address to print. A wildcard bind is reachable at localhost too, and that is the address the
// Host check accepts by name.
function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "localhost";
  }
  return host.includes(":") ? `[${host}]` : host;
}

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  headOnly = false,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(headOnly ? undefined : html);
}

function sendJson(response: ServerResponse, data: unknown): void {
  response.writeHead(200, {
    ...pageHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

// The server-rendered twin of the client's highlighting: matched words wrapped in <mark>, built as
// hast so the text around them is escaped.
function markTerms(text: string, terms: readonly string[]): ElementContent[] {
  const escaped = terms
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return [{ type: "text", value: text }];
  }
  return text
    .split(new RegExp(`(${escaped.join("|")})`, "giu"))
    .map((part, index) =>
      index % 2 === 0 ? { type: "text", value: part } : h("mark", part),
    );
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}
