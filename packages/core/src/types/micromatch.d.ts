declare module "micromatch" {
  type MicromatchOptions = {
    dot?: boolean;
  };

  // The callable form (`micromatch(list, patterns, options)`) matches the whole list against
  // ordered glob semantics in one pass, so a negated pattern (`!packages/private`) actually
  // excludes matches — unlike per-item `isMatch()`, which evaluates each candidate against the
  // pattern array in isolation and can't express "matches A but not B" across a set.
  interface Micromatch {
    (
      list: string[],
      patterns: string | string[],
      options?: MicromatchOptions,
    ): string[];
    isMatch(
      input: string,
      patterns: string | string[],
      options?: MicromatchOptions,
    ): boolean;
    // Parses a pattern the same way `isMatch` does, so "is this a glob or a literal path?" is
    // answered by the actual parser rather than a hand-rolled character check that could drift
    // from it. Only `isGlob` is declared — `base`/`glob`/the boolean sub-flags are unused here.
    scan(input: string, options?: MicromatchOptions): { isGlob: boolean };
  }

  const micromatch: Micromatch;

  export default micromatch;
}
