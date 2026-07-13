import { stat } from "node:fs/promises";
import path from "node:path";

export type DetectedPackageManager = "bun" | "pnpm" | "yarn" | "npm" | undefined;

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

/**
 * Detects the package manager from a lockfile at `cwd` (non-recursive: one lockfile per
 * repo/monorepo root). Priority order bun > pnpm > yarn > npm mirrors the spec; returns
 * `undefined` when no lockfile exists rather than defaulting to `"npm"` — guessing a manager
 * with no evidence is a UX call for the interactive `init` layer (P6.03), not core's job.
 */
export async function detectPackageManager(cwd: string): Promise<DetectedPackageManager> {
  // bun.lock (current text lockfile) and bun.lockb (legacy binary) both count as "bun".
  if (
    (await fileExists(path.join(cwd, "bun.lock"))) ||
    (await fileExists(path.join(cwd, "bun.lockb")))
  ) {
    return "bun";
  }

  if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await fileExists(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }

  if (await fileExists(path.join(cwd, "package-lock.json"))) {
    return "npm";
  }

  return undefined;
}
