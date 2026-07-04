import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import ignore, { type Ignore } from "ignore";

import { matchesConfigGlob, normalizeRelativePath } from "../discovery/globs.js";
import type { ParsedDocument } from "./document-types.js";
import { parseDocument } from "./parse-document.js";

export type LoadDocumentsOptions = {
  cwd: string;
  // Config `exclude` (C1). Excluded paths win over `include`; excluded directories are pruned.
  exclude?: string[];
  // Config `respectGitignore` (C8). When true, `.gitignore` files (root + nested) are honored.
  // Wiring to config happens in P2 — P1 only accepts the parameter.
  respectGitignore?: boolean;
};

// A `.gitignore` and the directory (repo-relative POSIX) that owns it. Each file is kept as its own
// matcher so within-file negation (`!keep.md`) resolves correctly; git's "can't re-include under an
// excluded parent" rule is honored naturally because ignored directories are pruned before descent.
type IgnoreLayer = { baseRel: string; ig: Ignore };

function toPosixAbsolute(absolutePath: string): string {
  return absolutePath.replaceAll("\\", "/");
}

function isInsideRoot(candidatePath: string, rootRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Test a repo-relative path against the active gitignore layers. Directories are queried with a
// trailing slash so directory-only patterns (`node_modules/`) match (see the `ignore` API).
function isGitIgnored(relPath: string, isDirectory: boolean, layers: IgnoreLayer[]): boolean {
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

async function readIgnoreLayer(
  directoryPath: string,
  relDirectory: string
): Promise<IgnoreLayer | undefined> {
  try {
    const content = await readFile(path.join(directoryPath, ".gitignore"), "utf8");
    return { baseRel: relDirectory, ig: ignore().add(content) };
  } catch {
    return undefined;
  }
}

function shouldPruneDirectory(relDirectory: string, exclude: string[]): boolean {
  // Probe a synthetic child so directory patterns like `dist/**` prune the directory itself.
  return matchesConfigGlob(`${relDirectory}/__directory_probe__`, exclude);
}

async function collectFiles(params: {
  directoryPath: string;
  relDirectory: string;
  rootDisplayPath: string;
  rootRealPath: string;
  patterns: string[];
  exclude: string[];
  respectGitignore: boolean;
  layers: IgnoreLayer[];
  results: string[];
}): Promise<void> {
  const localLayer = params.respectGitignore
    ? await readIgnoreLayer(params.directoryPath, params.relDirectory)
    : undefined;
  const layers = localLayer === undefined ? params.layers : [...params.layers, localLayer];

  const entries = await readdir(params.directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(params.directoryPath, entry.name);
    const relPath = normalizeRelativePath(path.relative(params.rootDisplayPath, absolutePath));

    if (entry.isDirectory()) {
      if (shouldPruneDirectory(relPath, params.exclude)) {
        continue;
      }
      if (isGitIgnored(relPath, true, layers)) {
        continue;
      }

      await collectFiles({ ...params, directoryPath: absolutePath, relDirectory: relPath, layers });
      continue;
    }

    // Symlinks: follow only when the target stays inside the root, mirroring discovery's guard so a
    // link can't pull external files into the deterministic corpus.
    if (entry.isSymbolicLink()) {
      const resolvedTargetPath = await realpath(absolutePath).catch(() => undefined);
      if (resolvedTargetPath === undefined || !isInsideRoot(resolvedTargetPath, params.rootRealPath)) {
        continue;
      }
      const resolvedStats = await stat(absolutePath).catch(() => undefined);
      if (resolvedStats === undefined || !resolvedStats.isFile()) {
        continue;
      }
    } else if (!entry.isFile()) {
      continue;
    }

    if (
      !matchesConfigGlob(relPath, params.patterns) ||
      matchesConfigGlob(relPath, params.exclude) ||
      isGitIgnored(relPath, false, layers)
    ) {
      continue;
    }

    params.results.push(relPath);
  }
}

/**
 * Deterministic document loader (P1.05): expand `patterns` under `cwd`, read + parse each match into
 * a `ParsedDocument`, and return `Map<absolutePathPosix, ParsedDocument>` with sorted, POSIX keys.
 *
 * `exclude`/`respectGitignore` are honored when passed but are not yet config-driven — P2 wires
 * `config.exclude` / `config.respectGitignore` through here without changing this signature.
 */
export async function loadDocuments(
  patterns: string[],
  options: LoadDocumentsOptions
): Promise<Map<string, ParsedDocument>> {
  const rootDisplayPath = path.resolve(options.cwd);
  const rootStats = await stat(rootDisplayPath).catch(() => undefined);

  if (rootStats === undefined || !rootStats.isDirectory()) {
    return new Map();
  }

  const rootRealPath = await realpath(rootDisplayPath);
  const results: string[] = [];

  await collectFiles({
    directoryPath: rootDisplayPath,
    relDirectory: "",
    rootDisplayPath,
    rootRealPath,
    patterns,
    exclude: options.exclude ?? [],
    respectGitignore: options.respectGitignore ?? false,
    layers: [],
    results
  });

  // Sort before reading so map insertion order (and every array derived from it) is deterministic.
  results.sort((left, right) => left.localeCompare(right));

  const documents = new Map<string, ParsedDocument>();

  for (const relPath of results) {
    const absolutePath = path.join(rootDisplayPath, relPath);
    const content = await readFile(absolutePath, "utf8");
    documents.set(
      toPosixAbsolute(absolutePath),
      parseDocument({ path: relPath, content })
    );
  }

  return documents;
}
