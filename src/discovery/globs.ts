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

export function matchesConfigGlob(filePath: string, patterns: string[]): boolean {
  return micromatch.isMatch(normalizeRelativePath(filePath), normalizeConfigGlobs(patterns), {
    dot: true
  });
}
