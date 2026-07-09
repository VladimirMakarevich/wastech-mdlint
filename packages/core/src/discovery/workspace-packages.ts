import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import micromatch from "micromatch";

import { normalizeRelativePath } from "./globs.js";
import { DEFAULT_NOISE_DIR_NAMES } from "./repo-scan-constants.js";

export type WorkspacePackage = { path: string; name?: string };

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as unknown;
  } catch {
    // Missing or malformed package.json / pnpm-workspace.yaml means "no declaration here", not
    // an error — a repo scan has to tolerate an unusual or partially-broken tree.
    return undefined;
  }
}

function extractPackageName(parsed: unknown): string | undefined {
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return undefined;
  }

  const name = (parsed as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function extractWorkspaceGlobsFromPackageJson(parsed: unknown): string[] | undefined {
  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return undefined;
  }

  const workspaces = (parsed as { workspaces?: unknown }).workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces.filter((entry): entry is string => typeof entry === "string");
  }

  if (workspaces !== null && typeof workspaces === "object") {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return undefined;
}

// A narrow, line-based reader for pnpm-workspace.yaml's `packages:` block. Handles the common
// block-sequence form, both indented (`packages:\n  - 'a'\n  - 'b'`) and unindented
// (`packages:\n- 'a'\n- 'b'`) — deliberately not a general YAML parser (flow sequences like
// `packages: [a, b]` and anchors are unsupported) to avoid adding a `yaml` dependency for a
// narrow, common-case need. Upgrade this (or add the dependency) later if a real-world config
// needs the flow form.
function extractWorkspaceGlobsFromPnpmYaml(content: string): string[] | undefined {
  const lines = content.split(/\r?\n/);
  const packagesLineIndex = lines.findIndex((line) => /^packages:\s*$/.test(line));

  if (packagesLineIndex === -1) {
    return undefined;
  }

  const globs: string[] = [];

  for (let index = packagesLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined || line.trim().length === 0) {
      break;
    }

    const trimmed = line.trimStart();

    // A block-sequence item may be indented (`  - glob`) or unindented (`- glob` — valid YAML
    // when the sequence is written at the same level as its `packages:` key). Stop only at a
    // genuine new top-level key: a non-indented line that is not itself a list item.
    if (!line.startsWith(" ") && !trimmed.startsWith("-")) {
      break;
    }

    // Accept a quoted (`- 'a'`) or bare (`- a`) glob, each optionally followed by a trailing
    // YAML comment (`- 'a' # note`) — a real pnpm-workspace.yaml commonly annotates entries
    // this way, and dropping the whole line for it would silently under-detect the monorepo.
    const match = /^-\s*(?:(['"])([^'"]*)\1|([^'"#\s][^#]*?))\s*(?:#.*)?$/.exec(trimmed);
    const value = match?.[2] ?? match?.[3];
    if (value !== undefined) {
      globs.push(value);
    }
  }

  // The `packages:` key was present, so this is an explicit (if possibly empty) declaration —
  // the caller must not fall back to sibling-directory detection for it. `undefined` is
  // reserved for "no packages: key at all".
  return globs;
}

async function collectPackageJsonDirs(
  cwd: string,
  noiseDirNames: readonly string[]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(directoryPath: string, relDirectory: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
    let hasPackageJson = false;

    for (const entry of entries) {
      if (entry.isFile() && entry.name === "package.json") {
        hasPackageJson = true;
      }
    }

    // The root itself is never a WorkspacePackage — only sub-directories are candidates.
    if (hasPackageJson && relDirectory !== "") {
      results.push(relDirectory);
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !noiseDirNames.includes(entry.name)) {
        const childRel = relDirectory === "" ? entry.name : `${relDirectory}/${entry.name}`;
        await walk(path.join(directoryPath, entry.name), childRel);
      }
    }
  }

  await walk(cwd, "");
  return results;
}

function detectSiblingFallback(packageJsonDirs: string[]): string[] {
  const byParent = new Map<string, string[]>();

  for (const dir of packageJsonDirs) {
    const parent = path.posix.dirname(dir);
    const list = byParent.get(parent);
    if (list === undefined) {
      byParent.set(parent, [dir]);
    } else {
      list.push(dir);
    }
  }

  const detected: string[] = [];

  for (const [parent, children] of byParent) {
    const parentBasename = path.posix.basename(parent);
    if ((parentBasename === "packages" || parentBasename === "apps") && children.length >= 2) {
      detected.push(...children);
    }
  }

  return detected;
}

/**
 * Detects workspace packages via (in order) npm/yarn `package.json#workspaces`,
 * `pnpm-workspace.yaml`, or — only when neither declares anything explicit — a sibling
 * `packages/*` / `apps/*` fallback heuristic (>=2 sibling `package.json` dirs under a parent
 * named exactly `packages` or `apps`). Returns `[]` for an ordinary single-package repo.
 *
 * This is the public, task/plan-contract surface (single `cwd` argument, barrel-exported from
 * `@wastech-mdlint/core`) — see {@link detectWorkspacePackagesWithNoise} for the internal,
 * noise-dir-aware variant `scanRepository` uses.
 */
export async function detectWorkspacePackages(cwd: string): Promise<WorkspacePackage[]> {
  return detectWorkspacePackagesWithNoise(cwd, DEFAULT_NOISE_DIR_NAMES);
}

/**
 * The `noiseDirNames`-aware implementation behind {@link detectWorkspacePackages}. Exported
 * only for `scanRepository` (repo-scan.ts) to call directly — it is not part of the package's
 * public API (not re-exported from the core barrel) — because threading a caller-overridden
 * noise list through the standalone `detectWorkspacePackages(cwd)` contract would leak a
 * scanner-internal tuning knob into it. `scanRepository` needs this so a caller-customized
 * noise list prunes workspace-package detection the same way it prunes the Markdown walk.
 */
export async function detectWorkspacePackagesWithNoise(
  cwd: string,
  noiseDirNames: readonly string[]
): Promise<WorkspacePackage[]> {
  const packageJsonPath = path.join(cwd, "package.json");
  const rootPackageJson = await readJsonFile(packageJsonPath);
  let globs = extractWorkspaceGlobsFromPackageJson(rootPackageJson);

  if (globs === undefined) {
    const pnpmYaml = await readFile(path.join(cwd, "pnpm-workspace.yaml"), "utf8").catch(
      () => undefined
    );
    if (pnpmYaml !== undefined) {
      globs = extractWorkspaceGlobsFromPnpmYaml(pnpmYaml);
    }
  }

  const packageJsonDirs = await collectPackageJsonDirs(cwd, noiseDirNames);
  const resolvedGlobs = globs;
  // Presence of a declaration — even one that resolves to zero globs (`workspaces: []`, an
  // empty pnpm `packages:` block) — must suppress the sibling fallback; only the total
  // absence of a declaration should trigger it.
  //
  // Match the whole list at once (`micromatch(list, patterns)`), not per-dir `isMatch()`:
  // isMatch() evaluates each candidate against the pattern array in isolation, so an ordered
  // negation like `["packages/*", "!packages/private"]` never actually excludes anything —
  // every candidate independently matches the positive pattern. Matching the list as a whole
  // applies the negation across the set the way npm/Yarn/pnpm workspace globs are specified.
  const matchedDirs =
    resolvedGlobs !== undefined
      ? micromatch(packageJsonDirs, resolvedGlobs, { dot: true })
      : detectSiblingFallback(packageJsonDirs);

  const packages: WorkspacePackage[] = [];

  for (const dir of matchedDirs) {
    const parsed = await readJsonFile(path.join(cwd, dir, "package.json"));
    packages.push({ path: normalizeRelativePath(dir), name: extractPackageName(parsed) });
  }

  packages.sort((left, right) => left.path.localeCompare(right.path));
  return packages;
}
