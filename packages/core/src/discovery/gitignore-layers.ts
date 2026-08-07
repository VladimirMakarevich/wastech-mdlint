import { readFile } from "node:fs/promises";
import path from "node:path";

import ignore, { type Ignore } from "ignore";

// Shared `.gitignore` matching for every directory walk in core. It lives here rather than inside
// `markdown/load-documents.ts` (its original home) because the pre-config repo scan must skip
// exactly the trees the lint corpus will skip: two independent matchers would let
// `init` propose an `include` for a directory the very config it writes then ignores.

/**
 * A `.gitignore` and the directory (repo-relative POSIX) that owns it. Each file is kept as its own
 * matcher so within-file negation (`!keep.md`) resolves correctly, and so layer precedence is
 * something `isGitIgnored` can decide rather than something the pattern order has already collapsed.
 *
 * **The order of a layer array is part of this type's contract: outermost first.** Both walks build
 * it that way, appending each directory's own layer as they descend, and `isGitIgnored` reads it in
 * reverse — the reversal *is* git's precedence rule, so a caller that hands over a differently
 * ordered array gets a differently ordered precedence.
 */
export type IgnoreLayer = { baseRel: string; ig: Ignore };

/**
 * What one layer, or all of them together, says about a path. The third state is the whole reason
 * precedence is expressible at all: "no rule here" has to fall through to the next layer, while "a
 * negation kept it" has to stop the search — the boolean `ignores()` collapses both into `false`.
 */
type Verdict = "ignored" | "kept" | "no-opinion";

/**
 * The layer-relative path to query, or undefined when this layer has no say over `relPath`: either a
 * different subtree, or `relPath` *is* the layer's own directory and nothing is left to test.
 * `ignore`'s `test()` throws on an empty path, so the second case must be filtered, not passed on.
 */
function relativeToLayer(relPath: string, baseRel: string): string | undefined {
  if (baseRel === "") {
    return relPath.length === 0 ? undefined : relPath;
  }
  if (!relPath.startsWith(`${baseRel}/`)) {
    return undefined;
  }
  const relToBase = relPath.slice(baseRel.length + 1);
  return relToBase.length === 0 ? undefined : relToBase;
}

/**
 * Ancestor-neutralized copies of a layer's matcher, keyed by layer and then by how many ancestor
 * levels a query has inside that layer. A `WeakMap` because layers are per-walk objects: nothing
 * here should outlive the walk that built them. The inner map is bounded by the tree's depth.
 */
const neutralizedLayers = new WeakMap<Ignore, Map<number, Ignore>>();

/**
 * A copy of `ig` that reports every one of a query's parent directories as kept, so its verdict
 * comes only from the patterns matching the queried path itself.
 *
 * This exists because `Ignore.test()` resolves a path's parents against *its own* rules and, per
 * git, refuses to re-include anything under a parent it considers excluded. That is right inside one
 * `.gitignore` and wrong across several: a deeper `.gitignore` may have re-included the very
 * directory this layer excluded (`artifacts/*` at the root, `!docs/` in `artifacts/.gitignore`), and
 * git then judges the files inside on patterns that match them directly. Layer precedence therefore
 * has to own the ancestor question — see `isGitIgnored` — and each layer has to answer for the path
 * alone.
 */
function neutralizedFor(ig: Ignore, ancestorDepth: number): Ignore {
  let byDepth = neutralizedLayers.get(ig);
  if (byDepth === undefined) {
    byDepth = new Map();
    neutralizedLayers.set(ig, byDepth);
  }

  const cached = byDepth.get(ancestorDepth);
  if (cached !== undefined) {
    return cached;
  }

  // One negation per ancestor level, each a slash-anchored, directory-only wildcard: `/*` + `/`,
  // then `/*/*` + `/`, and so on. Anchored so each matches exactly its own depth, directory-only so
  // none can ever match a file query, and added last so they win under gitignore's last-match-wins.
  // Naming the depths rather than splicing the actual directory names into pattern text is what
  // keeps a directory called `we[i]rd`, `a#b`, or `!x` from becoming a different pattern than its
  // own name — path text is never pattern text here.
  const negations: string[] = [];
  for (let depth = 1; depth <= ancestorDepth; depth += 1) {
    negations.push(`!/${"*/".repeat(depth)}`);
  }

  // `add(Ignore)` copies the source's compiled rules (documented overload), so the layer the walk
  // holds is never mutated and the copy keeps that layer's own case sensitivity.
  const neutralized = ignore().add(ig).add(negations);
  byDepth.set(ancestorDepth, neutralized);
  return neutralized;
}

/** One layer's own verdict for `relPath`, with any inherited ancestor exclusion suppressed. */
function layerVerdict(
  layer: IgnoreLayer,
  relPath: string,
  isDirectory: boolean,
): Verdict {
  const relToBase = relativeToLayer(relPath, layer.baseRel);
  if (relToBase === undefined) {
    return "no-opinion";
  }

  const ancestorDepth = relToBase.split("/").length - 1;
  const matcher =
    ancestorDepth === 0 ? layer.ig : neutralizedFor(layer.ig, ancestorDepth);
  // Directories are queried with a trailing slash so directory-only patterns (`node_modules/`)
  // match (see the `ignore` API).
  const { ignored, unignored } = matcher.test(
    isDirectory ? `${relToBase}/` : relToBase,
  );

  if (ignored) {
    return "ignored";
  }
  return unignored ? "kept" : "no-opinion";
}

/**
 * Resolve `relPath` against every layer that governs it, deepest layer first, stopping at the first
 * layer with an opinion. That order is git's rule: a nested `.gitignore` overrides its ancestors, so
 * `docs/.gitignore`'s `!keep.md` re-includes a file the root's `docs/*.md` excluded. The original
 * loop ran root-first and returned at the first layer that ignored, which silently dropped files
 * real `git` keeps.
 */
function resolveOwnVerdict(
  relPath: string,
  isDirectory: boolean,
  layers: IgnoreLayer[],
): Verdict {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const verdict = layerVerdict(layers[index], relPath, isDirectory);
    if (verdict !== "no-opinion") {
      return verdict;
    }
  }

  return "no-opinion";
}

/**
 * Test a repo-relative path against the active gitignore layers.
 */
export function isGitIgnored(
  relPath: string,
  isDirectory: boolean,
  layers: IgnoreLayer[],
): boolean {
  // Git decides this in two independent steps, and both of them obey layer precedence. First, an
  // excluded *directory* takes its whole subtree with it — nothing under it can be re-included.
  // Second, if no ancestor is excluded, only patterns matching the path itself count. Resolving the
  // ancestors here rather than leaving them to each layer's own `test()` is what lets a deeper
  // `!docs/` re-include a directory a root `artifacts/*` excluded and then keep the files inside it,
  // which is what real `git` does. Outermost prefix first, so the shallowest exclusion short-circuits
  // before the deeper prefixes are resolved at all.
  const segments = relPath.split("/");
  for (let end = 1; end < segments.length; end += 1) {
    const ancestor = segments.slice(0, end).join("/");
    if (resolveOwnVerdict(ancestor, true, layers) === "ignored") {
      return true;
    }
  }

  return resolveOwnVerdict(relPath, isDirectory, layers) === "ignored";
}

/**
 * Read the `.gitignore` owned by `directoryPath` into a layer, or undefined when there is none (or
 * it cannot be read — an unreadable ignore file means "no rules here", never a scan failure).
 */
export async function readIgnoreLayer(
  directoryPath: string,
  relDirectory: string,
): Promise<IgnoreLayer | undefined> {
  try {
    const content = await readFile(
      path.join(directoryPath, ".gitignore"),
      "utf8",
    );
    return { baseRel: relDirectory, ig: ignore().add(content) };
  } catch {
    return undefined;
  }
}
