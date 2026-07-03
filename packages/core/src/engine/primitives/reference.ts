import { existsSync } from "node:fs";
import path from "node:path";

import { matchesConfigGlob, normalizeRelativePath } from "../../discovery/globs.js";
import type { ParsedDocument, ParsedLink } from "../../markdown/document-types.js";
import { resolveRoutedUrl } from "../site-router.js";
import type { SiteRouterSettings } from "../types.js";
import type { PrimitiveContext, PrimitiveFinding } from "./types.js";

type ReferenceContext = Pick<PrimitiveContext, "documents" | "rootDir" | "settings">;

// The file part of a link/image target (drop any `#fragment`).
function filePart(rawTarget: string): string {
  return rawTarget.split("#", 1)[0] ?? "";
}

function resolveRelativeToSource(sourcePath: string, target: string): string {
  const sourceDir = path.posix.dirname(sourcePath);
  return normalizeRelativePath(path.posix.normalize(path.posix.join(sourceDir, target)));
}

function escapesRoot(relPath: string): boolean {
  return relPath === ".." || relPath.startsWith("../");
}

// A repo-relative target "resolves" if it is in the Markdown corpus or exists on disk (the latter
// covers files outside `include`, e.g. images — audit P3 REF gap, avoids false positives).
function targetResolves(
  relPath: string,
  context: ReferenceContext
): boolean {
  if (escapesRoot(relPath)) {
    return false;
  }

  return context.documents.has(relPath) || existsSync(path.resolve(context.rootDir, relPath));
}

// The locale segment of a source path under a router content dir (e.g. `.../docs/de/x.md` → "de").
function sourceLocale(sourcePath: string, router: SiteRouterSettings): string | undefined {
  const contentDir = router.contentDir ?? "src/content/docs";
  if (!sourcePath.startsWith(`${contentDir}/`)) {
    return undefined;
  }
  const rest = sourcePath.slice(contentDir.length + 1);
  const segment = rest.split("/")[0];
  return segment.length > 0 && segment !== rest ? segment : undefined;
}

export type LinkResolvesOptions = { exclude?: string[]; siteRouter?: SiteRouterSettings };

// linkResolves — relative links resolve to a real file (REF-001). Relative links resolve against the
// source file; root-relative links go through the site router (same-locale first). Same-file anchors
// and non-local schemes are out of scope here (REF-002 validates anchors).
export function linkResolves(
  document: ParsedDocument,
  context: ReferenceContext,
  options: LinkResolvesOptions
): PrimitiveFinding[] {
  const router = options.siteRouter ?? context.settings.siteRouter;
  const findings: PrimitiveFinding[] = [];

  for (const link of document.links) {
    if (link.kind !== "local-file") {
      continue;
    }

    const target = filePart(link.rawTarget);

    if (target.length === 0) {
      continue;
    }

    const isRootRelative = target.startsWith("/");
    let resolved: boolean;

    if (isRootRelative && router !== undefined) {
      const candidates = resolveRoutedUrl(target, router, sourceLocale(document.path, router));
      resolved = candidates.some((candidate) => targetResolves(normalizeRelativePath(candidate), context));
    } else {
      const relTarget = isRootRelative
        ? normalizeRelativePath(path.posix.normalize(target.replace(/^\/+/, "")))
        : resolveRelativeToSource(document.path, target);

      if (options.exclude !== undefined && matchesConfigGlob(relTarget, options.exclude)) {
        continue;
      }

      resolved = targetResolves(relTarget, context);
    }

    if (!resolved) {
      findings.push({
        message: `Link target "${link.rawTarget}" does not resolve to a file.`,
        line: link.line,
        column: link.column,
        data: { target: link.rawTarget }
      });
    }
  }

  return findings;
}

export type ImageResolvesOptions = { exclude?: string[] };

// imageResolves — relative image targets exist on disk (REF-003). External images (http/data) and
// excluded targets are skipped. Images are usually not in the Markdown corpus, so this leans on
// existsSync.
export function imageResolves(
  document: ParsedDocument,
  context: ReferenceContext,
  options: ImageResolvesOptions
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const image of document.images) {
    const target = filePart(image.rawTarget);

    if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      // Skip empty and any scheme-qualified target (http:, https:, data:, …).
      continue;
    }

    const relTarget = target.startsWith("/")
      ? normalizeRelativePath(path.posix.normalize(target.replace(/^\/+/, "")))
      : resolveRelativeToSource(document.path, target);

    if (options.exclude !== undefined && matchesConfigGlob(relTarget, options.exclude)) {
      continue;
    }

    if (escapesRoot(relTarget) || !existsSync(path.resolve(context.rootDir, relTarget))) {
      findings.push({
        message: `Image target "${image.rawTarget}" does not resolve to a file.`,
        line: image.line,
        data: { target: image.rawTarget }
      });
    }
  }

  return findings;
}

// Keep the linked type referenced for callers that pass a full ParsedLink array elsewhere.
export type { ParsedLink };
