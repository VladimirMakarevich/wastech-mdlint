import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { compareStrings } from "../deterministic-sort.js";
import { detectPackageManager, type DetectedPackageManager } from "./package-manager.js";
import {
  DEFAULT_KNOWN_CLUSTER_NAMES,
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_NOISE_DIR_NAMES,
  DEFAULT_SAMPLE_SIZE
} from "./repo-scan-constants.js";
import {
  detectWorkspacePackagesWithNoise,
  type WorkspacePackage
} from "./workspace-packages.js";

export type DocClusterKind = "cluster" | "root" | "fallback";

export type DocCluster = {
  // The scanned directory (repo-relative POSIX); "" for the repo-root "root" candidate and for
  // the global "fallback" entry.
  path: string;
  kind: DocClusterKind;
  score: number;
  subtreeCount: number;
  includeGlob: string;
  sampleFiles: string[];
  // Owning workspace package path; absent for repo-root-scoped entries.
  workspacePackage?: string;
};

export type RepoScanResult = {
  clusters: DocCluster[];
  packageManager: DetectedPackageManager;
  workspacePackages: WorkspacePackage[];
};

export type ScanRepositoryOptions = {
  cwd: string;
  sampleSize?: number;
  minClusterSize?: number;
  knownClusterNames?: string[];
  noiseDirNames?: string[];
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

function isMarkdownFile(fileName: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function dirnameOf(filePath: string): string {
  const dir = path.posix.dirname(filePath);
  return dir === "." ? "" : dir;
}

// Escapes glob-special characters in a literal repo-relative path before it is spliced into a
// generated `includeGlob`. Without this, a real directory like `docs[x]` or `apps(web)` is
// interpreted as glob syntax (a character class / extglob group / brace expansion) rather than
// a literal name, so the emitted pattern can match unrelated paths (`docsx`, `appsweb`) — or, in
// the brace-expansion case, fail to match its own literal directory at all — once fed back
// through matchesConfigGlob/loadDocuments.
//
// Escaping uses single-character bracket classes (`[x]`) rather than a backslash, because
// normalizeConfigGlob (discovery/globs.ts) converts every `\` to `/` when normalizing
// Windows-style separators — a backslash-escaped pattern would be silently unescaped before it
// ever reaches micromatch. `]` is placed first inside its own class, the bracket-expression
// convention for a literal `]`. `/` is left untouched — it is the path separator, not a
// wildcard.
const GLOB_SPECIAL_CHARS = /[\\*?[\]{}()!+@|]/g;

function escapeGlobPath(value: string): string {
  return value.replace(GLOB_SPECIAL_CHARS, (char) => (char === "]" ? "[]]" : `[${char}]`));
}

// A workspace package's scope owns only the Markdown files not also claimed by a deeper nested
// workspace package. Without this, a file under a nested package (e.g. a detected
// `packages/foo/examples/bar`) would be scanned twice: once under the ancestor `packages/foo`
// scope and again under its own — double-counting subtreeCount/scores and duplicating samples.
function isOwnedByPackageScope(
  file: string,
  workspacePackage: string,
  workspacePackages: WorkspacePackage[]
): boolean {
  if (!file.startsWith(`${workspacePackage}/`)) {
    return false;
  }

  return !workspacePackages.some(
    (pkg) =>
      pkg.path !== workspacePackage &&
      pkg.path.startsWith(`${workspacePackage}/`) &&
      file.startsWith(`${pkg.path}/`)
  );
}

// A private, NOISE-pruned recursive walk collecting *.md/*.mdx as repo-relative POSIX paths.
// Deliberately does not follow symlinks (unlike load-documents.ts's loop-safe symlink
// following): this is a heuristic pre-config scan, not the authoritative lint corpus, so
// `Dirent.isDirectory()`/`isFile()` both returning false for a symlink entry (the simplest
// "skip anything that isn't a plain dir/file" behavior) is an acceptable simplification.
async function collectMarkdownFiles(
  cwd: string,
  noiseDirNames: readonly string[]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(directoryPath: string, relDirectory: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const relPath = relDirectory === "" ? entry.name : `${relDirectory}/${entry.name}`;

      if (entry.isDirectory()) {
        if (noiseDirNames.includes(entry.name)) {
          continue;
        }
        await walk(path.join(directoryPath, entry.name), relPath);
        continue;
      }

      if (entry.isFile() && isMarkdownFile(entry.name)) {
        results.push(relPath);
      }
    }
  }

  await walk(cwd, "");
  return results;
}

type ScopeClustersParams = {
  scopeRoot: string;
  workspacePackage?: string;
  // Repo-relative POSIX markdown file paths already narrowed to this scope, in sorted order.
  files: string[];
  minClusterSize: number;
  // Lower-cased known-name set (the known-name bonus is matched case-insensitively).
  knownClusterNames: Set<string>;
  sampleSize: number;
};

// The scoring heuristic (docs/mdlint_v2/P6-init/01-repo-scan-detection.md), run once per scope
// (the repo root minus workspace-package files, or a single workspace package's own files).
// Root never "qualifies" as a cluster itself — if it did, its subtreeCount would almost always
// clear minClusterSize and the rollup step below would collapse everything into one giant
// cluster, defeating the heuristic. Root's own direct files instead become a low-priority
// "root"-kind candidate.
function computeScopeClusters(params: ScopeClustersParams): DocCluster[] {
  const { scopeRoot, workspacePackage, files, minClusterSize, knownClusterNames, sampleSize } =
    params;

  const dirCounts = new Map<string, number>();

  for (const file of files) {
    let dir = dirnameOf(file);

    for (;;) {
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      if (dir === scopeRoot) {
        break;
      }

      const parentDir = dirnameOf(dir);
      if (parentDir === dir) {
        // Files are pre-filtered to sit under scopeRoot, so this only guards against an
        // unexpected mismatch rather than a real case.
        break;
      }
      dir = parentDir;
    }
  }

  type Candidate = { dir: string; subtreeCount: number; score: number };
  const qualifying: Candidate[] = [];

  for (const [dir, subtreeCount] of dirCounts) {
    if (dir === scopeRoot) {
      continue;
    }

    const isKnown = knownClusterNames.has(path.posix.basename(dir).toLowerCase());
    if (subtreeCount >= minClusterSize || (isKnown && subtreeCount >= 1)) {
      qualifying.push({
        dir,
        subtreeCount,
        score: subtreeCount + (isKnown ? minClusterSize : 0)
      });
    }
  }

  // Shallowest first so the rollup below keeps the highest qualifying ancestor and naturally
  // drops deeper qualifying descendants it already covers (e.g. docs/ before docs/api/).
  qualifying.sort((left, right) => {
    const depthDiff = left.dir.split("/").length - right.dir.split("/").length;
    return depthDiff !== 0 ? depthDiff : compareStrings(left.dir, right.dir);
  });

  const kept: Candidate[] = [];
  for (const candidate of qualifying) {
    const coveredByKept = kept.some(
      (entry) => candidate.dir === entry.dir || candidate.dir.startsWith(`${entry.dir}/`)
    );
    if (!coveredByKept) {
      kept.push(candidate);
    }
  }

  // Spread the tag in only when defined — the public contract has repo-root-scoped entries
  // omit `workspacePackage` entirely, not carry it as an explicit `undefined` value.
  const workspacePackageTag = workspacePackage === undefined ? {} : { workspacePackage };

  const clusters: DocCluster[] = kept.map(({ dir, subtreeCount, score }) => ({
    path: dir,
    kind: "cluster",
    score,
    subtreeCount,
    includeGlob: `${escapeGlobPath(dir)}/**/*.{md,mdx}`,
    sampleFiles: files.filter((file) => file.startsWith(`${dir}/`)).slice(0, sampleSize),
    ...workspacePackageTag
  }));

  const directFiles = files.filter((file) => dirnameOf(file) === scopeRoot);
  if (directFiles.length > 0) {
    clusters.push({
      path: scopeRoot,
      kind: "root",
      score: directFiles.length,
      subtreeCount: directFiles.length,
      // `./`-prefixed so the pattern keeps its "/" — normalizeConfigGlob (discovery/globs.ts)
      // rewrites any slash-free pattern to `**/${pattern}`, which would silently turn a
      // root-only proposal into a repo-wide one once `init` writes it into config.
      includeGlob:
        scopeRoot === "" ? "./*.{md,mdx}" : `${escapeGlobPath(scopeRoot)}/*.{md,mdx}`,
      sampleFiles: directFiles.slice(0, sampleSize),
      ...workspacePackageTag
    });
  }

  return clusters;
}

const CLUSTER_KIND_RANK: Record<DocClusterKind, number> = { cluster: 0, root: 1, fallback: 2 };

/**
 * Scans a repository for Markdown doc clusters and the package manager in use (P6.01), so
 * `init` (P6.03/04) can propose defaults instead of hardcoding `docs/`. Pure and read-only;
 * does not write anything.
 */
export async function scanRepository(options: ScanRepositoryOptions): Promise<RepoScanResult> {
  const { cwd } = options;
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const minClusterSize = options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const knownClusterNames = new Set(
    (options.knownClusterNames ?? DEFAULT_KNOWN_CLUSTER_NAMES).map((name) => name.toLowerCase())
  );
  const noiseDirNames = options.noiseDirNames ?? DEFAULT_NOISE_DIR_NAMES;

  const rootStats = await stat(cwd).catch(() => undefined);
  if (rootStats === undefined || !rootStats.isDirectory()) {
    return { clusters: [], packageManager: undefined, workspacePackages: [] };
  }

  const [packageManager, workspacePackages, unsortedFiles] = await Promise.all([
    detectPackageManager(cwd),
    detectWorkspacePackagesWithNoise(cwd, noiseDirNames),
    collectMarkdownFiles(cwd, noiseDirNames)
  ]);

  const allFiles = unsortedFiles.sort(compareStrings);

  const scopes: { scopeRoot: string; workspacePackage?: string }[] = [
    { scopeRoot: "" },
    ...workspacePackages.map((pkg) => ({ scopeRoot: pkg.path, workspacePackage: pkg.path }))
  ];

  const clusters: DocCluster[] = [];

  for (const scope of scopes) {
    const workspacePackage = scope.workspacePackage;
    // Filtering the global file list by prefix is enough to exclude a workspace package's
    // files from the root scope — no special-casing needed, they simply have zero entries in
    // the root scope's dirCounts map. A package scope additionally excludes any file already
    // owned by a deeper nested workspace package (isOwnedByPackageScope), so nested packages
    // aren't scanned twice.
    const scopeFiles =
      workspacePackage === undefined
        ? allFiles.filter(
            (file) => !workspacePackages.some((pkg) => file.startsWith(`${pkg.path}/`))
          )
        : allFiles.filter((file) =>
            isOwnedByPackageScope(file, workspacePackage, workspacePackages)
          );

    clusters.push(
      ...computeScopeClusters({
        scopeRoot: scope.scopeRoot,
        workspacePackage,
        files: scopeFiles,
        minClusterSize,
        knownClusterNames,
        sampleSize
      })
    );
  }

  // The fallback is global (not per-scope): it only fires when nothing qualified anywhere but
  // Markdown exists somewhere. The glob is deliberately the literal `**/*.md` — the task spec's
  // "give up, cover everything the normal way" safety net mirrors the tool's actual zero-config
  // default include (lintFiles/fix/loadContext all default `config.include` to `["**/*.md"]`),
  // not the scan's own broader `.md`+`.mdx` discovery criteria. In an `.mdx`-only repo this
  // fallback's `sampleFiles` can include paths the glob itself won't match — an accepted,
  // documented tradeoff of proposing the tool's real default rather than a scan-specific one.
  if (clusters.length === 0 && allFiles.length > 0) {
    clusters.push({
      path: "",
      kind: "fallback",
      score: allFiles.length,
      subtreeCount: allFiles.length,
      includeGlob: "**/*.md",
      sampleFiles: allFiles.slice(0, sampleSize)
    });
  }

  clusters.sort((left, right) => {
    const rankDiff = CLUSTER_KIND_RANK[left.kind] - CLUSTER_KIND_RANK[right.kind];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const scoreDiff = right.score - left.score;
    return scoreDiff !== 0 ? scoreDiff : compareStrings(left.path, right.path);
  });

  return { clusters, packageManager, workspacePackages };
}
