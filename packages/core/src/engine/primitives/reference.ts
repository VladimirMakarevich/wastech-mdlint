import { existsSync } from "node:fs";
import path from "node:path";

import { matchesConfigGlob } from "../../discovery/globs.js";
import type {
  ParsedDocument,
  ParsedLink,
} from "../../markdown/document-types.js";
import {
  candidateEscapesRoot,
  filePart,
  resolveTargetCandidates,
} from "../path-resolve.js";
import type { SiteRouterSettings } from "../types.js";
import type { PrimitiveContext, PrimitiveFinding } from "./types.js";

type ReferenceContext = Pick<
  PrimitiveContext,
  "documents" | "rootDir" | "settings"
>;

// A repo-relative target "resolves" if it is in the Markdown corpus or exists on disk (the latter
// covers files outside `include`, e.g. images — audit P3 REF gap, avoids false positives).
function targetResolves(relPath: string, context: ReferenceContext): boolean {
  if (candidateEscapesRoot(relPath)) {
    return false;
  }

  return (
    context.documents.has(relPath) ||
    existsSync(path.resolve(context.rootDir, relPath))
  );
}

// The `exclude` gate both primitives share (W-08). It matches the **resolved** repo-relative
// candidates, not the raw target, and a match on *any* candidate skips the target: `exclude` is a
// suppression filter and must never *create* a finding, which is what dropping matched candidates
// and re-resolving the rest would do for a link that only resolves via an excluded candidate. Under
// a router the list is one target expressed several ways, so "any" is also the honest reading.
//
// The whole list goes to `matchesConfigGlob` in one call — it is P13.01's ordered, negation-aware
// matcher, so evaluating patterns one at a time would lose a leading `!`'s subtraction.
function targetExcluded(
  candidates: readonly string[],
  exclude: string[] | undefined,
): boolean {
  return (
    exclude !== undefined &&
    candidates.some((candidate) => matchesConfigGlob(candidate, exclude))
  );
}

export type LinkResolvesOptions = {
  exclude?: string[];
  siteRouter?: SiteRouterSettings;
};

// linkResolves — relative links resolve to a real file (REF-001). Relative links resolve against the
// source file; root-relative links go through the site router (same-locale first). Same-file anchors
// and non-local schemes are out of scope here (REF-002 validates anchors).
export function linkResolves(
  document: ParsedDocument,
  context: ReferenceContext,
  options: LinkResolvesOptions,
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

    // One candidate list for every target shape (relative, root-relative, routed), so the `exclude`
    // gate below cannot go inert on one branch the way it did before P13.05 (W-08): a bare `{}`
    // router validates and resolves like the no-router case, yet used to turn the option off.
    const candidates = resolveTargetCandidates(document.path, target, router);

    if (targetExcluded(candidates, options.exclude)) {
      continue;
    }

    if (!candidates.some((candidate) => targetResolves(candidate, context))) {
      findings.push({
        message: `Link target "${link.rawTarget}" does not resolve to a file.`,
        line: link.line,
        column: link.column,
        data: { target: link.rawTarget },
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
  options: ImageResolvesOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const image of document.images) {
    const target = filePart(image.rawTarget);

    if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      // Skip empty and any scheme-qualified target (http:, https:, data:, …).
      continue;
    }

    // Deliberately router-blind, and the same shared helper the link path uses (W-10): a site
    // router maps a URL to *Markdown source* files, so routing an image target would only ever
    // offer `.md`/`.mdx` candidates for an asset — manufacturing REF-003 findings rather than
    // resolving them. Root-relative image targets resolve against the repository root, which is
    // what `docs/guide/rules/REF-003.md` documents.
    const candidates = resolveTargetCandidates(document.path, target);

    if (targetExcluded(candidates, options.exclude)) {
      continue;
    }

    // `candidateEscapesRoot` must run before `existsSync`: a `..`-cancelled drive-absolute
    // remainder would otherwise be probed outside `rootDir` on Windows (audit H-2 class).
    const resolved = candidates.some(
      (candidate) =>
        !candidateEscapesRoot(candidate) &&
        existsSync(path.resolve(context.rootDir, candidate)),
    );

    if (!resolved) {
      findings.push({
        message: `Image target "${image.rawTarget}" does not resolve to a file.`,
        line: image.line,
        data: { target: image.rawTarget },
      });
    }
  }

  return findings;
}

// Keep the linked type referenced for callers that pass a full ParsedLink array elsewhere.
export type { ParsedLink };
