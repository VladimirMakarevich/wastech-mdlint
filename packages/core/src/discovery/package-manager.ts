import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DetectedPackageManager =
  | "bun"
  | "pnpm"
  | "yarn"
  | "npm"
  | undefined;

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    // `stat` (not `lstat`) so a symlink to a real lockfile still counts, but a directory or a
    // symlink to one — or a dangling symlink — correctly does not.
    const stats = await stat(candidatePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

// `.git` is a directory in a normal clone but a plain file in a worktree or submodule, so the
// repository-root marker deliberately accepts either — unlike `fileExists` above, which must reject
// a directory named like a lockfile.
async function isRepositoryRoot(directory: string): Promise<boolean> {
  try {
    await stat(path.join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

// Lockfile basename → manager, in the spec's bun > pnpm > yarn > npm priority. `bun.lock` (current
// text lockfile) and `bun.lockb` (legacy binary) both count as "bun". Applied within a single
// directory: the *nearest* directory holding any lockfile wins outright, and only a directory
// holding several is resolved by this order.
const LOCKFILES: readonly (readonly [
  string,
  NonNullable<DetectedPackageManager>,
])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

async function detectInDirectory(
  directory: string,
): Promise<DetectedPackageManager> {
  for (const [fileName, manager] of LOCKFILES) {
    if (await fileExists(path.join(directory, fileName))) {
      return manager;
    }
  }
  return undefined;
}

/**
 * Detects the package manager from the nearest lockfile at or above `cwd`. Priority order
 * bun > pnpm > yarn > npm mirrors the spec; returns `undefined` when no lockfile is found rather
 * than defaulting to `"npm"` — guessing a manager with no evidence is a UX call for the interactive
 * `init` layer, not core's job.
 *
 * The walk is bounded, mirroring `findConfig`'s ancestor discipline (config/find-config.ts). `cwd`
 * itself is always checked; the walk then climbs strict ancestors and stops after the first
 * directory containing a `.git` (the repository root owns the lockfile — a monorepo member has none
 * of its own, which is exactly why an earlier root-only check reported "not detected" for it)
 * and never reaches the user's home directory (an unrelated lockfile at `$HOME` must not be
 * attributed to the scanned project).
 */
export async function detectPackageManager(
  cwd: string,
): Promise<DetectedPackageManager> {
  const start = path.resolve(cwd);
  const homeDir = path.resolve(os.homedir());

  // Checked before the boundary test so a project rooted exactly at `$HOME` still reports its own
  // lockfile; the boundary only ever rejects strict ancestors.
  const own = await detectInDirectory(start);
  if (own !== undefined) {
    return own;
  }
  if (start === homeDir || (await isRepositoryRoot(start))) {
    return undefined;
  }

  let directory = path.dirname(start);
  for (;;) {
    if (directory === homeDir) {
      return undefined;
    }

    const detected = await detectInDirectory(directory);
    if (detected !== undefined) {
      return detected;
    }

    // A repository root without a lockfile is the end of the search: anything above it belongs to a
    // different project (or to the developer's home tree) and must not be reported as this one's.
    if (await isRepositoryRoot(directory)) {
      return undefined;
    }

    // Terminate at the FS root: dirname(root) === root.
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}
