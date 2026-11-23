// Turning a URL path into a repository path is the one place a request reaches the filesystem, so
// it is a pure function with its own tests rather than a line inside a route handler. Every caller
// still checks the result against a set it built from the corpus before reading anything; this
// function exists so that a path which could only mean "outside the repository" is refused here,
// explicitly, instead of depending on that later lookup happening to miss.

/**
 * Decode the path part of a request (everything after the route prefix) into a repo-relative POSIX
 * path, or `undefined` when it cannot name a file inside the repository.
 *
 * The raw request target is decoded segment by segment rather than handed to `new URL`, because the
 * WHATWG parser silently resolves `..` (including `%2e%2e`) and turns `\` into `/` for http URLs, so
 * an escape attempt would arrive here already rewritten into some other in-repository path. Refusing
 * the attempt outright is easier to reason about than serving whatever it was normalized into.
 *
 * `platform` is a parameter so the Windows rules are tested on every host: on Windows `\` is a
 * separator and `:` introduces a drive or an alternate data stream (`README.md::$DATA`), so a segment
 * carrying either can address something other than the file its text names. Elsewhere both are
 * ordinary filename characters and stay allowed.
 */
export function decodeRequestPath(
  encoded: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (encoded.length === 0) {
    return undefined;
  }
  const decoded: string[] = [];
  for (const segment of encoded.split("/")) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    // An encoded `/` (`%2F`) inside one segment would smuggle a second level past the split above.
    if (
      value === "" ||
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\0")
    ) {
      return undefined;
    }
    if (platform === "win32" && (value.includes("\\") || value.includes(":"))) {
      return undefined;
    }
    decoded.push(value);
  }
  return decoded.join("/");
}

/** The URL path for a repo-relative POSIX path: each segment encoded, the separators kept. */
export function encodeRepoPath(relPath: string): string {
  return relPath.split("/").map(encodeURIComponent).join("/");
}
