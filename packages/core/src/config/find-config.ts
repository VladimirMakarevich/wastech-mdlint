import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The single v2 config filename: JSONC content under a `.json` extension, so editors treat it as
// JSON while the loader still accepts comments.
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
 * Walk up from `cwd` looking for `wastech-mdlint.config.json`. Returns the first match's
 * absolute path, or undefined if none is found before the walk reaches the user's home directory or
 * the filesystem root. `--config` overrides this (handled by the loader).
 *
 * The home-directory boundary only rejects ANCESTORS at or above `$HOME`: a config
 * sitting exactly at `cwd` is always returned, even when `cwd` is the home directory itself — the
 * boundary exists to stop the walk from wandering into unrelated ancestor territory (e.g. a dotfiles
 * repo at `$HOME`), not to hide a config that legitimately lives at the caller's own directory.
 *
 * This deliberately diverges from the CLI's own `findRepositoryRoot`/`findInstalledSchemaDir`
 * walks (`packages/cli/src/init-command.ts`), which reject `startDir === $HOME` too and accept
 * losing the rare project-rooted-at-`$HOME` case: those two only anchor a write-location fallback,
 * where being overly cautious is harmless. Here, treating a real config at `cwd === $HOME` as "not
 * found" would make `lint`/MCP silently ignore it and would make `init` treat a real existing config
 * as absent — bypassing its overwrite prompt entirely and reaching an unconditional write. That is
 * the same silent-data-loss class this boundary exists to remove, so the two walks cannot share
 * that particular tradeoff even though they share the same ancestor-boundary ordering otherwise.
 */
export async function findConfig(cwd: string): Promise<string | undefined> {
  const start = path.resolve(cwd);
  const homeDir = path.resolve(os.homedir());

  // The starting directory is checked unconditionally — the loop below only ever inspects strict
  // ancestors of it, so gating this first check on the home-directory boundary would incorrectly
  // hide a config living directly at `cwd === $HOME`.
  const startCandidate = path.join(start, CONFIG_FILE_NAME);
  if (await fileExists(startCandidate)) {
    return startCandidate;
  }
  if (start === homeDir) {
    return undefined;
  }

  let directory = path.dirname(start);
  for (;;) {
    // Checked before testing the directory for a config, so an ancestor at (or only reachable by
    // ascending through) the home directory is never treated as a hit.
    if (directory === homeDir) {
      return undefined;
    }

    const candidate = path.join(directory, CONFIG_FILE_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    // Terminate at the FS root: dirname(root) === root.
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}
