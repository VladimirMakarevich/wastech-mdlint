import path from "node:path";

// What "a Markdown file" means, stated once (P13.05 / W-09). Three subsystems used to answer that
// question differently — coverage said `.md`+`.markdown`, the `init` scan said `.md`+`.mdx`, and the
// default `include` said `.md` alone — so the coverage signal, whose whole job is naming on-disk
// Markdown linked from the corpus but outside it, looked for an extension no default configuration
// could admit and was blind to the one `init` exists to find. Same shape as
// `discovery/gitignore-layers.ts`: one definition, every walk reads it.

/**
 * Every extension core treats as a Markdown file **on disk** — what the repo scan discovers and what
 * the coverage signal recognizes as an out-of-corpus document.
 *
 * `.markdown` is deliberately absent: it appeared only in the old coverage helper, nowhere else in
 * core and on no guide page, so recognizing it there could never lead anywhere a default `include`
 * would follow. A linked `.markdown` file is therefore invisible to coverage — see
 * `docs/mdlint_v2/accepted-behaviors.md` and the caveat on `docs/guide/context-graph.md`.
 */
export const MARKDOWN_EXTENSIONS: readonly string[] = [".md", ".mdx"];

/**
 * The subset the linter actually parses by default — the extensions `DEFAULT_INCLUDE_GLOBS` is built
 * from. Making `.mdx` first-class is a product decision with parser implications (P13.05 out of
 * scope), so the gap between this and {@link MARKDOWN_EXTENSIONS} is a stated subset relation rather
 * than a comment two files away that the next reader has to reconcile.
 */
export const LINTED_MARKDOWN_EXTENSIONS: readonly string[] = [".md"];

/**
 * The brace-expansion tail (`*.{md,mdx}`) `init` splices onto a proposed `includeGlob`, derived from
 * {@link MARKDOWN_EXTENSIONS} so a proposal can never advertise a narrower set than the scan walked.
 */
export const MARKDOWN_GLOB_SUFFIX = `*.{${MARKDOWN_EXTENSIONS.map((extension) =>
  extension.slice(1),
).join(",")}}`;

/**
 * True for a Markdown file name or repo-relative POSIX path.
 *
 * `path.posix.extname` rather than a suffix comparison, so one helper serves both a bare
 * `Dirent.name` (the repo scan) and a repo-relative candidate (coverage) — and always on POSIX
 * semantics, because every path core compares here is already normalized to `/`. Consequence worth
 * knowing: a file named exactly `.md` has no extension by that definition and is not a match, unlike
 * the `endsWith` check coverage used before.
 */
export function isMarkdownFile(pathOrName: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(
    path.posix.extname(pathOrName).toLowerCase(),
  );
}
