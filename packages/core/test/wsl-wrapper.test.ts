import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// P16.04 / W-54. `scripts/run-npm-windows.sh` used to flatten the argument vector into one string
// and interpolate it — together with the repository path, unquoted — into a `cmd.exe` command line.
// A checkout under `C:\my repo` therefore ran `cd /d C:\my repo && npm ...`, and one containing `&`
// injected. `.agents/rules/security.md` (Command Execution) forbids exactly that, so the wrapper now
// changes directory on the bash side and hands cmd.exe an explicit argv.
//
// What this suite can and cannot show: it stubs `wslpath` and `cmd.exe` on PATH, so it pins the
// argument vector cmd.exe receives, the working directory it is handed, and the UNC refusal — the
// parts that are ours. It cannot exercise real WSL interop (cwd translation, PATHEXT resolution of
// `npm`); those were reasoned about, not run, and both fail loudly rather than silently if the
// reasoning is wrong. The checkout deliberately sits in a directory whose name contains a space,
// which is the reproduction the task names as the likeliest real-world trigger.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// Copied by explicit name rather than by globbing `scripts/`: a new `.sh` file should have to be
// added here consciously, and nothing else in `scripts/` belongs in a fake checkout.
const WSL_SCRIPTS = [
  "run-npm-windows.sh",
  "build-wsl.sh",
  "install-wsl.sh",
  "test-wsl.sh",
  "typecheck-wsl.sh",
  "verify-wsl.sh",
];

/** The four thin callers and the npm arguments each is contracted to pass through. */
const CALLERS = [
  { script: "build-wsl.sh", npmArgs: ["run", "build"] },
  { script: "install-wsl.sh", npmArgs: ["install"] },
  { script: "test-wsl.sh", npmArgs: ["test"] },
  { script: "typecheck-wsl.sh", npmArgs: ["run", "typecheck"] },
];

interface StubCall {
  /** Working directory the wrapper handed the Windows child. */
  cwd: string;
  argv: string[];
}

interface WrapperRun {
  status: number | null;
  stderr: string;
  /** `null` when the stub was never reached, which is how a refusal is distinguished from a no-op. */
  calls: StubCall[] | null;
}

// These are WSL-side bash scripts: they are run by the Linux half of a WSL install (which reports as
// `linux`), never by native Windows. Skipping matches the documented-reason form used in
// `packages/cli/test/bin.e2e.test.ts`.
describe.skipIf(process.platform === "win32")(
  "run-npm-windows.sh (W-54)",
  () => {
    let sandbox: string;
    let checkout: string;
    let stubDir: string;
    let runCounter = 0;

    function writeStub(name: string, body: string): void {
      const stubPath = path.join(stubDir, name);
      writeFileSync(
        stubPath,
        `#!/usr/bin/env bash\nset -euo pipefail\n${body}`,
      );
      chmodSync(stubPath, 0o755);
    }

    beforeAll(async () => {
      sandbox = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-wsl-"));
      // The space is the point of the fixture, not decoration.
      checkout = path.join(sandbox, "checkout with space");
      mkdirSync(path.join(checkout, "scripts"), { recursive: true });
      for (const name of WSL_SCRIPTS) {
        const target = path.join(checkout, "scripts", name);
        copyFileSync(path.join(repoRoot, "scripts", name), target);
        // The tracked copies are not mode 755; the callers invoke each other by path, so they must
        // be executable here.
        chmodSync(target, 0o755);
      }

      stubDir = path.join(sandbox, "stub-bin");
      mkdirSync(stubDir);

      // The wrapper uses `wslpath -w` only to detect a UNC (WSL-filesystem) checkout, so the stub
      // ignores the flag and its operand and answers whatever the test asked for.
      writeStub("wslpath", "printf '%s\\n' \"$WSL_STUB_WIN_PATH\"\n");

      // One block per invocation: the working directory, then one line per argument, then a blank
      // separator. Appending rather than truncating is what makes `verify-wsl.sh`'s four calls
      // readable in order. `pwd -P` rather than `$PWD` so a symlinked temp root (macOS `/var` →
      // `/private/var`) does not read as a different directory.
      writeStub(
        "cmd.exe",
        [
          "{",
          "  printf 'cwd=%s\\n' \"$(pwd -P)\"",
          "  printf '%s\\n' \"$@\"",
          "  printf '\\n'",
          '} >> "$WSL_STUB_LOG"',
          'exit "${WSL_STUB_EXIT:-0}"',
        ].join("\n") + "\n",
      );
    });

    afterAll(async () => {
      await rm(sandbox, { recursive: true, force: true });
    });

    function run(
      script: string,
      extraEnv: Record<string, string> = {},
    ): WrapperRun {
      const logPath = path.join(sandbox, `cmd-log-${String(++runCounter)}.txt`);
      // Explicit argv and no `shell`, per `.agents/rules/security.md` — a suite about shell
      // interpolation has no business introducing any. `cwd` is the sandbox rather than the
      // checkout, so a wrapper that failed to change directory itself would be visible.
      const result = spawnSync(
        "bash",
        [path.join(checkout, "scripts", script)],
        {
          cwd: sandbox,
          env: {
            ...process.env,
            PATH: `${stubDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
            WSL_STUB_LOG: logPath,
            WSL_STUB_WIN_PATH: "C:\\dev\\checkout with space",
            ...extraEnv,
          },
          encoding: "utf8",
          windowsHide: true,
        },
      );

      return {
        status: result.status,
        stderr: result.stderr,
        calls: existsSync(logPath)
          ? readFileSync(logPath, "utf8")
              .split("\n\n")
              .filter((block) => block !== "")
              .map((block) => {
                const [cwdLine, ...argv] = block.split("\n");
                return { cwd: cwdLine!.slice("cwd=".length), argv };
              })
          : null,
      };
    }

    it.each(CALLERS)(
      "$script hands cmd.exe an explicit argv from a checkout path containing a space",
      ({ script, npmArgs }) => {
        const { status, stderr, calls } = run(script);

        expect(status, stderr).toBe(0);
        expect(calls).toHaveLength(1);
        // The whole vector, not a substring: this is what "explicit argument vector" means, and it
        // is what the old `cd /d <path> && npm <flattened args>` string could not be.
        expect(calls![0]!.argv).toEqual(["/d", "/s", "/c", "npm", ...npmArgs]);
        // realpath on both sides: `pwd` in the wrapper keeps the logical path, the stub reports the
        // physical one, and macOS's temp root is a symlink.
        expect(realpathSync(calls![0]!.cwd)).toBe(realpathSync(checkout));
      },
    );

    it("builds no shell command line and suppresses no engine check", () => {
      const { calls } = run("build-wsl.sh");
      const argv = calls![0]!.argv;

      // The class assertion. `&&` in any argument would mean a command line was assembled again;
      // `engine-strict` would mean the flag the root .npmrc replaced had come back.
      expect(argv.filter((arg) => arg.includes("&&"))).toEqual([]);
      expect(argv.filter((arg) => arg.includes("engine-strict"))).toEqual([]);
    });

    it("verify-wsl.sh still runs its four steps in order", () => {
      const { status, stderr, calls } = run("verify-wsl.sh");

      expect(status, stderr).toBe(0);
      expect(calls?.map((call) => call.argv.slice(3))).toEqual([
        ["npm", "install"],
        ["npm", "run", "typecheck"],
        ["npm", "test"],
        ["npm", "run", "build"],
      ]);
    });

    it("propagates the Windows exit code to its caller", () => {
      // The wrapper `exec`s, so this is really a check that nothing swallows the status on the way
      // back through the caller script — the property that makes these usable in CI-style chains.
      const { status } = run("build-wsl.sh", { WSL_STUB_EXIT: "7" });
      expect(status).toBe(7);
    });

    it("refuses a WSL-filesystem checkout by name rather than running in C:\\Windows", () => {
      const uncPath = "\\\\wsl.localhost\\Ubuntu\\home\\u\\checkout with space";
      const { status, stderr, calls } = run("build-wsl.sh", {
        WSL_STUB_WIN_PATH: uncPath,
      });

      expect(status).not.toBe(0);
      expect(stderr).toContain(uncPath);
      // Nothing was spawned: cmd.exe silently ignores a UNC working directory and falls back to
      // C:\Windows, where npm reports a missing script — a failure that reads as a broken repository.
      expect(calls).toBeNull();
    });

    it("leaves the engines floor to the root .npmrc (P16.03 / W-32)", () => {
      // The two halves of one decision: this task drops `--engine-strict=false` from the wrapper
      // *because* P16.03 made the floor binding here. Asserting both sides in one place is what
      // stops a later edit re-opening the contradiction from either end. Compared as a boolean so
      // a failure never prints the file.
      const npmrcPath = path.join(repoRoot, ".npmrc");
      expect(
        existsSync(npmrcPath),
        "The root .npmrc is what makes `engines.node` binding for our own installs (P16.03 / " +
          "W-32), and scripts/run-npm-windows.sh dropped `--engine-strict=false` on that basis. " +
          "Removing it puts the Windows-from-WSL toolchain back outside the declared floor.",
      ).toBe(true);
      const enforced = readFileSync(npmrcPath, "utf8")
        .split(/\r?\n/)
        .some((line) => line.trim() === "engine-strict=true");
      expect(enforced, "Root .npmrc no longer sets engine-strict=true.").toBe(
        true,
      );
    });
  },
);
