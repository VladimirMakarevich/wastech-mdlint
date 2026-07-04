import { access } from "node:fs/promises";
import path from "node:path";

// The single v2 config filename (C4 — JSONC content, `.json` extension).
export const CONFIG_FILE_NAME = "wastech-mdlint.config.json";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `cwd` to the filesystem root looking for `wastech-mdlint.config.json` (P2.04).
 * Returns the first match's absolute path, or undefined if none is found. `--config` overrides this
 * (handled by the loader).
 */
export async function findConfig(cwd: string): Promise<string | undefined> {
  let directory = path.resolve(cwd);

  // Terminate at the FS root: dirname(root) === root.
  for (;;) {
    const candidate = path.join(directory, CONFIG_FILE_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}
