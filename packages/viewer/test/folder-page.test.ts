import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { Corpus } from "../src/corpus.js";
import { renderDocument } from "../src/render-document.js";
import { startViewer, type RunningViewer } from "../src/server.js";

// The server loads from source here, but the page script it serves is only ever compiled output.
assertBuilt(
  fileURLToPath(new URL("../dist/client/viewer.js", import.meta.url)),
  fileURLToPath(new URL("../src/client/viewer.ts", import.meta.url)),
);

// A link to a folder is one REF-001 accepts whenever the folder exists. The viewer opened such a link
// only on the folder's README and marked every other one missing - a release-notes folder holding one
// subfolder per version, and no README, read as a broken link on a page the linter called clean.
// These pin the other answer: a folder that holds documents opens as a listing of them.

let workDir: string;
let corpus: Corpus;
let viewer: RunningViewer;
let port: number;

const FILES: Record<string, string> = {
  "README.md": [
    "# Home",
    "",
    "Read [the notes](notes/), [one year](notes/2024), [the docs](docs/) and [the pictures](assets/).",
    "",
    '<a href="notes/">notes as HTML</a>',
    "",
  ].join("\n"),
  "notes/top.md": "# Top note\n",
  "notes/2024/a.md": "# Entry A\n",
  "notes/2024/b.md": "# Entry B\n",
  "notes/2024/untitled.md": "No heading here.\n",
  "docs/README.md": "# Docs\n",
  "assets/pic.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  "wastech-mdlint.config.json": '{ "include": ["**/*.md"] }\n',
};

function get(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: rawPath },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (body += chunk));
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, body }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-folder-"));
  for (const [relPath, text] of Object.entries(FILES)) {
    const absolute = path.join(workDir, ...relPath.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, text);
  }
  corpus = await Corpus.load({ cwd: workDir });
  viewer = await startViewer({
    cwd: workDir,
    host: "127.0.0.1",
    port: 0,
    portExplicit: true,
    watch: false,
    // Not a repository; the ceiling keeps git from finding one around the temporary directory.
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

describe("resolving a folder link", () => {
  it("opens a folder without a README as a listing, with or without a trailing slash", () => {
    expect(corpus.resolve("README.md", "notes/", false)).toEqual({
      kind: "folder",
      path: "notes",
    });
    expect(corpus.resolve("README.md", "notes/2024", false)).toEqual({
      kind: "folder",
      path: "notes/2024",
    });
  });

  it("still opens a folder with a README on the README", () => {
    expect(corpus.resolve("README.md", "docs/", false)).toEqual({
      kind: "document",
      path: "docs/README.md",
    });
  });

  // Nothing in it is a document, and the viewer lists only what the corpus holds.
  it("leaves a folder holding no documents missing", () => {
    expect(corpus.resolve("README.md", "assets/", false)).toEqual({
      kind: "missing",
    });
  });

  it("resolves the same folder written as raw HTML", async () => {
    expect(
      await corpus.resolveEmbedded(
        corpus.documents.get("README.md")!,
        "notes/",
        false,
      ),
    ).toEqual({ kind: "folder", path: "notes" });
  });

  it("points the rendered link at the listing, not marked missing", async () => {
    const document = corpus.documents.get("README.md")!;
    const { html } = await renderDocument(document, {
      resolve: (fromPath, target, isImage) =>
        corpus.resolve(fromPath, target, isImage),
      resolveEmbedded: (target, isImage) =>
        corpus.resolveEmbedded(document, target, isImage),
    });
    expect(html).toContain('<a href="/folder/notes/">the notes</a>');
    expect(html).toContain('<a href="/folder/notes/2024/">one year</a>');
    expect(html).toContain('<a href="/folder/notes/">notes as HTML</a>');
    expect(html).toMatch(/<a href="assets\/" class="link-missing"/);
  });
});

describe("the folder page", () => {
  it("lists the subfolders first, then the documents directly in the folder", async () => {
    const { status, body } = await get("/folder/notes/");
    expect(status).toBe(200);
    const listing = /<ul class="folder-listing">([\s\S]*?)<\/ul>/.exec(
      body,
    )?.[1];
    expect(listing).toBe(
      '<li class="folder-entry-folder"><a href="/folder/notes/2024/">2024/</a></li>' +
        '<li class="folder-entry-document"><a href="/doc/notes/top.md">Top note</a> <span class="folder-entry-name">top.md</span></li>',
    );
    expect(body).toContain('href="/graph?folder=notes"');
    expect(body).toContain('href="/dashboard?folder=notes"');
  });

  it("answers the address without its trailing slash too", async () => {
    expect((await get("/folder/notes/2024")).status).toBe(200);
  });

  it("names a document without a heading by its file name, once", async () => {
    const { body } = await get("/folder/notes/2024/");
    expect(body).toContain(
      '<li class="folder-entry-document"><a href="/doc/notes/2024/untitled.md">untitled.md</a></li>',
    );
    expect(body).toContain(
      '<a href="/doc/notes/2024/a.md">Entry A</a> <span class="folder-entry-name">a.md</span>',
    );
  });

  it("links each folder above back to its own listing", async () => {
    const { body } = await get("/folder/notes/2024/");
    expect(body).toContain(
      '<nav class="folder-crumbs" aria-label="Folders"><a href="/folder/">/</a><a href="/folder/notes/">notes/</a><span aria-current="page">2024/</span></nav>',
    );
  });

  it("lists the root", async () => {
    const { status, body } = await get("/folder/");
    expect(status).toBe(200);
    expect(body).toContain('<a href="/folder/notes/">notes/</a>');
    expect(body).toContain('<a href="/doc/README.md">Home</a>');
  });

  // The folder name is only compared with the corpus's own folders, so a directory holding no
  // documents, or a path leaving the repository, is not a listing anyone can ask for.
  it("refuses a folder without documents and a path that leaves the repository", async () => {
    expect((await get("/folder/assets/")).status).toBe(404);
    expect((await get("/folder/nope/")).status).toBe(404);
    expect((await get("/folder/../")).status).toBe(404);
    expect((await get("/folder/notes//2024/")).status).toBe(404);
  });
});
