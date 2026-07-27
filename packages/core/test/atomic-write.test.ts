import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic, writeFilesAtomic } from "../src/atomic-write.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-atomic-"));
  tempDirs.push(root);
  return root;
}

// The temp files are the whole mechanism, so every failure path has to prove it left none behind:
// a leaked `.tmp` next to a document would otherwise accumulate silently on every failed run.
async function tempResidue(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.endsWith(".tmp"));
}

describe("writeFilesAtomic", () => {
  it("replaces existing content and leaves no temp file behind", async () => {
    const root = await fixtureDir();
    const target = path.join(root, "config.json");
    await writeFile(target, "old\n", "utf8");

    const result = await writeFilesAtomic([{ path: target, content: "new\n" }]);

    expect(result).toEqual({ ok: true, written: [target] });
    await expect(readFile(target, "utf8")).resolves.toBe("new\n");
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("creates a file that does not exist yet", async () => {
    const root = await fixtureDir();
    const target = path.join(root, "fresh.json");

    const result = await writeFilesAtomic([{ path: target, content: "{}\n" }]);

    expect(result.ok).toBe(true);
    await expect(readFile(target, "utf8")).resolves.toBe("{}\n");
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("writes nothing when staging a later file fails, so the earlier file is untouched", async () => {
    const root = await fixtureDir();
    const first = path.join(root, "a.json");
    await writeFile(first, "old\n", "utf8");
    // The parent directory does not exist, so the *temp* write fails before any rename happens —
    // the two-phase staging property this helper exists for.
    const second = path.join(root, "missing-dir", "b.json");

    const result = await writeFilesAtomic([
      { path: first, content: "new\n" },
      { path: second, content: "new\n" },
    ]);

    expect(result).toMatchObject({
      ok: false,
      written: [],
      notWritten: [first, second],
      failedPath: second,
      code: "ENOENT",
    });
    await expect(readFile(first, "utf8")).resolves.toBe("old\n");
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("reports the committed prefix when a later rename fails", async () => {
    const root = await fixtureDir();
    const first = path.join(root, "a.json");
    await writeFile(first, "old\n", "utf8");
    // A directory in the target's place makes the rename fail on every platform (POSIX EISDIR,
    // Windows EPERM/EACCES) while staging still succeeds, which is the only way to reach a partial
    // commit without injecting a fault into the filesystem itself.
    const second = path.join(root, "b.json");
    await mkdir(second);

    const result = await writeFilesAtomic([
      { path: first, content: "new\n" },
      { path: second, content: "new\n" },
    ]);

    expect(result).toMatchObject({
      ok: false,
      written: [first],
      notWritten: [second],
      failedPath: second,
    });
    await expect(readFile(first, "utf8")).resolves.toBe("new\n");
    await expect(
      stat(second).then((stats) => stats.isDirectory()),
    ).resolves.toBe(true);
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("writes nothing when the first rename fails, discarding every staged temp", async () => {
    const root = await fixtureDir();
    const first = path.join(root, "a.json");
    await mkdir(first);
    const second = path.join(root, "b.json");
    await writeFile(second, "old\n", "utf8");

    const result = await writeFilesAtomic([
      { path: first, content: "new\n" },
      { path: second, content: "new\n" },
    ]);

    expect(result).toMatchObject({
      ok: false,
      written: [],
      notWritten: [first, second],
      failedPath: first,
    });
    await expect(readFile(second, "utf8")).resolves.toBe("old\n");
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("keeps the caller's commit order in the reported lists rather than sorting them", async () => {
    const root = await fixtureDir();
    // Reverse-alphabetical on purpose: `init` commits schema-before-config, and a host rendering the
    // result is the layer that sorts. Sorting inside the helper would erase the commit sequence.
    const schema = path.join(root, "z-schema.json");
    const config = path.join(root, "a-config.json");

    const result = await writeFilesAtomic([
      { path: schema, content: "{}\n" },
      { path: config, content: "{}\n" },
    ]);

    expect(result).toEqual({ ok: true, written: [schema, config] });
  });

  // POSIX-only: Windows has no mode bits to preserve and `symlink` needs elevation there.
  it.skipIf(process.platform === "win32")(
    "preserves the replaced file's permission bits",
    async () => {
      const root = await fixtureDir();
      const target = path.join(root, "private.json");
      await writeFile(target, "old\n", "utf8");
      await chmod(target, 0o600);

      await writeFilesAtomic([{ path: target, content: "new\n" }]);

      const stats = await stat(target);
      expect(stats.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "writes through a symlinked target instead of replacing the link",
    async () => {
      const root = await fixtureDir();
      const realTarget = path.join(root, "real.json");
      const link = path.join(root, "link.json");
      await writeFile(realTarget, "old\n", "utf8");
      await symlink(realTarget, link);

      await writeFilesAtomic([{ path: link, content: "new\n" }]);

      // What a plain `writeFile` did for free: the bytes land in the linked-to file and the link
      // itself survives. A rename onto the link path would instead have clobbered it with a regular
      // file, silently detaching the user's symlink.
      await expect(readFile(realTarget, "utf8")).resolves.toBe("new\n");
      await expect(
        lstat(link).then((stats) => stats.isSymbolicLink()),
      ).resolves.toBe(true);
    },
  );
});

describe("writeFileAtomic", () => {
  it("replaces content in place", async () => {
    const root = await fixtureDir();
    const target = path.join(root, "out.md");
    await writeFile(target, "old\n", "utf8");

    await writeFileAtomic(target, "new\n");

    await expect(readFile(target, "utf8")).resolves.toBe("new\n");
    await expect(tempResidue(root)).resolves.toEqual([]);
  });

  it("throws the original fs error, errno included, and leaves no temp behind", async () => {
    const root = await fixtureDir();
    const target = path.join(root, "out.md");
    await mkdir(target);

    await expect(writeFileAtomic(target, "new\n")).rejects.toMatchObject({
      code: expect.any(String),
    });
    await expect(tempResidue(root)).resolves.toEqual([]);
  });
});
