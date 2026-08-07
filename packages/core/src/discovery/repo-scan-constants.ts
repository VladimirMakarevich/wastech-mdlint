// Shared tunables for repo scanning (doc-cluster detection + workspace-package
// detection). Both modules need the same NOISE list; a single source avoids duplicating the
// literal array and avoids a value-level import cycle between the two.

// Directories pruned from every scan: build output, VCS metadata, and dependency trees — hidden or
// not — never contain source-of-truth Markdown worth clustering. This list is also the sole source
// of the lint-time default `exclude` (config/corpus-scope.ts), so the rule for adding to it is
// narrower than "the scan would rather not walk this": a hidden directory earns a place here only
// when it is a dependency or build tree, never merely for being hidden. `.venv` and
// `.yarn` are here for that reason, which keeps the hidden-directory *count* walk in repo-scan.ts
// off a virtualenv or a Yarn Berry cache — but only off *those two*. The bound is name-based, so any
// unlisted hidden cache (`.tox`, `.gradle`, `.terraform`, `.turbo`, …) classifies as `"hidden"` and
// is walked to size it. That cost is accepted rather than fixed: name-listing every cache tool in
// existence would rot faster than the walk costs, and the walk happens once, during `init`.
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
  ".venv",
  ".yarn",
  "target",
];

/**
 * Why a repo-scan walk skipped a directory, or `undefined` when it did not. Noise is tested first,
 * so a dot-prefixed dependency tree (`.git`, `.venv`, `.yarn`, `.next`, `.cache`) reports as
 * `"noise"` and only the rest (`.github`, `.claude`, `.agents`, `.husky`, …) as `"hidden"`. The two
 * classes carry different consequences downstream — noise is also excluded at lint time, hidden is
 * not — so the distinction has to be made once, here, rather than re-derived per caller.
 *
 * Hidden directories are pruned from the *scan* by shape rather than by name because a
 * name list can never enumerate them, and a tooling directory proposed as a doc cluster is a
 * proposal the user did not ask for. That argument is about cluster inference and does not transfer
 * to the linted corpus, which is why `config/corpus-scope.ts` derives its default `exclude` from
 * `DEFAULT_NOISE_DIR_NAMES` alone. `init` discloses the gap instead (`formatScanExclusions`).
 *
 * `.` and `..` never reach this (`readdir` does not emit them), so the plain prefix test is safe.
 */
export function classifyPrunedDirName(
  name: string,
  noiseDirNames: readonly string[],
): "noise" | "hidden" | undefined {
  if (noiseDirNames.includes(name)) {
    return "noise";
  }
  return name.startsWith(".") ? "hidden" : undefined;
}

/**
 * True when a directory basename must be skipped by every repo-scan walk. Defined in terms of
 * {@link classifyPrunedDirName} rather than repeating its two tests, so the predicate and the
 * classification can never disagree about which directories a walk enters.
 */
export function isPrunedDirName(
  name: string,
  noiseDirNames: readonly string[],
): boolean {
  return classifyPrunedDirName(name, noiseDirNames) !== undefined;
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

// How many sample files a cluster reports for downstream rule inference to sniff.
export const DEFAULT_SAMPLE_SIZE = 5;
