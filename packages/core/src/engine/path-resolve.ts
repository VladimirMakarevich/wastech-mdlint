import path from "node:path";

import { normalizeRelativePath } from "../discovery/globs.js";
import { resolveRoutedUrl } from "./site-router.js";
import type { SiteRouterSettings } from "./types.js";

// Shared link/image target-resolution helpers used by the reference primitives and REF-002
// Centralized so link resolution behaves identically across rules.

// The file part of a target (drop any `#fragment`).
export function filePart(rawTarget: string): string {
  return rawTarget.split("#", 1)[0] ?? "";
}

// Resolve a relative target against the source file's directory → repo-relative POSIX path.
export function resolveRelativeToSource(
  sourcePath: string,
  target: string,
): string {
  const sourceDir = path.posix.dirname(sourcePath);
  return normalizeRelativePath(
    path.posix.normalize(path.posix.join(sourceDir, target)),
  );
}

// True when a repo-relative path escapes the repository root (can't be resolved in-corpus).
export function escapesRoot(relPath: string): boolean {
  return relPath === ".." || relPath.startsWith("../");
}

// True when an internally-built, repo-relative candidate (as produced by
// `resolveRelativeToSource`/`resolveTargetCandidates`) escapes the repository root. Complements
// the literal `..`-prefix check in `escapesRoot`: enough `../` segments can cancel out the source
// directory and leave a bare drive-absolute remainder (e.g. `c:/Windows/x.md`, from a link like
// `../c:/Windows/x.md`) that never starts with `..` but that `path.win32.resolve` still treats as
// absolute, ignoring `rootDir` entirely — a no-op on POSIX, where these candidates never carry a
// leading `/` by construction.
export function candidateEscapesRoot(relPath: string): boolean {
  return escapesRoot(relPath) || path.isAbsolute(relPath);
}

// True when a raw, filesystem-facing path — as supplied directly by config or an MCP caller, not
// yet corpus-normalized — would resolve outside `rootDir`. Complements `escapesRoot` above: that
// helper only ever sees repo-relative POSIX candidates link/image resolution builds internally
// (never OS-absolute by construction), whereas an option like SEC-003's `template` hands
// `path.resolve` a raw string that can itself be absolute (which `path.resolve` honors verbatim,
// ignoring `rootDir` entirely) or a relative path whose `..` segments climb past it.
export function resolvesOutsideRoot(rootDir: string, rawPath: string): boolean {
  if (path.isAbsolute(rawPath)) {
    return true;
  }
  const relativeToRoot = path.relative(rootDir, path.resolve(rootDir, rawPath));
  // A Windows drive-relative path (e.g. "D:secret.md") is not `path.isAbsolute`, but resolves
  // against a different drive than `rootDir`. `path.relative` cannot express a cross-drive
  // relationship as a "../"-prefixed path, so it returns the absolute `to` path unchanged — treat
  // that as escaping too, instead of falling through as "inside root".
  return (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  );
}

// The locale segment of a source path under a router content dir (e.g. `.../docs/de/x.md` → "de").
export function sourceLocale(
  sourcePath: string,
  router: SiteRouterSettings,
): string | undefined {
  const contentDir = router.contentDir ?? "src/content/docs";
  if (!sourcePath.startsWith(`${contentDir}/`)) {
    return undefined;
  }
  const rest = sourcePath.slice(contentDir.length + 1);
  const segment = rest.split("/")[0];
  return segment.length > 0 && segment !== rest ? segment : undefined;
}

// Ordered repo-relative candidates a link/image/import target could resolve to, shared by the graph
// builder and REF rules so root-relative/router resolution never disagrees between the two
// consumers. Callers check candidates in order against whatever "exists" means for them (a corpus
// node set, or the filesystem) — this helper only enumerates possibilities.
export function resolveTargetCandidates(
  sourcePath: string,
  targetFilePart: string,
  siteRouter?: SiteRouterSettings,
): string[] {
  if (targetFilePart.length === 0) {
    return [];
  }

  if (!targetFilePart.startsWith("/")) {
    return [resolveRelativeToSource(sourcePath, targetFilePart)];
  }

  if (siteRouter !== undefined) {
    return resolveRoutedUrl(
      targetFilePart,
      siteRouter,
      sourceLocale(sourcePath, siteRouter),
    ).map((candidate) => normalizeRelativePath(candidate));
  }

  return [
    normalizeRelativePath(
      path.posix.normalize(targetFilePart.replace(/^\/+/, "")),
    ),
  ];
}
