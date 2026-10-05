import picomatch from "picomatch";

function normalizePathValue(value: string): string {
  return value.replaceAll("\\", "/");
}

// Length of the leading run of `!` that negates a config glob. Peeling stops at `!(`, which
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
  // no-op. A `./` the prefix would hide needs no handling — picomatch strips it
  // relative to the start it advances past for the negation, so `!./docs/**` anchors like
  // `!docs/**`.
  const negationLength = globNegationLength(normalizedPattern);
  const body = normalizedPattern.slice(negationLength);

  if (body.includes("/")) {
    return normalizedPattern;
  }

  // With no negation this is `**/${normalizedPattern}` — byte-identical to what this function
  // emitted before negations were handled at all, which is what keeps `init`'s root-only
  // `./*.{md,mdx}` proposal and every other non-negated config matching exactly as before.
  return `${normalizedPattern.slice(0, negationLength)}**/${body}`;
}

export function normalizeConfigGlobs(patterns: string[]): string[] {
  return patterns.map(normalizeConfigGlob);
}

export function normalizeRelativePath(filePath: string): string {
  return normalizePathValue(filePath).replace(/^\.\/+/, "");
}

// True when a config entry is a glob rather than a plain path. STR-001 uses this to split
// "match anything in the corpus" entries from literal paths it can pin to one location on disk.
// Backslashes are normalized first because picomatch reads `\` as an escape character, which would
// make a Windows-style `docs\README.md` parse as an escaped literal instead of a path.
export function isGlobPattern(pattern: string): boolean {
  return picomatch.scan(normalizePathValue(pattern)).isGlob;
}

/**
 * The entries of `list` that `patterns` select, evaluated **in order**: a `!` entry subtracts what the
 * entries before it selected, a later positive entry adds it back, and so the last entry that matches
 * a path decides. A pattern list made only of negations starts from the whole list rather than from
 * nothing, so `["!drafts/**"]` reads as "everything except drafts".
 *
 * Each selected entry comes back as picomatch's normalized `output` for it, which on Windows has its
 * backslashes turned into `/`.
 */
export function matchGlobList(
  list: readonly string[],
  patterns: readonly string[],
): string[] {
  // This is the ordered-list algorithm micromatch runs, written directly over picomatch — which is
  // all micromatch did for this call — so the selection rules are unchanged while the tree loses
  // `braces`. That package has no patched release for a stack-exhaustion advisory on deeply nested
  // brace patterns, so `npm audit` reported it as high severity in every repository that installed
  // this package, even though nothing here ever called it: picomatch compiles `{a,b}` itself.
  //
  // The sets are keyed by `output` rather than by the input string so that two spellings of one
  // path (`a\b` and `a/b` on Windows) are one entry, and a negation that matched one spelling
  // removes both.
  const selected = new Set<string>();
  const omitted = new Set<string>();
  const tested = new Set<string>();
  let negatedCount = 0;

  for (const pattern of patterns) {
    const matcher = picomatch(pattern, { dot: true }, true);
    // A pattern that opens with `!(` compiles to a negated extglob, not a negation, yet it still
    // selects by exclusion — so it subtracts like `!x` and counts toward the all-negations case.
    const negated =
      matcher.state.negated || matcher.state.negatedExtglob === true;

    if (negated) {
      negatedCount += 1;
    }

    for (const entry of list) {
      // For a negated pattern `isMatch` is already inverted: false means the path matched the
      // pattern's body, which is exactly the path the negation subtracts.
      const { isMatch, output } = matcher(entry, true);
      tested.add(output);

      if (negated) {
        if (!isMatch) {
          omitted.add(output);
        }
      } else if (isMatch) {
        omitted.delete(output);
        selected.add(output);
      }
    }
  }

  const candidates = negatedCount === patterns.length ? tested : selected;
  return [...candidates].filter((output) => !omitted.has(output));
}

/**
 * True when `filePath` is selected by `patterns`, evaluated **in order**: a leading `!` subtracts, and
 * the last entry that matches decides. Every glob surface in the product goes through here.
 */
export function matchesConfigGlob(
  filePath: string,
  patterns: string[],
): boolean {
  // Match a one-item list (`matchGlobList`) rather than asking "does any pattern match?" — the two
  // are not interchangeable. Taken one at a time, a `!` entry compiles to an *inverting* matcher, so
  // `["docs/public/**", "!docs/private/**"]` would read as "under docs/public OR not under
  // docs/private" — true for almost every path in a repository. Only the list form applies negation
  // across the set, and it is the same call `workspace-packages.ts` makes for the same reason.
  //
  // A one-item list keeps the semantics per-path: no two paths can interact. With no negated entry
  // the list form reduces to "matched at least one pattern", so nothing changes for a non-negated
  // config, and an empty pattern list still matches nothing.
  return (
    matchGlobList(
      [normalizeRelativePath(filePath)],
      normalizeConfigGlobs(patterns),
    ).length > 0
  );
}
