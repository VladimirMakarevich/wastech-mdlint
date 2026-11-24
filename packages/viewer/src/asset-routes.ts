import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sendText } from "./http-send.js";
import { decodeRequestPath } from "./request-path.js";
import { assetHeaders } from "./security.js";

// The viewer's own files and the scripts it serves from installed packages. Nothing here is read
// from the repository being viewed: each name a request may reach is fixed or matches a pattern that
// can only name a file the viewer itself ships.

// The viewer's own files. Both paths climb one level first, so they resolve to the same files from
// `dist/` when installed and from `src/` when the tests load the sources.
const STYLESHEET = fileURLToPath(
  new URL("../assets/viewer.css", import.meta.url),
);
// The tab icon, so a viewer tab stands out among the others a reader has open.
const FAVICON = fileURLToPath(
  new URL("../assets/favicon.ico", import.meta.url),
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

export async function sendPackageAsset(
  request: IncomingMessage,
  response: ServerResponse,
  name: string,
): Promise<void> {
  const asset =
    name === "viewer.css"
      ? { file: STYLESHEET, type: "text/css; charset=utf-8" }
      : name === "favicon.ico"
        ? { file: FAVICON, type: "image/x-icon" }
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

export async function sendMermaid(
  request: IncomingMessage,
  response: ServerResponse,
  encoded: string,
): Promise<void> {
  const relPath = decodeRequestPath(encoded);
  const allowed =
    relPath === MERMAID_ENTRY ||
    (relPath?.startsWith(MERMAID_CHUNKS) === true && relPath.endsWith(".mjs"));
  await sendScript(
    request,
    response,
    allowed ? path.join(MERMAID_DIST, ...relPath.split("/")) : undefined,
  );
}

export function sendEcharts(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  return sendScript(request, response, ECHARTS_SCRIPT);
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
