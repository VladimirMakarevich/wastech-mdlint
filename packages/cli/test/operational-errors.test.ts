import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatOperationalError,
  formatWriteFailure,
  toRepoRelativePosix,
  toWriteTargetPath,
} from "../src/operational-errors.js";

// A Node errno exception, built by hand: the real ones only come from a syscall, and the properties
// these formatters read (`code`, `path`) are the whole contract under test.
function errnoError(params: {
  code: string;
  message: string;
  path?: string;
}): Error {
  const error = new Error(params.message);
  Object.assign(error, { code: params.code, path: params.path });
  return error;
}

const CWD = path.resolve(path.sep, "repo");

describe("toRepoRelativePosix", () => {
  // `path.join`/`path.relative` are the host-native variants, so on Windows this input really does
  // carry `\` separators and the POSIX expectation is what pins the normalization there.
  it("renders a path under cwd as a repo-relative POSIX path", () => {
    expect(toRepoRelativePosix(CWD, path.join(CWD, "docs", "a.md"))).toBe(
      "docs/a.md",
    );
  });

  it("renders cwd itself as '.' rather than an empty string", () => {
    expect(toRepoRelativePosix(CWD, CWD)).toBe(".");
  });
});

describe("toWriteTargetPath", () => {
  it("renders a target under cwd exactly as toRepoRelativePosix does", () => {
    const target = path.join(CWD, "docs", "SKILL.md");
    expect(toWriteTargetPath(CWD, target)).toBe("docs/SKILL.md");
    expect(toWriteTargetPath(CWD, target)).toBe(
      toRepoRelativePosix(CWD, target),
    );
  });

  it("falls back to the absolute path once the relative form needs a leading '..'", () => {
    // The W-17 case: a single hop already reads worse than the absolute path, and the observed
    // report had five of them. Platform-native separators on purpose — this is a path to open.
    const target = path.resolve(CWD, "..", "skill-out", "SKILL.md");
    expect(toWriteTargetPath(CWD, target)).toBe(target);
    expect(toWriteTargetPath(CWD, target)).not.toContain("..");
  });

  it("does not mistake a sibling whose name starts with '..' for a parent hop", () => {
    // The reason the check is on the first path *segment* and not a `startsWith("..")` on the
    // string: `..foo` is a legal directory name directly under cwd.
    const target = path.join(CWD, "..foo", "SKILL.md");
    expect(toWriteTargetPath(CWD, target)).toBe("..foo/SKILL.md");
  });

  // `path.relative` only ever returns an absolute path when the two paths share no root, which on
  // POSIX cannot happen — so this branch is genuinely unreachable off Windows and is left to CI's
  // windows runner rather than faked.
  it.runIf(process.platform === "win32")(
    "falls back to the absolute path across Windows drives, where no relative form exists",
    () => {
      expect(toWriteTargetPath("C:\\repo", "D:\\out\\SKILL.md")).toBe(
        "D:\\out\\SKILL.md",
      );
    },
  );
});

describe("formatOperationalError", () => {
  it("renders an errno with a path as the code plus a repo-relative path", () => {
    const absolute = path.join(CWD, "docs", "wastech-mdlint.config.json");
    const error = errnoError({
      code: "EACCES",
      // The absolute path (and, for a rename, the atomic temp name) that must never be printed.
      message: `EACCES: permission denied, open '${absolute}'`,
      path: absolute,
    });

    const rendered = formatOperationalError(error, CWD);
    expect(rendered).toBe("EACCES on docs/wastech-mdlint.config.json");
    expect(rendered).not.toContain(CWD);
  });

  it("keeps the message of an errno that names no path", () => {
    // Node only omits `path` when the syscall had none to report, so this message has nothing to
    // leak — and it is strictly more useful than the bare code the backstop would otherwise print.
    const error = errnoError({
      code: "ENOSPC",
      message: "ENOSPC: no space left on device, write",
    });
    expect(formatOperationalError(error, CWD)).toBe(
      "ENOSPC: no space left on device, write",
    );
  });

  it("keeps the message of a Node programmer error whose code is not an errno", () => {
    // The regression guard for the backstop's whole purpose: `ERR_*` codes carry the diagnosis in the
    // message, so substituting the code would print `Operational error: ERR_INVALID_ARG_TYPE`.
    const error = errnoError({
      code: "ERR_INVALID_ARG_TYPE",
      message:
        'The "path" argument must be of type string. Received type undefined',
    });
    expect(formatOperationalError(error, CWD)).toContain(
      'The "path" argument must be of type string',
    );
  });

  it("keeps a plain Error's own message, which carries no host paths", () => {
    expect(formatOperationalError(new Error("graph is empty"), CWD)).toBe(
      "graph is empty",
    );
  });

  it("stringifies a non-Error throw so the backstop can never render 'undefined'", () => {
    expect(formatOperationalError("boom", CWD)).toBe("boom");
  });
});

describe("formatWriteFailure", () => {
  it("names the caller's path and the errno, not the fs message", () => {
    const error = errnoError({
      code: "EISDIR",
      message: "EISDIR: illegal operation on a directory, rename '/tmp/x.tmp'",
    });

    expect(formatWriteFailure("docs/SKILL.md", error)).toBe(
      "Could not write docs/SKILL.md (EISDIR).",
    );
  });

  it("omits the reason when the failure carries no errno", () => {
    expect(formatWriteFailure("schema.json", new Error("nope"))).toBe(
      "Could not write schema.json.",
    );
  });
});
