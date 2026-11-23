import { describe, expect, it } from "vitest";

import { decodeRequestPath, encodeRepoPath } from "../src/request-path.js";

describe("decodeRequestPath", () => {
  it("decodes each segment into a repo-relative POSIX path", () => {
    expect(decodeRequestPath("docs/guide.md")).toBe("docs/guide.md");
    expect(decodeRequestPath("docs/my%20notes.md")).toBe("docs/my notes.md");
    expect(
      decodeRequestPath("docs/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.md"),
    ).toBe("docs/заметки.md");
  });

  // Every form below either climbs out of the repository or smuggles a separator past the split, so
  // each must be refused outright rather than normalized into some other in-repository path.
  it.each([
    ["empty", ""],
    ["parent segment", "../package.json"],
    ["parent segment in the middle", "docs/../../secret.txt"],
    ["encoded parent segment", "%2e%2e/secret.txt"],
    ["mixed-case encoded parent segment", "%2E%2e/secret.txt"],
    ["current-directory segment", "./README.md"],
    ["encoded slash", "..%2fsecret.txt"],
    ["encoded slash inside a name", "docs%2Fguide.md"],
    ["NUL byte", "README.md%00.png"],
    ["malformed escape", "docs/%E0%A4%A"],
    ["empty segment", "docs//guide.md"],
    ["trailing slash", "docs/"],
    ["leading slash", "/etc/passwd"],
  ])("rejects %s", (_label, encoded) => {
    expect(decodeRequestPath(encoded, "linux")).toBeUndefined();
    expect(decodeRequestPath(encoded, "win32")).toBeUndefined();
  });

  // On Windows a backslash is a separator and a colon starts a drive or an alternate data stream, so
  // these name something other than their text; elsewhere they are ordinary filename characters.
  it.each([
    ["backslash", "docs%5C..%5Csecret.txt"],
    ["drive letter", "C%3A/Windows/win.ini"],
    ["alternate data stream", "README.md%3A%3A%24DATA"],
  ])("rejects a %s on Windows only", (_label, encoded) => {
    expect(decodeRequestPath(encoded, "win32")).toBeUndefined();
    expect(decodeRequestPath(encoded, "linux")).toBeDefined();
  });
});

describe("encodeRepoPath", () => {
  it("round-trips through decodeRequestPath", () => {
    for (const relPath of [
      "README.md",
      "docs/my notes.md",
      "docs/#1 plan?.md",
      "docs/заметки.md",
    ]) {
      expect(decodeRequestPath(encodeRepoPath(relPath), "linux")).toBe(relPath);
    }
  });
});
