import { readFile } from "node:fs/promises";
import path from "node:path";

import ignore, { type Ignore } from "ignore";

// Shared `.gitignore` matching for every directory walk in core. It lives here rather than inside
// `markdown/load-documents.ts` (its original home) because the pre-config repo scan (P11.14 / audit
// L-7) must skip exactly the trees the lint corpus will skip: two independent matchers would let
// `init` propose an `include` for a directory the very config it writes then ignores.

/**
 * A `.gitignore` and the directory (repo-relative POSIX) that owns it. Each file is kept as its own
 * matcher so within-file negation (`!keep.md`) resolves correctly; git's "can't re-include under an
 * excluded parent" rule is honored naturally because ignored directories are pruned before descent.
 */
export type IgnoreLayer = { baseRel: string; ig: Ignore };

/**
 * Test a repo-relative path against the active gitignore layers. Directories are queried with a
 * trailing slash so directory-only patterns (`node_modules/`) match (see the `ignore` API).
 */
export function isGitIgnored(
  relPath: string,
  isDirectory: boolean,
  layers: IgnoreLayer[],
): boolean {
  for (const layer of layers) {
    let relToBase: string;

    if (layer.baseRel === "") {
      relToBase = relPath;
    } else if (relPath.startsWith(`${layer.baseRel}/`)) {
      relToBase = relPath.slice(layer.baseRel.length + 1);
    } else {
      continue;
    }

    if (relToBase.length === 0) {
      continue;
    }

    if (layer.ig.ignores(isDirectory ? `${relToBase}/` : relToBase)) {
      return true;
    }
  }

  return false;
}

/**
 * Read the `.gitignore` owned by `directoryPath` into a layer, or undefined when there is none (or
 * it cannot be read — an unreadable ignore file means "no rules here", never a scan failure).
 */
export async function readIgnoreLayer(
  directoryPath: string,
  relDirectory: string,
): Promise<IgnoreLayer | undefined> {
  try {
    const content = await readFile(
      path.join(directoryPath, ".gitignore"),
      "utf8",
    );
    return { baseRel: relDirectory, ig: ignore().add(content) };
  } catch {
    return undefined;
  }
}
