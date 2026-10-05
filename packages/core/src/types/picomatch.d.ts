declare module "picomatch" {
  type PicomatchOptions = {
    dot?: boolean;
  };

  // `negatedExtglob` is only present once the parser has met a `!(` at the start of the pattern,
  // and a pattern that takes the parser's fast path never gets the field at all.
  type PicomatchState = {
    negated: boolean;
    negatedExtglob?: boolean;
  };

  // Only the result-object form (`matcher(input, true)`) is declared: the ordered-list matcher needs
  // `output`, the input as picomatch normalized it, to key its sets, and a plain boolean drops it.
  interface Matcher {
    (input: string, returnObject: true): { isMatch: boolean; output: string };
    state: PicomatchState;
  }

  interface Picomatch {
    // Only the `returnState` form is declared, because whether a pattern subtracts is read from the
    // parser state it attaches to the matcher — `negated` alone misses a leading `!(…)` extglob.
    (glob: string, options: PicomatchOptions, returnState: true): Matcher;
    // Parses a pattern the same way matching does, so "is this a glob or a literal path?" is
    // answered by the actual parser rather than a hand-rolled character check that could drift
    // from it. Only `isGlob` is declared — `base`/`glob`/the boolean sub-flags are unused here.
    scan(input: string, options?: PicomatchOptions): { isGlob: boolean };
  }

  const picomatch: Picomatch;

  export default picomatch;
}
