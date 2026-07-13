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
  "target"
];

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
  "guides"
];

// N_MIN: how many Markdown files a non-known-named directory needs to qualify as a cluster,
// and the score bonus a known-named directory gets.
export const DEFAULT_MIN_CLUSTER_SIZE = 3;

// How many sample files a cluster reports for downstream rule inference (P6.02) to sniff.
export const DEFAULT_SAMPLE_SIZE = 5;
