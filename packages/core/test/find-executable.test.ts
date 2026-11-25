import { describe, expect, it } from "vitest";

import { isRootedPathEntry } from "../src/find-executable.js";

// A `PATH` entry that is not pinned to one directory resolves against wherever the host runs -
// usually the repository it reads - so a program found through it could be a file that repository
// supplies. Only an entry that names the same folder from any working directory may be searched.
describe("isRootedPathEntry", () => {
  it("accepts drive-letter and UNC entries on Windows", () => {
    expect(
      isRootedPathEntry(String.raw`C:\Program Files\Git\cmd`, "win32"),
    ).toBe(true);
    expect(isRootedPathEntry("c:/tools", "win32")).toBe(true);
    expect(isRootedPathEntry(String.raw`\\server\share\bin`, "win32")).toBe(
      true,
    );
  });

  // `\tools` is rooted at the current drive, so a host started at a repository that is itself a
  // drive's root would search that repository's own `tools` folder.
  it("refuses relative, current-drive and drive-relative entries on Windows", () => {
    for (const entry of [".", "bin", String.raw`\tools`, "C:tools", ""]) {
      expect(isRootedPathEntry(entry, "win32"), entry).toBe(false);
    }
  });

  it("accepts only absolute entries elsewhere", () => {
    expect(isRootedPathEntry("/usr/bin", "linux")).toBe(true);
    for (const entry of [".", "bin", "./bin", ""]) {
      expect(isRootedPathEntry(entry, "darwin"), entry).toBe(false);
    }
  });
});
