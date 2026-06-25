declare module "micromatch" {
  type MicromatchOptions = {
    dot?: boolean;
  };

  const micromatch: {
    isMatch(input: string, patterns: string | string[], options?: MicromatchOptions): boolean;
  };

  export default micromatch;
}
