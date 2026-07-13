declare module "micromatch" {
  type MicromatchOptions = {
    dot?: boolean;
  };

  // The callable form (`micromatch(list, patterns, options)`) matches the whole list against
  // ordered glob semantics in one pass, so a negated pattern (`!packages/private`) actually
  // excludes matches — unlike per-item `isMatch()`, which evaluates each candidate against the
  // pattern array in isolation and can't express "matches A but not B" across a set.
  interface Micromatch {
    (list: string[], patterns: string | string[], options?: MicromatchOptions): string[];
    isMatch(input: string, patterns: string | string[], options?: MicromatchOptions): boolean;
  }

  const micromatch: Micromatch;

  export default micromatch;
}
