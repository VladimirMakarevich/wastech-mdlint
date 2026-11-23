import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Corpus } from "../src/corpus.js";
import { isRelevantChange } from "../src/watch.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function write(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(root, ...relPath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

// A repository of its own per test: these tests change files and watch what the corpus makes of it.
async function load(
  files: Record<string, string>,
  configPath?: string,
): Promise<{ root: string; corpus: Corpus }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-corpus-"));
  tempDirs.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    await write(root, relPath, content);
  }
  return { root, corpus: await Corpus.load({ cwd: root, configPath }) };
}

describe("linked files", () => {
  // A document linking to a file does not make it shareable. `.gitignore` counts even though the
  // config does not lint by it, because it is where a repository names what it keeps to itself; and
  // `exclude` keeps a file out of the viewer as it keeps it out of a run.
  it("serves a linked file only when no .gitignore or exclude covers it", async () => {
    const { corpus } = await load({
      "wastech-mdlint.config.json": JSON.stringify({
        include: ["**/*.md"],
        exclude: ["private/**"],
        respectGitignore: false,
      }),
      ".gitignore": ".env\n",
      ".env": "SECRET=1\n",
      "images/pic.png": "png",
      "private/key.txt": "key",
      "README.md":
        "# Home\n\n[env](.env) [pic](images/pic.png) [key](private/key.txt)\n",
    });
    expect(corpus.isLinkedFile("images/pic.png")).toBe(true);
    expect(corpus.isLinkedFile(".env")).toBe(false);
    expect(corpus.isLinkedFile("private/key.txt")).toBe(false);
    expect(corpus.resolve("README.md", ".env", false)).toEqual({
      kind: "missing",
    });
  });

  it("serves no Markdown file outside the corpus as a source file", async () => {
    const { corpus } = await load({
      "wastech-mdlint.config.json": JSON.stringify({
        include: ["docs/**/*.md"],
      }),
      "README.md": "# Outside the include\n",
      "docs/page.md": "# Page\n\n[home](../README.md)\n",
    });
    expect(corpus.documents.has("README.md")).toBe(false);
    expect(corpus.isLinkedFile("README.md")).toBe(false);
  });

  // Core reads no raw HTML, so these targets are found while the page renders; until then nothing
  // serves them, and the same rules decide what may be served.
  it("records a file a document's raw HTML embeds, by the same rules", async () => {
    const { corpus } = await load({
      ".gitignore": "secret.png\n",
      "images/pic.png": "png",
      "secret.png": "png",
      "docs/page.md": "# Page\n",
    });
    const page = corpus.documents.get("docs/page.md")!;
    expect(corpus.isLinkedFile("images/pic.png")).toBe(false);
    expect(
      await corpus.resolveEmbedded(page, "../images/pic.png", true),
    ).toEqual({ kind: "file", path: "images/pic.png" });
    expect(corpus.isLinkedFile("images/pic.png")).toBe(true);
    expect(await corpus.resolveEmbedded(page, "../secret.png", true)).toEqual({
      kind: "missing",
    });
    expect(corpus.isLinkedFile("secret.png")).toBe(false);
    expect(await corpus.resolveEmbedded(page, "../README.md", false)).toEqual({
      kind: "missing",
    });
  });
});

describe("applyChanges", () => {
  // The viewer's own Save writes this file, and with watching on it is the only thing that reloads
  // the corpus for the new config.
  it("reloads for a config passed with --config under any name", async () => {
    const { root, corpus } = await load(
      {
        "lint.jsonc": JSON.stringify({ rules: [{ rule: "REF-001" }] }),
        "README.md": "# Home\n",
      },
      "lint.jsonc",
    );
    expect(corpus.configuration.rules).toHaveLength(1);
    await write(
      root,
      "lint.jsonc",
      JSON.stringify({ rules: [{ rule: "REF-001" }, { rule: "REF-002" }] }),
    );
    expect(await corpus.applyChanges(["lint.jsonc"])).toEqual({
      changed: ["lint.jsonc"],
      structural: true,
    });
    expect(corpus.configuration.rules).toHaveLength(2);
  });

  // A watcher reports a renamed folder as the folder's two names and nothing for the documents inside.
  it("reloads when a folder of documents is renamed, reported as the folder alone", async () => {
    const { root, corpus } = await load({
      "README.md": "# Home\n",
      "docs/a.md": "# A\n",
      "docs/b.md": "# B\n",
    });
    await rename(path.join(root, "docs"), path.join(root, "guides"));
    const change = await corpus.applyChanges(["docs", "guides"]);
    expect(change.structural).toBe(true);
    expect([...corpus.documents.keys()].sort()).toEqual([
      "README.md",
      "guides/a.md",
      "guides/b.md",
    ]);
  });

  it("reloads for a folder moved in with documents in it", async () => {
    const { root, corpus } = await load({ "README.md": "# Home\n" });
    await write(root, "incoming/deep/new.md", "# New\n");
    expect((await corpus.applyChanges(["incoming"])).structural).toBe(true);
    expect(corpus.documents.has("incoming/deep/new.md")).toBe(true);
  });

  // Some platforms report a folder whenever a file inside it is created; a folder holding no new
  // document must not reload every open page each time a source file is saved.
  it("does not reload for an event on a folder that holds no new document", async () => {
    const { root, corpus } = await load({
      "README.md": "# Home\n",
      "docs/a.md": "# A\n",
      "src/app.ts": "export {};\n",
    });
    await write(root, "src/new.ts", "export {};\n");
    expect(await corpus.applyChanges(["src", "src/new.ts", "docs"])).toEqual({
      changed: [],
      structural: false,
    });
  });

  it("does not reload for a Markdown file the scope leaves out", async () => {
    const { root, corpus } = await load({
      "wastech-mdlint.config.json": JSON.stringify({
        include: ["**/*.md"],
        exclude: ["tasks/**"],
        respectGitignore: true,
      }),
      ".gitignore": "dist/\n",
      "README.md": "# Home\n",
    });
    await write(root, "tasks/plan.md", "# Plan\n");
    await write(root, "dist/generated.md", "# Generated\n");
    expect(
      await corpus.applyChanges(["tasks/plan.md", "dist/generated.md"]),
    ).toEqual({ changed: [], structural: false });
    expect(corpus.documents.has("tasks/plan.md")).toBe(false);
  });

  it("reloads for a new Markdown file the scope takes in", async () => {
    const { root, corpus } = await load({ "README.md": "# Home\n" });
    await write(root, "docs/added.md", "# Added\n");
    expect((await corpus.applyChanges(["docs/added.md"])).structural).toBe(
      true,
    );
    expect(corpus.documents.has("docs/added.md")).toBe(true);
  });

  // An image saved after the document that embeds it: the document is unchanged, but its page now
  // has something to show, so it is reported for its page to reload.
  it("reports the documents linking a file that appears, and again when it goes", async () => {
    const { root, corpus } = await load({
      "README.md": "# Home\n\n![flow](img/flow.png)\n",
      "docs/a.md": "# A\n",
    });
    expect(corpus.isLinkedFile("img/flow.png")).toBe(false);

    await write(root, "img/flow.png", "png");
    expect(await corpus.applyChanges(["img/flow.png"])).toEqual({
      changed: ["README.md"],
      structural: false,
    });
    expect(corpus.isLinkedFile("img/flow.png")).toBe(true);
    expect(corpus.resolve("README.md", "img/flow.png", true)).toEqual({
      kind: "file",
      path: "img/flow.png",
    });

    await rm(path.join(root, "img"), { recursive: true });
    // Reported as the folder alone, as a deleted folder is.
    expect(await corpus.applyChanges(["img"])).toEqual({
      changed: ["README.md"],
      structural: false,
    });
    expect(corpus.isLinkedFile("img/flow.png")).toBe(false);
  });

  it("reports a document whose raw HTML embeds a file that appears", async () => {
    const { root, corpus } = await load({ "README.md": "# Home\n" });
    const home = corpus.documents.get("README.md")!;
    expect(await corpus.resolveEmbedded(home, "logo.png", true)).toEqual({
      kind: "missing",
    });
    await write(root, "logo.png", "png");
    expect(await corpus.applyChanges(["logo.png"])).toEqual({
      changed: ["README.md"],
      structural: false,
    });
  });

  it("reports nothing for a file no document links to", async () => {
    const { root, corpus } = await load({
      "README.md": "# Home\n\n[app](src/app.ts)\n",
      "src/app.ts": "export {};\n",
    });
    await write(root, "src/other.ts", "export {};\n");
    expect(await corpus.applyChanges(["src/other.ts"])).toEqual({
      changed: [],
      structural: false,
    });
  });
});

describe("watcher filter", () => {
  // Names alone cannot say which paths matter — a `--config` file, an image, a folder — so only git's
  // database and installed dependencies are dropped before the corpus judges the rest.
  it("passes every path but git's database and installed dependencies", () => {
    expect(isRelevantChange("lint.jsonc")).toBe(true);
    expect(isRelevantChange("images/flow.png")).toBe(true);
    expect(isRelevantChange("docs")).toBe(true);
    expect(isRelevantChange(".git/index")).toBe(false);
    expect(isRelevantChange("packages/a/node_modules/x/README.md")).toBe(false);
  });
});
