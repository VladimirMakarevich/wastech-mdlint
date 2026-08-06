// Shared tunables for P6.01 repo scanning (doc-cluster detection + workspace-package
// detection). Both modules need the same NOISE list; a single source avoids duplicating the
// literal array and avoids a value-level import cycle between the two.

// Directories pruned from every scan: build output, VCS metadata, and dependency trees never
// contain source-of-truth Markdown worth clustering.
export const DEFAULT_NOISE_DIR_NAMES: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  ".next",
  ".cache",
  "target",
];

/**
 * True when a directory basename must be skipped by every repo-scan walk: an explicit noise name,
 * or any dot-prefixed directory.
 *
 * Hidden directories are pruned by shape rather than by name (audit L-7) because the noise list can
 * never enumerate them: `.github`, `.venv`, `.husky`, `.changeset` and friends hold tooling
 * Markdown that `init` would otherwise propose as a doc cluster. The default `exclude` mirrors this
 * with a hidden-directory exclude glob (see `HIDDEN_DIR_EXCLUDE_GLOB` in config/corpus-scope.ts,
 * which is both what `init` writes and what every run excludes since P13.02), so the scan's view and
 * the linted corpus agree.
 *
 * `.` and `..` never reach this (`readdir` does not emit them), so the plain prefix test is safe.
 */
export function isPrunedDirName(
  name: string,
  noiseDirNames: readonly string[],
): boolean {
  return name.startsWith(".") || noiseDirNames.includes(name);
}

// Directory basenames that qualify as a doc cluster with as little as one Markdown file (the
// scoring bonus in the cluster heuristic), matched case-insensitively.
export const DEFAULT_KNOWN_CLUSTER_NAMES: readonly string[] = [
  "docs",
  "documentation",
  "doc",
  "specs",
  "spec",
  "adr",
  "rfc",
  "rfcs",
  "references",
  "reference",
  "guides",
];

// N_MIN: how many Markdown files a non-known-named directory needs to qualify as a cluster,
// and the score bonus a known-named directory gets.
export const DEFAULT_MIN_CLUSTER_SIZE = 3;

// How many sample files a cluster reports for downstream rule inference (P6.02) to sniff.
export const DEFAULT_SAMPLE_SIZE = 5;
