import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

// Repositories built in temporary directories by spawning `git` from an argument list, for tests of
// core's git access and of what is computed from it. Fixtures and the code under test run with the
// same isolating environment: no global or system config (so a contributor's `core.autocrlf`,
// aliases or hooks cannot change a verdict) and a ceiling above the temporary root, so a dotfiles
// repository at the home directory is never found instead. `GIT_CONFIG_GLOBAL` pointed at an absent
// file reads as empty from git 2.32, hence the floor below which these tests are skipped.
const MIN_GIT = [2, 32] as const;

export const hasGit = (() => {
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

// Registered when a test file imports this module, so every file that builds repositories removes
// them when it finishes.
afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-git-"));
  tempDirs.push(dir);
  return dir;
}

export function isolatedEnv(dir: string): NodeJS.ProcessEnv {
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

// The fixture's own git: deliberately the plain process environment plus isolation, without core's
// hardening, so a control run proves a planted program really does run when nothing stops it.
export function git(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
): string {
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

export type GitFixture = {
  dir: string;
  repo: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
  write: (relPath: string, text: string) => Promise<void>;
  commit: (message: string) => void;
};

export async function makeRepo(): Promise<GitFixture> {
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
