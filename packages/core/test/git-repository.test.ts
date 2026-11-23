import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";
import { gitEnvironment } from "../src/git/git-command.js";
import {
  composeChanges,
  type GitChange,
  type GitRepository,
  type GitUnavailable,
  openGitRepository,
  parseNameStatus,
  parseStatusPorcelain,
} from "../src/git/git-repository.js";

// Every repository here is built in a temporary directory by spawning `git` from an argument list.
// Fixtures and the module under test run with the same isolating environment: no global or system
// config (so a contributor's `core.autocrlf`, aliases or hooks cannot change a verdict) and a ceiling
// above the temporary root, so a dotfiles repository at the home directory is never found instead.
// `GIT_CONFIG_GLOBAL` pointed at an absent file reads as empty from git 2.32, hence the floor.
const MIN_GIT = [2, 32] as const;

const hasGit = (() => {
  const probe = spawnSync("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    return false;
  }
  const version = /(\d+)\.(\d+)/.exec(probe.stdout);
  if (version === null) {
    return false;
  }
  const [major, minor] = [Number(version[1]), Number(version[2])];
  return major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
})();

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-git-"));
  tempDirs.push(dir);
  return dir;
}

function isolatedEnv(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(dir, "absent-global-config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: path.dirname(dir),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
}

// The fixture's own git: deliberately the plain process environment plus isolation, without the
// module's hardening, so a control run proves a planted program really does run when nothing stops it.
function git(cwd: string, env: NodeJS.ProcessEnv, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  return result.stdout;
}

type Fixture = {
  dir: string;
  repo: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
  write: (relPath: string, text: string) => Promise<void>;
  commit: (message: string) => void;
};

async function makeRepo(): Promise<Fixture> {
  const dir = await tempDir();
  const repo = path.join(dir, "repo");
  await mkdir(repo);
  const env = isolatedEnv(dir);
  const run = (...args: string[]) => git(repo, env, args);
  run("init", "-q", "-b", "main");
  return {
    dir,
    repo,
    env,
    git: run,
    write: async (relPath, text) => {
      const target = path.join(repo, ...relPath.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, "utf8");
    },
    commit: (message) => {
      run("add", "-A");
      run("commit", "-q", "-m", message);
    },
  };
}

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
      ["core.fsmonitor", "false"],
      ["core.quotePath", "false"],
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

      // A `.` entry resolves against the child's working directory — the repository. Windows never
      // searches it for an extensionless name; on POSIX this is the case that would run the file.
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
      });

      fixture.git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
      fixture.git("branch", "-q", "-m", "main", "master");
      expect(await repository.resolveBase()).toEqual({
        ref: "master",
        commit: head,
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
