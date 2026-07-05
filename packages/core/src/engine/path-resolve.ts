import path from "node:path";

import { normalizeRelativePath } from "../discovery/globs.js";
import { resolveRoutedUrl } from "./site-router.js";
import type { SiteRouterSettings } from "./types.js";

// Shared link/image target-resolution helpers used by the reference primitives (P2.02) and REF-002
// (P3.04). Centralized so link resolution behaves identically across rules.

// The file part of a target (drop any `#fragment`).
export function filePart(rawTarget: string): string {
  return rawTarget.split("#", 1)[0] ?? "";
}

// Resolve a relative target against the source file's directory → repo-relative POSIX path.
export function resolveRelativeToSource(sourcePath: string, target: string): string {
  const sourceDir = path.posix.dirname(sourcePath);
  return normalizeRelativePath(path.posix.normalize(path.posix.join(sourceDir, target)));
}

// True when a repo-relative path escapes the repository root (can't be resolved in-corpus).
export function escapesRoot(relPath: string): boolean {
  return relPath === ".." || relPath.startsWith("../");
}

// The locale segment of a source path under a router content dir (e.g. `.../docs/de/x.md` → "de").
export function sourceLocale(sourcePath: string, router: SiteRouterSettings): string | undefined {
  const contentDir = router.contentDir ?? "src/content/docs";
  if (!sourcePath.startsWith(`${contentDir}/`)) {
    return undefined;
  }
  const rest = sourcePath.slice(contentDir.length + 1);
  const segment = rest.split("/")[0];
  return segment.length > 0 && segment !== rest ? segment : undefined;
}

// Ordered repo-relative candidates a link/image/import target could resolve to, shared by the graph
// builder (P4.06) and REF rules so root-relative/router resolution never disagrees between the two
// consumers. Callers check candidates in order against whatever "exists" means for them (a corpus
// node set, or the filesystem) — this helper only enumerates possibilities.
export function resolveTargetCandidates(
  sourcePath: string,
  targetFilePart: string,
  siteRouter?: SiteRouterSettings
): string[] {
  if (targetFilePart.length === 0) {
    return [];
  }

  if (!targetFilePart.startsWith("/")) {
    return [resolveRelativeToSource(sourcePath, targetFilePart)];
  }

  if (siteRouter !== undefined) {
    return resolveRoutedUrl(targetFilePart, siteRouter, sourceLocale(sourcePath, siteRouter)).map((candidate) =>
      normalizeRelativePath(candidate)
    );
  }

  return [normalizeRelativePath(path.posix.normalize(targetFilePart.replace(/^\/+/, "")))];
}
