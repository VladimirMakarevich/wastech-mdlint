import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cloneFolder,
  contentHash,
  type MarkChange,
  ReviewStore,
} from "../src/review-store.js";
import { defaultStateDir } from "../src/state-dir.js";

const COMMON_DIR = path.join(os.tmpdir(), "clone", ".git");

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      // A test that took write permission away gives it back first, or the folder cannot be removed.
      await chmod(dir, 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-state-"));
  dirs.push(dir);
  return dir;
}

// A host started in the clone's `docs/` folder, as the viewer may be: paths cross to the top level.
function store(
  dir: string,
  options: { lockWaitMs?: number } = {},
): ReviewStore {
  return new ReviewStore({
    stateDir: dir,
    commonDir: COMMON_DIR,
    keyOf: (relPath) => `docs/${relPath}`,
    ...options,
  });
}

function mark(relPath: string, text: string): MarkChange {
  return { kind: "mark", path: relPath, hash: contentHash(text), text };
}

async function statusOf(
  target: ReviewStore,
  entry: { path: string; oldPath?: string; text: string },
) {
  const read = await target.read();
  if (!read.ok) {
    throw new Error(read.message);
  }
  return read.marks.status({
    path: entry.path,
    ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
    hash: contentHash(entry.text),
  });
}

async function saved(target: ReviewStore, change: MarkChange): Promise<void> {
  const outcome = await target.update(change);
  if (!outcome.ok) {
    throw new Error(outcome.message);
  }
}

describe("contentHash", () => {
  it("hashes the text a reader sees, whatever its line endings or byte order mark", () => {
    const lf = "# Title\n\nText.\n";
    expect(contentHash("# Title\r\n\r\nText.\r\n")).toBe(contentHash(lf));
    expect(contentHash(`${String.fromCharCode(0xfeff)}${lf}`)).toBe(
      contentHash(lf),
    );
    expect(contentHash("# Title\n\nText!\n")).not.toBe(contentHash(lf));
  });
});

describe("defaultStateDir", () => {
  it("uses each platform's place for local state", () => {
    expect(
      defaultStateDir(
        "win32",
        { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        "C:\\Users\\me",
      ),
    ).toBe("C:\\Users\\me\\AppData\\Local\\wastech-mdlint\\viewer");
    expect(defaultStateDir("win32", {}, "C:\\Users\\me")).toBe(
      "C:\\Users\\me\\AppData\\Local\\wastech-mdlint\\viewer",
    );
    expect(defaultStateDir("darwin", {}, "/Users/me")).toBe(
      "/Users/me/Library/Application Support/wastech-mdlint/viewer",
    );
    expect(
      defaultStateDir("linux", { XDG_STATE_HOME: "/data/state" }, "/home/me"),
    ).toBe("/data/state/wastech-mdlint/viewer");
    expect(defaultStateDir("linux", {}, "/home/me")).toBe(
      "/home/me/.local/state/wastech-mdlint/viewer",
    );
  });

  it("ignores a relative XDG_STATE_HOME, as the XDG specification asks", () => {
    expect(
      defaultStateDir("linux", { XDG_STATE_HOME: "state" }, "/home/me"),
    ).toBe("/home/me/.local/state/wastech-mdlint/viewer");
  });
});

describe("cloneFolder", () => {
  it("names a clone's folder after it, with a hash of its git directory", () => {
    const folder = cloneFolder(path.join(os.tmpdir(), "my repo", ".git"));
    expect(folder).toMatch(/^my-repo-[0-9a-f]{16}$/);
    expect(cloneFolder(path.join(os.tmpdir(), "my repo", ".git"))).toBe(folder);
    expect(
      cloneFolder(path.join(os.tmpdir(), "other", "my repo", ".git")),
    ).not.toBe(folder);
    expect(cloneFolder(path.join(os.tmpdir(), "mirror.git"))).toMatch(
      /^mirror-[0-9a-f]{16}$/,
    );
    expect(cloneFolder(path.join(os.tmpdir(), "Проект", ".git"))).toMatch(
      /^repository-[0-9a-f]{16}$/,
    );
  });
});

describe("ReviewStore", () => {
  it("creates nothing to read, and reads no marks where none were made", async () => {
    const dir = await stateDir();
    const absent = path.join(dir, "not-yet");
    const read = await store(absent).read();
    expect(read.ok && [...read.marks.documents]).toEqual([]);
    await expect(stat(absent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("follows content: reviewed, changed since review, and unreviewed", async () => {
    const target = store(await stateDir());
    await saved(target, mark("guide.md", "v1\r\n"));
    expect(await statusOf(target, { path: "guide.md", text: "v1\n" })).toEqual({
      status: "reviewed",
    });
    expect(await statusOf(target, { path: "guide.md", text: "v2\n" })).toEqual({
      status: "changed",
      since: contentHash("v1\n"),
    });
    expect(await statusOf(target, { path: "other.md", text: "v2\n" })).toEqual({
      status: "unreviewed",
    });
    expect(await target.snapshot(contentHash("v1\n"))).toBe("v1\n");
  });

  it("keeps a renamed document with the same text reviewed, and finds a text reviewed under any path", async () => {
    const target = store(await stateDir());
    await saved(target, mark("old.md", "text\n"));
    expect(
      await statusOf(target, {
        path: "new.md",
        oldPath: "old.md",
        text: "text\n",
      }),
    ).toEqual({ status: "reviewed" });
    expect(await statusOf(target, { path: "copy.md", text: "text\n" })).toEqual(
      {
        status: "reviewed",
      },
    );
    expect(
      await statusOf(target, {
        path: "new.md",
        oldPath: "old.md",
        text: "edited\n",
      }),
    ).toEqual({ status: "changed", since: contentHash("text\n") });
  });

  it("counts a reviewed deletion for its own path only", async () => {
    const target = store(await stateDir());
    await saved(target, mark("gone.md", ""));
    expect(await statusOf(target, { path: "gone.md", text: "" })).toEqual({
      status: "reviewed",
    });
    expect(await statusOf(target, { path: "also-gone.md", text: "" })).toEqual({
      status: "unreviewed",
    });
  });

  it("remembers earlier versions, so a branch with a text reviewed before finds it reviewed", async () => {
    const target = store(await stateDir());
    await saved(target, mark("guide.md", "on the feature branch\n"));
    await saved(target, mark("guide.md", "on another branch\n"));
    expect(
      await statusOf(target, {
        path: "guide.md",
        text: "on the feature branch\n",
      }),
    ).toEqual({ status: "reviewed" });
    expect(
      await statusOf(target, { path: "guide.md", text: "third\n" }),
    ).toEqual({
      status: "changed",
      since: contentHash("on another branch\n"),
    });
  });

  it("keys paths from the work tree's top level, and writes the same marks the same way", async () => {
    const dir = await stateDir();
    const target = store(dir);
    await saved(target, mark("b.md", "b\n"));
    await saved(target, mark("a.md", "a\n"));
    const index = await readFile(
      path.join(target.directory, "review.json"),
      "utf8",
    );
    expect(JSON.parse(index)).toEqual({
      format: 1,
      repository: COMMON_DIR,
      documents: {
        "docs/a.md": [contentHash("a\n")],
        "docs/b.md": [contentHash("b\n")],
      },
    });
    expect(index.indexOf('"docs/a.md"')).toBeLessThan(
      index.indexOf('"docs/b.md"'),
    );
    expect(target.directory).toBe(path.join(dir, cloneFolder(COMMON_DIR)));
  });

  it("unmarks a text under every path, and drops the texts no mark refers to", async () => {
    const target = store(await stateDir());
    await saved(target, mark("one.md", "shared\n"));
    await saved(target, mark("two.md", "shared\n"));
    await saved(target, mark("three.md", "own\n"));
    await saved(target, {
      kind: "unmark",
      path: "one.md",
      hash: contentHash("shared\n"),
    });
    expect(
      await statusOf(target, { path: "two.md", text: "shared\n" }),
    ).toEqual({
      status: "unreviewed",
    });
    expect(await readdir(path.join(target.directory, "texts"))).toEqual([
      `${contentHash("own\n")}.md`,
    ]);
  });

  it("forgets every version of the documents a reset names", async () => {
    const target = store(await stateDir());
    await saved(target, mark("guide.md", "v1\n"));
    await saved(target, mark("guide.md", "v2\n"));
    await saved(target, mark("kept.md", "kept\n"));
    await saved(target, {
      kind: "reset",
      documents: [{ path: "guide.md", hash: contentHash("v3\n") }],
    });
    expect(await statusOf(target, { path: "guide.md", text: "v3\n" })).toEqual({
      status: "unreviewed",
    });
    expect(await statusOf(target, { path: "kept.md", text: "kept\n" })).toEqual(
      {
        status: "reviewed",
      },
    );
    expect(await readdir(path.join(target.directory, "texts"))).toEqual([
      `${contentHash("kept\n")}.md`,
    ]);
  });

  it("keeps a few versions per path, not every one ever reviewed", async () => {
    const target = store(await stateDir());
    for (let version = 1; version <= 12; version += 1) {
      await saved(target, mark("guide.md", `v${String(version)}\n`));
    }
    expect(
      await statusOf(target, { path: "guide.md", text: "v1\n" }),
    ).toMatchObject({
      status: "changed",
    });
    expect(await statusOf(target, { path: "guide.md", text: "v3\n" })).toEqual({
      status: "reviewed",
    });
    expect(await readdir(path.join(target.directory, "texts"))).toHaveLength(
      10,
    );
  });

  // Two viewers of one clone — two ports, or a viewer per worktree — marking at the same moment.
  // Without the lock both would read the same index and the later rename would drop the other's
  // marks; with it every mark of both survives.
  it("merges concurrent marks from two viewers of one clone", async () => {
    const dir = await stateDir();
    const first = store(dir);
    const second = store(dir);
    const paths = Array.from(
      { length: 8 },
      (_, index) => `doc-${String(index)}.md`,
    );
    await Promise.all(
      paths.flatMap((relPath) => [
        saved(first, mark(`a/${relPath}`, `a ${relPath}\n`)),
        saved(second, mark(`b/${relPath}`, `b ${relPath}\n`)),
      ]),
    );
    const read = await first.read();
    expect(read.ok && read.marks.documents.size).toBe(16);
    await expect(
      stat(path.join(first.directory, "review.lock")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("takes over a lock a viewer left behind when it died while writing", async () => {
    const target = store(await stateDir());
    await mkdir(target.directory, { recursive: true });
    const lock = path.join(target.directory, "review.lock");
    await writeFile(lock, "12345\n");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lock, longAgo, longAgo);
    await saved(target, mark("guide.md", "text\n"));
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("says another viewer is busy rather than writing past a lock that is still held", async () => {
    const target = store(await stateDir(), { lockWaitMs: 100 });
    await mkdir(target.directory, { recursive: true });
    await writeFile(path.join(target.directory, "review.lock"), "12345\n");
    expect(await target.update(mark("guide.md", "text\n"))).toMatchObject({
      ok: false,
      status: "busy",
    });
    expect((await readdir(target.directory)).sort()).toEqual([
      "review.lock",
      "texts",
    ]);
  });

  it("leaves a marks file it cannot read as it is, and refuses to write over it", async () => {
    const target = store(await stateDir());
    await mkdir(target.directory, { recursive: true });
    const index = path.join(target.directory, "review.json");
    for (const text of ["{ not json", '{"format":2,"documents":{}}']) {
      await writeFile(index, text);
      const read = await target.read();
      expect(read.ok).toBe(false);
      expect(await target.update(mark("guide.md", "text\n"))).toMatchObject({
        ok: false,
        status: "refused",
      });
      expect(await readFile(index, "utf8")).toBe(text);
    }
  });

  // @boundary-guard write-failure
  //
  // The clone's folder losing its write permission after a first mark: the next mark fails before
  // anything is staged. It must be reported as a failure, leave the marks the folder already held
  // exactly as they were, and leave no temporary file or lock beside them. POSIX permissions are
  // what make the folder unwritable, so this runs where they apply: not on Windows, and not as
  // root, which they do not stop. The HTTP test of the same failure, which runs everywhere, is in
  // `review.test.ts`.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a mark it could not write and leaves the marks it had whole",
    async () => {
      const dir = await stateDir();
      const target = store(dir);
      await saved(target, mark("guide.md", "v1\n"));
      const before = await readFile(
        path.join(target.directory, "review.json"),
        "utf8",
      );
      await chmod(path.join(target.directory, "texts"), 0o500);
      await chmod(target.directory, 0o500);
      dirs.push(target.directory, path.join(target.directory, "texts"));
      try {
        expect(await target.update(mark("guide.md", "v2\n"))).toEqual({
          ok: false,
          status: "failed",
          message: expect.stringMatching(
            /^The review mark could not be saved \([A-Z]+\); nothing was changed\.$/,
          ),
        });
        expect(
          await readFile(path.join(target.directory, "review.json"), "utf8"),
        ).toBe(before);
        expect((await readdir(target.directory)).sort()).toEqual([
          "review.json",
          "texts",
        ]);
        expect(await readdir(path.join(target.directory, "texts"))).toEqual([
          `${contentHash("v1\n")}.md`,
        ]);
      } finally {
        await chmod(path.join(target.directory, "texts"), 0o700);
        await chmod(target.directory, 0o700);
      }
    },
  );
});
