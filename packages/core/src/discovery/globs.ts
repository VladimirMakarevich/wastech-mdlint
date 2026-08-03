import micromatch from "micromatch";

function normalizePathValue(value: string): string {
  return value.replaceAll("\\", "/");
}

export function normalizeConfigGlob(pattern: string): string {
  const normalizedPattern = normalizePathValue(pattern);

  if (normalizedPattern.includes("/")) {
    return normalizedPattern;
  }

  return `**/${normalizedPattern}`;
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

export function matchesConfigGlob(
  filePath: string,
  patterns: string[],
): boolean {
  return micromatch.isMatch(
    normalizeRelativePath(filePath),
    normalizeConfigGlobs(patterns),
    {
      dot: true,
    },
  );
}
