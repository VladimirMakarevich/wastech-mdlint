import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";
import {
  findGitExecutable,
  gitEnvironment,
  runGit,
} from "../src/git/git-command.js";
import {
  composeChanges,
  type GitChange,
  type GitRepository,
  type GitUnavailable,
  openGitRepository,
  parseNameStatus,
  parseStatusPorcelain,
  repositoryConfigOverrides,
} from "../src/git/git-repository.js";
import {
  git,
  hasGit,
  isolatedEnv,
  makeRepo,
  tempDir,
} from "./support/git-fixture.js";

async function open(
  rootDir: string,
  env: NodeJS.ProcessEnv,
): Promise<GitRepository> {
  const opened = await openGitRepository(rootDir, { env });
  if (!opened.available) {
    throw new Error(`expected a repository, got ${opened.reason}`);
  }
  return opened;
}

function expectUnavailable(
  value: unknown,
  reason: GitUnavailable["reason"],
): void {
  expect(value).toMatchObject({ available: false, reason });
}

async function mergeBaseWithMain(repository: GitRepository): Promise<string> {
  const base = await repository.resolveBase("main");
  if ("available" in base) {
    throw new Error(`expected a base, got ${base.reason}`);
  }
  const mergeBase = await repository.mergeBase(base);
  if (typeof mergeBase !== "string") {
    throw new Error(`expected a merge-base, got ${mergeBase.reason}`);
  }
  return mergeBase;
}

// Spawning a few dozen git processes per test is slow on Windows; the default budget is not enough
// once the rest of the suite runs in parallel.
const TIMEOUT_MS = 60_000;

describe("gitEnvironment", () => {
  it("drops inherited git variables except the user's config selectors and ceiling", () => {
    const env = gitEnvironment({
      GIT_DIR: "/elsewhere/.git",
      git_work_tree: "/elsewhere",
      GIT_EXTERNAL_DIFF: "planted",
      GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='planted'",
      GIT_CONFIG_GLOBAL: "/home/user/.gitconfig-alt",
      GIT_CEILING_DIRECTORIES: "/home",
      LANGUAGE: "ru",
      HOME: "/home/user",
    });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.git_work_tree).toBeUndefined();
    expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.LANGUAGE).toBeUndefined();
    expect(env.GIT_CONFIG_GLOBAL).toBe("/home/user/.gitconfig-alt");
    expect(env.GIT_CEILING_DIRECTORIES).toBe("/home");
    expect(env.HOME).toBe("/home/user");
    expect(env.LC_ALL).toBe("C");
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(env.GIT_NO_LAZY_FETCH).toBe("1");
  });

  it("carries its settings, and any extra ones, as environment config", () => {
    const env = gitEnvironment({}, [["filter.a=b.clean", ""]]);
    const settings = Array.from(
      { length: Number(env.GIT_CONFIG_COUNT) },
      (_, index) => [
        env[`GIT_CONFIG_KEY_${String(index)}`],
        env[`GIT_CONFIG_VALUE_${String(index)}`],
      ],
    );
    expect(settings).toEqual([
      // Empty, not `false`: git before 2.36 reads this key as the hook's path, and only an empty
      // value turns the hook off there.
      ["core.fsmonitor", ""],
      ["core.quotePath", "false"],
      ["log.showSignature", "false"],
      // Every transport refused, each known one by name because a repository's per-protocol key
      // outranks the generic one: a lazy fetch in a partial clone cannot start a program on a git
      // too old for `GIT_NO_LAZY_FETCH`.
      ["protocol.allow", "never"],
      ["protocol.file.allow", "never"],
      ["protocol.git.allow", "never"],
      ["protocol.ssh.allow", "never"],
      ["protocol.http.allow", "never"],
      ["protocol.https.allow", "never"],
      ["protocol.ext.allow", "never"],
      ["filter.a=b.clean", ""],
    ]);
  });

  it("keeps only absolute PATH entries, whatever the variable's case", () => {
    const absolute = path.resolve("bin");
    const env = gitEnvironment({
      Path: ["", ".", "relative/bin", absolute].join(path.delimiter),
    });
    expect(env.Path).toBe(absolute);
  });
});

describe("findGitExecutable", () => {
  it("finds git on an absolute PATH entry only, as a file it can start", async () => {
    const dir = await tempDir();
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    await mkdir(first);
    await mkdir(second);
    const pathValue = (entries: string[]) => ({
      PATH: entries.join(path.delimiter),
    });

    if (process.platform === "win32") {
      // `.com` before `.exe` within one directory, as libuv orders them; a `git.cmd` cannot be
      // started without a shell, so it is never the answer.
      await writeFile(path.join(first, "git.cmd"), "", "utf8");
      await writeFile(path.join(second, "git.exe"), "", "utf8");
      await writeFile(path.join(second, "git.com"), "", "utf8");
      expect(await findGitExecutable(pathValue([first, second]))).toBe(
        path.join(second, "git.com"),
      );
    } else {
      // Not executable: `execvp` would skip it, so the lookup does too.
      await writeFile(path.join(first, "git"), "", "utf8");
      await chmod(path.join(first, "git"), 0o644);
      await writeFile(path.join(second, "git"), "", "utf8");
      await chmod(path.join(second, "git"), 0o755);
      expect(await findGitExecutable(pathValue([first, second]))).toBe(
        path.join(second, "git"),
      );
    }

    // A relative entry is never searched, even when it names a directory holding git. (On Windows a
    // temporary directory on another drive than the checkout has no relative name to try.)
    const relative = path.relative(process.cwd(), second);
    if (!path.isAbsolute(relative)) {
      expect(await findGitExecutable(pathValue([relative]))).toBeUndefined();
    }
    expect(await findGitExecutable({})).toBeUndefined();
  });
});

describe("parseNameStatus", () => {
  it("reads every status, a rename's two paths and a copy as an addition", () => {
    const text = [
      "A",
      "new.md",
      "M",
      "changed.md",
      "D",
      "gone.md",
      "R087",
      "old name.md",
      "новое.md",
      "C100",
      "source.md",
      "copy.md",
      "T",
      "link.md",
      "U",
      "conflict.md",
      "",
    ].join("\0");
    expect(parseNameStatus(text)).toEqual([
      { status: "A", path: "new.md" },
      { status: "M", path: "changed.md" },
      { status: "D", path: "gone.md" },
      { status: "R", path: "новое.md", oldPath: "old name.md" },
      { status: "A", path: "copy.md" },
      { status: "M", path: "link.md" },
      { status: "M", path: "conflict.md" },
    ]);
  });
});

describe("parseStatusPorcelain", () => {
  it("reads each pair of columns as a change from HEAD to the work tree", () => {
    const text = [
      "?? untracked.md",
      " M edited.md",
      "M  staged.md",
      "MM both.md",
      "A  added.md",
      "AD added then removed.md",
      " A intent.md",
      "D  unstaged on disk.md",
      " D removed.md",
      "R  новое.md",
      "old.md",
      "RD renamed then removed.md",
      "source of removed.md",
      "C  copy.md",
      "copied.md",
      "UU conflict.md",
      "DD both deleted.md",
      "UA theirs added.md",
      "DU we deleted.md",
      "UD they deleted.md",
      "",
    ].join("\0");
    expect(parseStatusPorcelain(text)).toEqual([
      { status: "A", path: "untracked.md" },
      { status: "M", path: "edited.md" },
      { status: "M", path: "staged.md" },
      { status: "M", path: "both.md" },
      { status: "A", path: "added.md" },
      { status: "A", path: "intent.md" },
      { status: "D", path: "unstaged on disk.md" },
      { status: "D", path: "removed.md" },
      { status: "R", path: "новое.md", oldPath: "old.md" },
      { status: "D", path: "source of removed.md" },
      { status: "A", path: "copy.md" },
      { status: "M", path: "conflict.md" },
      { status: "D", path: "both deleted.md" },
      { status: "A", path: "theirs added.md" },
      { status: "A", path: "we deleted.md" },
      { status: "M", path: "they deleted.md" },
    ]);
  });
});

describe("composeChanges", () => {
  const byPath = (changes: GitChange[]) =>
    [...changes].sort((left, right) => compareStrings(left.path, right.path));

  it("keeps a change made on only one side", () => {
    expect(
      byPath(
        composeChanges(
          [{ status: "M", path: "committed.md" }],
          [{ status: "A", path: "new.md" }],
        ),
      ),
    ).toEqual([
      { status: "M", path: "committed.md" },
      { status: "A", path: "new.md" },
    ]);
  });

  it("follows a path back through both sides", () => {
    expect(
      byPath(
        composeChanges(
          [
            { status: "R", path: "middle.md", oldPath: "start.md" },
            { status: "A", path: "added.md" },
            { status: "M", path: "edited.md" },
            { status: "D", path: "deleted.md" },
            { status: "A", path: "added then deleted.md" },
            { status: "M", path: "edited then deleted.md" },
            { status: "R", path: "renamed then deleted.md", oldPath: "r.md" },
          ],
          [
            { status: "R", path: "end.md", oldPath: "middle.md" },
            { status: "R", path: "added, renamed.md", oldPath: "added.md" },
            { status: "M", path: "edited.md" },
            { status: "A", path: "deleted.md" },
            { status: "D", path: "added then deleted.md" },
            { status: "D", path: "edited then deleted.md" },
            { status: "D", path: "renamed then deleted.md" },
          ],
        ),
      ),
    ).toEqual([
      { status: "A", path: "added, renamed.md" },
      { status: "M", path: "deleted.md" },
      { status: "D", path: "edited then deleted.md" },
      { status: "M", path: "edited.md" },
      { status: "R", path: "end.md", oldPath: "start.md" },
      { status: "D", path: "r.md" },
    ]);
  });

  it("reads a path deleted and created again within one side as modified", () => {
    expect(
      composeChanges(
        [],
        [
          { status: "D", path: "unstaged.md" },
          { status: "A", path: "unstaged.md" },
        ],
      ),
    ).toEqual([{ status: "M", path: "unstaged.md" }]);
  });
});

describe.skipIf(!hasGit)("openGitRepository (requires git on PATH)", () => {
  it(
    "reports a directory outside any work tree",
    async () => {
      const dir = await tempDir();
      expectUnavailable(
        await openGitRepository(dir, { env: isolatedEnv(dir) }),
        "not-a-repository",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "reports git missing when PATH has no git on it",
    async () => {
      const dir = await tempDir();
      expectUnavailable(
        await openGitRepository(dir, {
          env: { ...isolatedEnv(dir), PATH: "", Path: "" },
        }),
        "no-git-binary",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "lists added, modified, deleted, renamed and untracked files against the merge-base",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("keep.md", "same\n");
      await fixture.write("edit.md", "before\n");
      await fixture.write("drop.md", "dropped\n");
      await fixture.write("move me.md", "moved text\nthat stays\nthe same\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");

      await fixture.write("edit.md", "after\n");
      await rm(path.join(fixture.repo, "drop.md"));
      fixture.git("mv", "move me.md", "перемещён.md");
      await fixture.write("staged new.md", "new\n");
      fixture.git("add", "staged new.md");
      await fixture.write("untracked.md", "untracked\n");
      await fixture.write("ignored.md", "ignored\n");
      await fixture.write(".gitignore", "ignored.md\n");

      const repository = await open(fixture.repo, fixture.env);
      const changes = await repository.changedPaths(
        await mergeBaseWithMain(repository),
        { worktree: true },
      );
      expect(changes).toEqual([
        { status: "A", path: ".gitignore" },
        { status: "D", path: "drop.md" },
        { status: "M", path: "edit.md" },
        { status: "A", path: "staged new.md" },
        { status: "A", path: "untracked.md" },
        { status: "R", path: "перемещён.md", oldPath: "move me.md" },
      ]);
      expect(changes.map((change) => change.path)).toEqual(
        changes.map((change) => change.path).sort(compareStrings),
      );
    },
    TIMEOUT_MS,
  );

  it(
    "limits the list to commits when asked, leaving uncommitted work out",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");
      await fixture.write("committed.md", "c\n");
      fixture.commit("feature work");
      await fixture.write("a.md", "edited, not committed\n");
      await fixture.write("untracked.md", "u\n");

      const repository = await open(fixture.repo, fixture.env);
      const mergeBase = await mergeBaseWithMain(repository);
      expect(
        await repository.changedPaths(mergeBase, { worktree: false }),
      ).toEqual([{ status: "A", path: "committed.md" }]);
    },
    TIMEOUT_MS,
  );

  it(
    "shows only uncommitted work on the base branch itself",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      fixture.commit("base");
      await fixture.write("a.md", "edited\n");

      const repository = await open(fixture.repo, fixture.env);
      const mergeBase = await mergeBaseWithMain(repository);
      expect(mergeBase).toBe(await repository.headCommit());
      expect(
        await repository.changedPaths(mergeBase, { worktree: true }),
      ).toEqual([{ status: "M", path: "a.md" }]);
    },
    TIMEOUT_MS,
  );

  it(
    "speaks in paths relative to a root below the top level and drops changes outside it",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("packages/docs/guide.md", "guide\n");
      await fixture.write("packages/docs-other/x.md", "x\n");
      await fixture.write("root.md", "root\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");
      await fixture.write("packages/docs/guide.md", "guide, edited\n");
      await fixture.write("packages/docs/sub/new.md", "new\n");
      await fixture.write("packages/docs-other/x.md", "x, edited\n");
      await fixture.write("root.md", "root, edited\n");

      const repository = await open(
        path.join(fixture.repo, "packages", "docs"),
        fixture.env,
      );
      const mergeBase = await mergeBaseWithMain(repository);
      expect(
        await repository.changedPaths(mergeBase, { worktree: true }),
      ).toEqual([
        { status: "M", path: "guide.md" },
        { status: "A", path: "sub/new.md" },
      ]);
      const texts = await repository.readBlobs(mergeBase, [
        "guide.md",
        "sub/new.md",
      ]);
      expect([...texts]).toEqual([["guide.md", "guide\n"]]);
      expect(repository.topLevelPath("sub/new.md")).toBe(
        "packages/docs/sub/new.md",
      );
      const atTop = await open(fixture.repo, fixture.env);
      expect(atTop.topLevelPath("root.md")).toBe("root.md");
      // One clone, one identity, whichever folder of it the host was started in.
      expect(repository.commonDir).toBe(atTop.commonDir);
      expect(atTop.gitDir).toBe(atTop.commonDir);

      // An added worktree shares the clone's refs but has a `HEAD` of its own.
      const other = path.join(fixture.dir, "other");
      fixture.git("worktree", "add", "-q", other, "main");
      const added = await open(other, fixture.env);
      expect(added.commonDir).toBe(atTop.commonDir);
      expect(added.gitDir).not.toBe(atTop.gitDir);
      expect(path.dirname(path.dirname(added.gitDir))).toBe(atTop.commonDir);
    },
    TIMEOUT_MS,
  );

  it(
    "reads each file's text at a commit in one pass, leaving absent ones out",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("plain.md", "plain\r\nwith CRLF kept as stored\n");
      await fixture.write("с пробелом.md", "кириллица\n");
      await fixture.write("dir/nested.md", "");
      fixture.commit("base");

      const repository = await open(fixture.repo, fixture.env);
      const head = await repository.headCommit();
      expect(head).toMatch(/^[0-9a-f]{40,64}$/);
      const texts = await repository.readBlobs(head ?? "", [
        "plain.md",
        "missing.md",
        "с пробелом.md",
        "dir",
        "dir/nested.md",
        "line\nbreak.md",
      ]);
      expect([...texts]).toEqual([
        ["plain.md", "plain\r\nwith CRLF kept as stored\n"],
        ["с пробелом.md", "кириллица\n"],
        ["dir/nested.md", ""],
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    "never runs a program the repository's config names",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("doc.md", "text\n");
      fixture.commit("base");

      // Each planted program leaves a marker of its own when it runs. Paths are written with forward
      // slashes because git hands these commands to `sh`, Git for Windows' included.
      const slash = (target: string) => target.split(path.sep).join("/");
      const markers = {
        fsmonitor: path.join(fixture.dir, "fsmonitor-ran"),
        filter: path.join(fixture.dir, "filter-ran"),
        equalsFilter: path.join(fixture.dir, "equals-filter-ran"),
        textconv: path.join(fixture.dir, "textconv-ran"),
        external: path.join(fixture.dir, "external-diff-ran"),
      };
      const script = async (name: string, body: string) => {
        const file = path.join(fixture.dir, name);
        await writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
        await chmod(file, 0o755);
        return slash(file);
      };
      const fsmonitor = await script(
        "fsmonitor.sh",
        `touch '${slash(markers.fsmonitor)}'\nexit 1`,
      );
      const filter = await script(
        "filter.sh",
        `touch '${slash(markers.filter)}'\ncat`,
      );
      const equalsFilter = await script(
        "equals-filter.sh",
        `touch '${slash(markers.equalsFilter)}'\ncat`,
      );
      const textconv = await script(
        "textconv.sh",
        `touch '${slash(markers.textconv)}'\ncat "$1"`,
      );
      const external = await script(
        "external.sh",
        `touch '${slash(markers.external)}'`,
      );
      fixture.git("config", "core.fsmonitor", fsmonitor);
      fixture.git("config", "filter.planted.clean", `sh '${filter}'`);
      // Required, so the override has to switch that off too; a required driver also needs a
      // smudge side for git to produce a patch in the control run below.
      fixture.git("config", "filter.planted.smudge", "cat");
      fixture.git("config", "filter.planted.required", "true");
      // A driver whose name holds `=`: `git -c` splits its argument at the first `=`, so only
      // environment config can empty this one.
      fixture.git("config", "filter.a=b.clean", `sh '${equalsFilter}'`);
      fixture.git("config", "diff.planted.textconv", `sh '${textconv}'`);
      fixture.git("config", "diff.external", `sh '${external}'`);
      await fixture.write(
        ".gitattributes",
        "doc.md filter=planted diff=planted\nother.md filter=a=b\n",
      );
      await fixture.write("other.md", "other\n");
      fixture.commit("attributes");
      fixture.git("checkout", "-q", "-b", "feature");

      // A changed stat makes git hash the work-tree file again, which is when a clean filter runs.
      const touchAll = async () => {
        await fixture.write("doc.md", "text, edited\n");
        await fixture.write("other.md", "other, edited\n");
      };
      const clearMarkers = () =>
        Promise.all(
          Object.values(markers).map((marker) => rm(marker, { force: true })),
        );

      // Control: the fixture's own unhardened git runs the planted programs, so their absence
      // below means the module stopped them rather than that nothing would have run.
      await touchAll();
      git(fixture.repo, fixture.env, ["diff", "--name-status", "main"]);
      git(fixture.repo, fixture.env, ["diff", "main"]);
      expect(existsSync(markers.fsmonitor)).toBe(true);
      expect(existsSync(markers.filter)).toBe(true);
      expect(existsSync(markers.equalsFilter)).toBe(true);
      expect(existsSync(markers.external)).toBe(true);
      await clearMarkers();

      await touchAll();
      const repository = await open(fixture.repo, fixture.env);
      const mergeBase = await mergeBaseWithMain(repository);
      expect(
        await repository.changedPaths(mergeBase, { worktree: true }),
      ).toEqual([
        { status: "M", path: "doc.md" },
        { status: "M", path: "other.md" },
      ]);
      await repository.readBlobs(mergeBase, ["doc.md", "other.md"]);
      for (const marker of Object.values(markers)) {
        expect(existsSync(marker), path.basename(marker)).toBe(false);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "empties a filter driver the config gains after the repository was opened",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("doc.md", "text\n");
      await fixture.write(".gitattributes", "doc.md filter=late\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");

      // Opened while no driver exists, as a viewer opens before a checkout or a pull brings one in.
      const repository = await open(fixture.repo, fixture.env);

      const slash = (target: string) => target.split(path.sep).join("/");
      const marker = path.join(fixture.dir, "late-filter-ran");
      const filter = path.join(fixture.dir, "late-filter.sh");
      await writeFile(
        filter,
        `#!/bin/sh\ntouch '${slash(marker)}'\ncat\n`,
        "utf8",
      );
      await chmod(filter, 0o755);
      fixture.git("config", "filter.late.clean", `sh '${slash(filter)}'`);

      // Control: the fixture's own git runs the driver on a changed stat.
      await fixture.write("doc.md", "text, edited\n");
      git(fixture.repo, fixture.env, ["diff", "--name-status", "main"]);
      expect(existsSync(marker)).toBe(true);
      await rm(marker, { force: true });

      await fixture.write("doc.md", "text, edited again\n");
      const mergeBase = await mergeBaseWithMain(repository);
      expect(
        await repository.changedPaths(mergeBase, { worktree: true }),
      ).toEqual([{ status: "M", path: "doc.md" }]);
      expect(existsSync(marker)).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "never runs a git executable placed in the repository",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("doc.md", "text\n");
      fixture.commit("base");
      const marker = path.join(fixture.dir, "planted-git-ran");
      const planted = path.join(fixture.repo, "git");
      await writeFile(
        planted,
        `#!/bin/sh\ntouch '${marker.split(path.sep).join("/")}'\necho 'git version 9.9.9'\n`,
        "utf8",
      );
      await chmod(planted, 0o755);

      // A `.` entry resolves against the child's working directory — the repository — so on POSIX a
      // bare `git` looked up through this `PATH` would be this file. Git is found on absolute entries
      // only and started by that path. Windows runs no extensionless file; its own lookup, which
      // tries the working directory whatever `PATH` says, is the next test's.
      const env = {
        ...fixture.env,
        PATH: [".", process.env.PATH ?? ""].join(path.delimiter),
      };
      const repository = await open(fixture.repo, env);
      await repository.headCommit();
      expect(existsSync(marker)).toBe(false);
    },
    TIMEOUT_MS,
  );

  it.skipIf(process.platform !== "win32")(
    "never runs a git.exe or git.com placed in the repository, on Windows",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("doc.md", "text\n");
      fixture.commit("base");
      // Started by bare name, a program is looked up in the child's working directory before `PATH`
      // unless `NoDefaultCurrentDirectoryInExePath` is set in the *parent's* environment — the
      // lookup happens in this process — which almost no machine has, though some tool harnesses
      // set it. It is removed for the test, so the control below shows the lookup an ordinary
      // machine does, and the variable cannot be what keeps the planted file from running.
      const variable = Object.keys(process.env).filter(
        (name) => name.toUpperCase() === "NODEFAULTCURRENTDIRECTORYINEXEPATH",
      );
      const saved = variable.map((name) => [name, process.env[name]] as const);
      for (const name of variable) {
        Reflect.deleteProperty(process.env, name);
      }
      const env = Object.fromEntries(
        Object.entries(fixture.env).filter(
          ([name]) => !variable.includes(name),
        ),
      );

      try {
        // The stand-in is node itself: any Windows executable will do, and node is the one a test
        // run is sure to have. Started as git it prints no git version, so a repository that opens
        // and answers was opened by the real git. A hard link where the volume allows it, since a
        // copy of node is large.
        for (const name of ["git.exe", "git.com"]) {
          const planted = path.join(fixture.repo, name);
          await link(process.execPath, planted).catch(() =>
            copyFile(process.execPath, planted),
          );

          // Control: the lookup a bare `git` gets runs the planted file, even with `PATH` reduced to
          // absolute entries.
          const control = spawnSync("git", ["--version"], {
            cwd: fixture.repo,
            env: gitEnvironment(env),
            encoding: "utf8",
            windowsHide: true,
          });
          expect(control.stdout.trim(), name).toBe(process.version);

          const repository = await open(fixture.repo, env);
          expect(await repository.headCommit(), name).toMatch(/^[0-9a-f]{40}$/);
          await rm(planted);
        }
      } finally {
        for (const [name, value] of saved) {
          process.env[name] = value;
        }
      }
    },
    TIMEOUT_MS,
  );

  it(
    "never fetches a partial clone's missing object, so no program the remote's config names runs",
    async () => {
      const source = await makeRepo();
      await source.write("doc.md", "text\n");
      source.commit("base");
      source.git("config", "uploadpack.allowFilter", "true");
      const slash = (target: string) => target.split(path.sep).join("/");
      // Without blobs: every file's text is a missing object the clone would fetch on first read.
      const clone = path.join(source.dir, "clone");
      git(source.dir, source.env, [
        "clone",
        "-q",
        "--filter=blob:none",
        "--no-checkout",
        `file://${slash(source.repo)}`,
        clone,
      ]);
      const sourceUrl = git(clone, source.env, [
        "config",
        "remote.origin.url",
      ]).trim();
      const cloneGit = (...args: string[]) => git(clone, source.env, args);

      // Two programs a fetch would start: an upload-pack named for a `file://` remote, and the
      // command an `ext::` remote is, allowed by the repository's own `protocol.ext.allow`.
      const markers = {
        uploadPack: path.join(source.dir, "upload-pack ran"),
        ext: path.join(source.dir, "ext ran"),
      };
      const uploadPack = path.join(source.dir, "upload-pack.sh");
      await writeFile(
        uploadPack,
        `#!/bin/sh\ntouch '${slash(markers.uploadPack)}'\nexec git-upload-pack "$@"\n`,
        "utf8",
      );
      cloneGit(
        "config",
        "remote.origin.uploadpack",
        `sh '${slash(uploadPack)}'`,
      );
      // `ext::` splits its command at spaces; `% ` is a literal one.
      const extUrl = `ext::sh -c touch% '${slash(markers.ext).replaceAll(" ", "% ")}'`;
      cloneGit("config", "protocol.ext.allow", "always");
      cloneGit("config", "protocol.planted.allow", "always");

      const head = git(clone, source.env, ["rev-parse", "HEAD"]).trim();
      const readsNothing = async () => {
        const repository = await open(clone, source.env);
        // From git 2.45 `GIT_NO_LAZY_FETCH` makes the blob read as absent; before it, the refused
        // transport makes the read fail. Either way nothing is fetched and nothing is returned.
        const texts = await repository
          .readBlobs(head, ["doc.md"])
          .catch(() => new Map<string, string>());
        expect(texts.has("doc.md")).toBe(false);

        // The protocol settings alone, as a git older than 2.45 has only those.
        const probe = { cwd: clone, env: gitEnvironment(source.env) };
        const overrides = await repositoryConfigOverrides(probe);
        expect(overrides).toEqual(
          expect.arrayContaining([
            ["protocol.ext.allow", "never"],
            ["protocol.planted.allow", "never"],
          ]),
        );
        const env = gitEnvironment(source.env, overrides);
        delete env.GIT_NO_LAZY_FETCH;
        const output = await runGit(
          { cwd: clone, env },
          ["cat-file", "--batch"],
          `${head}:doc.md\n`,
        );
        expect(output.stdout.toString("utf8")).not.toContain(" blob ");
      };

      await readsNothing();
      cloneGit("config", "remote.origin.url", extUrl);
      await readsNothing();
      for (const marker of Object.values(markers)) {
        expect(existsSync(marker), path.basename(marker)).toBe(false);
      }

      // Controls, last because a fetch that succeeds fills the blob in: the fixture's unhardened git
      // does start each program, so their absence above means they were stopped.
      const unhardenedRead = () =>
        spawnSync("git", ["cat-file", "--batch"], {
          cwd: clone,
          env: source.env,
          input: `${head}:doc.md\n`,
          encoding: "utf8",
          windowsHide: true,
        });
      unhardenedRead();
      expect(existsSync(markers.ext)).toBe(true);
      cloneGit("config", "remote.origin.url", sourceUrl);
      unhardenedRead();
      expect(existsSync(markers.uploadPack)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    "reports and reads a file above the root when asked for it by name",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("config.json", "{}\n");
      await fixture.write("README.md", "readme\n");
      await fixture.write("docs/a.md", "a\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");
      await fixture.write("config.json", '{ "rules": [] }\n');
      await fixture.write("README.md", "readme, edited\n");
      await fixture.write("docs/a.md", "a, edited\n");

      const repository = await open(
        path.join(fixture.repo, "docs"),
        fixture.env,
      );
      const mergeBase = await mergeBaseWithMain(repository);
      // A path out of the work tree has no history and is skipped; one inside the root is reported
      // once however it is asked for; the root-level README, not asked for, stays out.
      const asked = ["../config.json", "../../outside.json", "a.md"];
      const expected = [
        { status: "M", path: "../config.json" },
        { status: "M", path: "a.md" },
      ];
      expect(
        await repository.changedPaths(mergeBase, {
          worktree: true,
          alsoPaths: asked,
        }),
      ).toEqual(expected);
      expect(
        await repository.changedPaths(mergeBase, { worktree: true }),
      ).toEqual([{ status: "M", path: "a.md" }]);
      expect(await repository.readBlobs(mergeBase, asked)).toEqual(
        new Map([
          ["../config.json", "{}\n"],
          ["a.md", "a\n"],
        ]),
      );

      fixture.commit("feature");
      expect(
        await repository.changedPaths(mergeBase, {
          worktree: false,
          alsoPaths: asked,
        }),
      ).toEqual(expected);
    },
    TIMEOUT_MS,
  );

  it(
    "reads the repository it was pointed at, not one an inherited GIT_DIR names",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("mine.md", "mine\n");
      fixture.commit("base");
      await fixture.write("mine.md", "mine, edited\n");

      const other = await makeRepo();
      await other.write("theirs.md", "theirs\n");
      other.commit("base");
      await other.write("theirs.md", "theirs, edited\n");

      const repository = await open(fixture.repo, {
        ...fixture.env,
        GIT_DIR: path.join(other.repo, ".git"),
        GIT_WORK_TREE: other.repo,
      });
      expect(
        await repository.changedPaths(await mergeBaseWithMain(repository), {
          worktree: true,
        }),
      ).toEqual([{ status: "M", path: "mine.md" }]);
    },
    TIMEOUT_MS,
  );

  it(
    "leaves .git/index untouched when the work tree's stat data is stale",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      await fixture.write("b.md", "b\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");
      await fixture.write("b.md", "b, edited\n");
      const indexPath = path.join(fixture.repo, ".git", "index");
      // Same text, an older timestamp: the content still matches the index while the stat data no
      // longer does — what a refreshing command records by rewriting the index.
      const past = new Date(2000, 0, 1);
      await utimes(path.join(fixture.repo, "a.md"), past, past);
      const before = await readFile(indexPath);
      const beforeStat = await stat(indexPath);

      const repository = await open(fixture.repo, fixture.env);
      expect(
        await repository.changedPaths(await mergeBaseWithMain(repository), {
          worktree: true,
        }),
      ).toEqual([{ status: "M", path: "b.md" }]);
      expect(await readFile(indexPath)).toEqual(before);
      expect((await stat(indexPath)).mtimeMs).toBe(beforeStat.mtimeMs);

      // Control: porcelain `diff` against the work tree does rewrite it in exactly this state, which
      // is why the module asks `status` instead.
      git(fixture.repo, fixture.env, ["diff", "--name-status", "main"]);
      expect(await readFile(indexPath)).not.toEqual(before);
    },
    TIMEOUT_MS,
  );
});

describe.skipIf(!hasGit)("resolving the base (requires git on PATH)", () => {
  it(
    "refuses a ref that would read as an option before git sees it",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      fixture.commit("base");
      const repository = await open(fixture.repo, fixture.env);
      expectUnavailable(
        await repository.resolveBase("--output=planted"),
        "invalid-ref",
      );
      expectUnavailable(await repository.resolveBase(""), "invalid-ref");
      expect(existsSync(path.join(fixture.repo, "planted"))).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "reports a ref that names no commit",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      fixture.commit("base");
      const repository = await open(fixture.repo, fixture.env);
      expectUnavailable(
        await repository.resolveBase("no-such-branch"),
        "base-not-found",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "prefers the branch origin/HEAD names, then main, then master",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      fixture.commit("base");
      const repository = await open(fixture.repo, fixture.env);
      const head = await repository.headCommit();

      expect(await repository.resolveBase()).toEqual({
        ref: "main",
        commit: head,
        fullRef: "refs/heads/main",
      });

      fixture.git("update-ref", "refs/remotes/origin/develop", "HEAD");
      fixture.git(
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/develop",
      );
      expect(await repository.resolveBase()).toEqual({
        ref: "origin/develop",
        commit: head,
        fullRef: "refs/remotes/origin/develop",
      });

      fixture.git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
      fixture.git("branch", "-q", "-m", "main", "master");
      expect(await repository.resolveBase()).toEqual({
        ref: "master",
        commit: head,
        fullRef: "refs/heads/master",
      });

      fixture.git("branch", "-q", "-m", "master", "trunk");
      expectUnavailable(await repository.resolveBase(), "base-not-found");
    },
    TIMEOUT_MS,
  );

  it(
    "reports a repository with no commits as having no base",
    async () => {
      const fixture = await makeRepo();
      await fixture.write("a.md", "a\n");
      const repository = await open(fixture.repo, fixture.env);
      expect(await repository.headCommit()).toBeUndefined();
      expectUnavailable(await repository.resolveBase(), "base-not-found");
    },
    TIMEOUT_MS,
  );

  it(
    "says a shallow clone lacks the history to find where the branch left its base",
    async () => {
      const origin = await makeRepo();
      await origin.write("a.md", "a\n");
      origin.commit("fork point");
      origin.git("checkout", "-q", "-b", "feature");
      await origin.write("f.md", "f1\n");
      origin.commit("feature 1");
      await origin.write("f.md", "f2\n");
      origin.commit("feature 2");
      origin.git("checkout", "-q", "main");
      await origin.write("a.md", "a, main 2\n");
      origin.commit("main 2");

      const clone = path.join(origin.dir, "clone");
      git(origin.dir, origin.env, [
        "clone",
        "-q",
        "--depth",
        "1",
        "--branch",
        "feature",
        pathToFileURL(origin.repo).href,
        clone,
      ]);
      git(clone, origin.env, [
        "fetch",
        "-q",
        "--depth",
        "1",
        "origin",
        "main:refs/remotes/origin/main",
      ]);

      const repository = await open(clone, origin.env);
      const base = await repository.resolveBase("origin/main");
      if ("available" in base) {
        throw new Error(`expected a base, got ${base.reason}`);
      }
      expectUnavailable(await repository.mergeBase(base), "shallow-history");
    },
    TIMEOUT_MS,
  );
});
