import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateEscapesRoot,
  resolvesOutsideRoot,
} from "../src/engine/path-resolve.js";

// Direct unit coverage for the raw, filesystem-facing containment check. Unlike
// `escapesRoot`, this helper must see the raw config/MCP-caller string before any corpus
// normalization, so it has to independently reject an OS-absolute path as well as a `..`-escaping
// relative one.
describe("resolvesOutsideRoot", () => {
  const rootDir = path.join(path.sep, "repo", "root");

  it("rejects a POSIX-style absolute path", () => {
    expect(resolvesOutsideRoot(rootDir, "/etc/hosts")).toBe(true);
  });

  it("rejects a relative path that climbs above the root", () => {
    expect(resolvesOutsideRoot(rootDir, "../outside.md")).toBe(true);
    expect(resolvesOutsideRoot(rootDir, "../../outside.md")).toBe(true);
  });

  it("accepts a legitimate in-root relative path", () => {
    expect(resolvesOutsideRoot(rootDir, "template.md")).toBe(false);
    expect(resolvesOutsideRoot(rootDir, "templates/template.md")).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "rejects a Windows drive-absolute path",
    () => {
      expect(
        resolvesOutsideRoot(
          rootDir,
          "C:\\Windows\\System32\\drivers\\etc\\hosts",
        ),
      ).toBe(true);
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a drive-relative path that lands on a different drive than rootDir",
    () => {
      // "C:secret.md" is drive-relative (no separator after the colon), so `path.isAbsolute` is
      // false; `path.relative` cannot express "a different drive" as a "../"-prefixed path, so it
      // returns the absolute `to` path unchanged instead — the escape check must catch that too.
      expect(
        resolvesOutsideRoot(path.join("D:", "repo", "root"), "C:secret.md"),
      ).toBe(true);
    },
  );
});

// Direct unit coverage for the internally-built-candidate containment check, the same
// escape-the-root class REF-001, REF-003 and coverage all had to close. Unlike
// `resolvesOutsideRoot`, this helper sees only
// corpus-relative POSIX candidates that `resolveRelativeToSource`/`resolveTargetCandidates`
// already produced — but those can still normalize to a drive-absolute-looking remainder when a
// relative link's `..` segments exactly cancel the source directory.
describe("candidateEscapesRoot", () => {
  it("accepts a legitimate in-root relative candidate", () => {
    expect(candidateEscapesRoot("adr/one.md")).toBe(false);
    expect(candidateEscapesRoot("one.md")).toBe(false);
  });

  it("rejects a `..`-prefixed candidate (delegates to escapesRoot)", () => {
    expect(candidateEscapesRoot("..")).toBe(true);
    expect(candidateEscapesRoot("../outside.md")).toBe(true);
  });

  it("rejects a POSIX-absolute-looking candidate on every platform", () => {
    expect(candidateEscapesRoot("/etc/passwd")).toBe(true);
  });

  it.runIf(process.platform === "win32")(
    "rejects a drive-absolute-looking candidate a `..`-cancelling link can produce",
    () => {
      expect(candidateEscapesRoot("c:/Windows/x.md")).toBe(true);
    },
  );
});
