import micromatch from "micromatch";

function normalizePathValue(value: string): string {
  return value.replaceAll("\\", "/");
}

// Length of the leading run of `!` that negates a config glob (W-01). Peeling stops at `!(`, which
// picomatch reads as a negated *extglob* rather than a negation: its `!` branch opens an extglob when
// the next character is `(` and only calls `negate()` otherwise (`picomatch/lib/parse.js`). Treating
// that as a negation would rewrite the working `**/!(x).md` into `!**/(x).md` and invert a scope.
//
// The whole run is peeled rather than just the first `!`, so an even count cancels in picomatch's own
// `negate()` — which is what the slash-containing branch below already does by passing through
// untouched, and the two branches must not disagree.
function globNegationLength(pattern: string): number {
  let length = 0;

  while (pattern[length] === "!" && pattern[length + 1] !== "(") {
    length += 1;
  }

  // A pattern that is nothing but `!` negates nothing, so report no negation and let it take the
  // ordinary path: `**/!` keeps matching a file named `!`, where a bare `!` would reach picomatch as
  // an empty negation.
  return length === pattern.length ? 0 : length;
}

export function normalizeConfigGlob(pattern: string): string {
  const normalizedPattern = normalizePathValue(pattern);
  // The depth-agnostic prefix belongs on the pattern *body*, not on the pattern: `!keep.md` has to
  // become `!**/keep.md`, because `**/!keep.md` is a literal-filename pattern and therefore a silent
  // no-op (W-01, second half). A `./` the prefix would hide needs no handling — picomatch strips it
  // relative to the start it advances past for the negation, so `!./docs/**` anchors like
  // `!docs/**`.
  const negationLength = globNegationLength(normalizedPattern);
  const body = normalizedPattern.slice(negationLength);

  if (body.includes("/")) {
    return normalizedPattern;
  }

  // With no negation this is `**/${normalizedPattern}` — byte-identical to the pre-W-01 output, which
  // is what keeps `init`'s root-only `./*.{md,mdx}` proposal and every other non-negated config
  // matching exactly as before.
  return `${normalizedPattern.slice(0, negationLength)}**/${body}`;
}

export function normalizeConfigGlobs(patterns: string[]): string[] {
  return patterns.map(normalizeConfigGlob);
}

export function normalizeRelativePath(filePath: string): string {
  return normalizePathValue(filePath).replace(/^\.\/+/, "");
}

// True when a config entry is a glob rather than a plain path. STR-001 (P11.12) uses this to split
// "match anything in the corpus" entries from literal paths it can pin to one location on disk.
// Backslashes are normalized first because picomatch reads `\` as an escape character, which would
// make a Windows-style `docs\README.md` parse as an escaped literal instead of a path.
export function isGlobPattern(pattern: string): boolean {
  return micromatch.scan(normalizePathValue(pattern)).isGlob;
}

/**
 * True when `filePath` is selected by `patterns`, evaluated **in order**: a leading `!` subtracts, and
 * the last entry that matches decides. Every glob surface in the product goes through here.
 */
export function matchesConfigGlob(
  filePath: string,
  patterns: string[],
): boolean {
  // Match a one-item list (`micromatch(list, patterns)`) rather than `isMatch(input, patterns)`
  // (W-01 / audit F1). `isMatch` is a first-truthy OR across the array in which a `!` entry compiles
  // to an *inverting* matcher, so `["docs/public/**", "!docs/private/**"]` read as "under docs/public
  // OR not under docs/private" — true for almost every path in a repository. The list form is the
  // only place micromatch applies negation across a set, and it is the same call shape
  // `workspace-packages.ts` already uses for the same reason.
  //
  // A one-item list keeps the semantics per-path: micromatch keys its keep/omit sets by the matcher's
  // `output`, which is derived from the *input* (formatted by the same options for every pattern), so
  // the sets line up on every platform and no two paths can interact.
  //
  // For a list with no negated entry micromatch's `negatives === 0` path reduces to "matched at least
  // one pattern" — byte-identical to the `isMatch` OR — so nothing changes for a non-negated config,
  // and an empty list still matches nothing.
  return (
    micromatch(
      [normalizeRelativePath(filePath)],
      normalizeConfigGlobs(patterns),
      {
        dot: true,
      },
    ).length > 0
  );
}
