import type { SiteRouterSettings } from "./types.js";

// `site-router` util (P3.01): map a root-relative site URL to candidate repo-relative source files.
// Introduced here because REF-001's `linkResolves` primitive (P2.02) needs it; P3.04 layers the
// i18n same-locale-first fallback on top of these candidates.
//
// Only the `starlight` preset is modeled in v2 (the reference SSG). Unknown presets fall back to
// treating the URL as a plain repo-root-relative path.

const DEFAULT_CONTENT_DIR = "src/content/docs";

function stripSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function starlightCandidates(routePath: string, contentDir: string): string[] {
  if (routePath.length === 0) {
    // A bare `/` targets the docs index.
    return [`${contentDir}/index.md`, `${contentDir}/index.mdx`];
  }

  return [
    `${contentDir}/${routePath}.md`,
    `${contentDir}/${routePath}.mdx`,
    `${contentDir}/${routePath}/index.md`,
    `${contentDir}/${routePath}/index.mdx`
  ];
}

/**
 * Resolve a root-relative URL to the candidate repo-relative files it could map to.
 *
 * `sourceLocale` (the locale segment of the linking file, if any) drives i18n resolution: a
 * non-default-locale source resolves same-locale first (`/<locale>/<path>`), then falls back to the
 * default locale — the P3.04 REF-001 rule. Callers check the returned candidates against the corpus
 * / filesystem in order.
 */
export function resolveRoutedUrl(
  url: string,
  router: SiteRouterSettings,
  sourceLocale?: string
): string[] {
  const contentDir = router.contentDir ?? DEFAULT_CONTENT_DIR;
  const routePath = stripSlashes(url);

  if (router.preset !== "starlight") {
    // No known SSG routing: treat the URL as repo-root-relative.
    return [routePath];
  }

  const candidates: string[] = [];
  const firstSegment = routePath.split("/")[0];
  const hasExplicitLocale =
    firstSegment.length > 0 && firstSegment === (sourceLocale ?? router.defaultLocale);

  // Same-locale first when the source lives under a non-default locale and the URL is not already
  // locale-qualified (audit — P3 REF gap i18n).
  if (
    sourceLocale !== undefined &&
    sourceLocale !== router.defaultLocale &&
    !hasExplicitLocale
  ) {
    candidates.push(...starlightCandidates(`${sourceLocale}/${routePath}`, contentDir));
  }

  candidates.push(...starlightCandidates(routePath, contentDir));

  return candidates;
}
