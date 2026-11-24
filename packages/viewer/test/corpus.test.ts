import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
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

  // `exclude` and `.gitignore` are patterns over a path, and a link names one path while a symlink
  // makes it read another. Judged by the name alone, `docs/env.txt` linking to `../.env` passed every
  // pattern and served the ignored `.env`. The patterns are tested against the file really reached.
  it("refuses a symlinked file that reaches an ignored one", async (context) => {
    const { root } = await load({
      ".gitignore": ".env\n",
      ".env": "SECRET=1\n",
      "images/pic.png": "png",
      "README.md": "# Home\n",
    });
    const linked =
      (await fileLink("../.env", path.join(root, "docs", "env.txt"))) &&
      (await fileLink("../images/pic.png", path.join(root, "docs", "pic.png")));
    // Windows refuses a file symlink to an account without the privilege to create one; the
    // directory-link test below runs there through a junction instead.
    if (!linked) {
      context.skip();
    }
    await write(
      root,
      "README.md",
      "# Home\n\n[env](docs/env.txt) [pic](docs/pic.png)\n",
    );
    const corpus = await Corpus.load({ cwd: root });
    expect(corpus.isLinkedFile("docs/env.txt")).toBe(false);
    expect(await corpus.resolveFile("docs/env.txt")).toBeUndefined();
    // A symlink to a file the viewer would serve anyway is still served.
    expect(corpus.isLinkedFile("docs/pic.png")).toBe(true);
  });

  // The same through a linked folder, which every system can create — a junction where Windows
  // refuses a directory symlink. Re-pointing the link after the page was built must not serve what it
  // now reaches either: the check is made again as the file is served.
  it("refuses a file reached through a linked folder that an exclude or .gitignore covers", async () => {
    const { root } = await load({
      "wastech-mdlint.config.json": JSON.stringify({
        include: ["**/*.md"],
        exclude: ["private/**"],
      }),
      ".gitignore": "secrets/\n",
      "private/key.txt": "key",
      "images/pic.png": "png",
      "secrets/pic.png": "not an image",
      "README.md": "# Home\n",
    });
    await folderLink(
      path.join(root, "private"),
      path.join(root, "docs", "vault"),
    );
    await folderLink(
      path.join(root, "images"),
      path.join(root, "docs", "media"),
    );
    await write(
      root,
      "README.md",
      "# Home\n\n[key](docs/vault/key.txt) [pic](docs/media/pic.png)\n",
    );
    const corpus = await Corpus.load({ cwd: root });
    expect(corpus.isLinkedFile("docs/vault/key.txt")).toBe(false);
    expect(corpus.isLinkedFile("docs/media/pic.png")).toBe(true);
    expect(await corpus.resolveFile("docs/media/pic.png")).toBeDefined();

    await unlink(path.join(root, "docs", "media"));
    await folderLink(
      path.join(root, "secrets"),
      path.join(root, "docs", "media"),
    );
    expect(await corpus.resolveFile("docs/media/pic.png")).toBeUndefined();
  });

  // Patterns compare letter case exactly; the usual Windows and macOS file systems do not. There
  // `.GIT/config` passed the default `.git` exclude and opened `.git/config`, and `.ENV` passed a
  // `.gitignore` naming `.env`. A path that reaches a file only under another case is refused, so a
  // link means what it means on a case-sensitive system, where none of these exist at all.
  it("refuses a path that reaches a file only under another letter case", async () => {
    const { root } = await load({
      "wastech-mdlint.config.json": JSON.stringify({
        include: ["**/*.md"],
        exclude: ["private/**"],
      }),
      ".git/config": "[core]\n",
      ".gitignore": ".env\n",
      ".env": "SECRET=1\n",
      "private/key.txt": "key",
      "images/pic.png": "png",
      "README.md":
        "# Home\n\n[cfg](.GIT/config) [env](.ENV) [key](PRIVATE/key.txt) [pic](IMAGES/pic.png)\n",
    });
    // Asked of the file system the test runs on, not inferred from the platform's name: a Linux
    // checkout can sit on a case-insensitive volume, and a macOS one on a case-sensitive one.
    if (await caseInsensitive(root)) {
      // The premise: here each spelling does open the real file.
      expect((await stat(path.join(root, ".GIT", "config"))).isFile()).toBe(
        true,
      );
    }
    const corpus = await Corpus.load({ cwd: root });
    for (const relPath of [
      ".GIT/config",
      ".ENV",
      "PRIVATE/key.txt",
      "IMAGES/pic.png",
    ]) {
      expect(corpus.isLinkedFile(relPath), relPath).toBe(false);
      expect(await corpus.resolveFile(relPath), relPath).toBeUndefined();
    }
  });
});

// A file symlink at `linkPath`, or `false` where the system refuses to create one.
async function fileLink(target: string, linkPath: string): Promise<boolean> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  try {
    await symlink(target, linkPath, "file");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      return false;
    }
    throw error;
  }
}

// A link to a folder: a directory symlink, or a junction where Windows refuses the symlink to an
// account without the privilege. A junction needs an absolute target, so both take one.
async function folderLink(target: string, linkPath: string): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  try {
    await symlink(target, linkPath, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") {
      throw error;
    }
    await symlink(target, linkPath, "junction");
  }
}

async function caseInsensitive(dir: string): Promise<boolean> {
  await writeFile(path.join(dir, "case-probe"), "", "utf8");
  try {
    return (
      (await stat(path.join(dir, "CASE-PROBE")).catch(() => undefined)) !==
      undefined
    );
  } finally {
    await rm(path.join(dir, "case-probe"));
  }
}

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
