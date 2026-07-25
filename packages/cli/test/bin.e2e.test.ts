import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, statSync, symlinkSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { EXIT_CODE_RUNTIME_ERROR, EXIT_CODE_SUCCESS } from "../src/commands.js";

// The only suite in this package that crosses a real OS process boundary (mirrors
// packages/mcp-server/test/stdio-integration.test.ts). Every other CLI test calls runCli()
// in-process, which can never exercise src/index.ts's entrypoint guard (H-1): that guard only does
// anything when Node itself populates process.argv[1] for a real invocation.
//
// The "installed bin" describe block below manufactures the exact install shape H-1 lived in
// (a POSIX symlink, or a Windows directory junction) itself, in an isolated temp dir, instead of
// depending on npm's own node_modules/.bin linking for the package under test. That ambient link
// depends on install-time ordering this repo's own CI has: `.github/workflows/ci.yml` runs
// `npm ci` *before* `npm run typecheck`/`npm run build` ever produces dist/, and reading npm's own
// bundled `bin-links` package (link-gently.js, shim-bin.js) shows both the POSIX symlink and the
// Windows .cmd/.ps1 shim are skipped entirely when the bin's target file doesn't exist yet at
// install time — confirmed live in this repo: a fresh `tsc -b` always emits dist/index.js at mode
// 644, and even where the ambient symlink already exists, invoking it directly then fails with
// EACCES, not just "not executable yet". Manufacturing the symlink/junction ourselves and invoking
// it via `process.execPath` (not the OS's own shebang dispatch) sidesteps both the missing-link and
// the missing-exec-bit problem, while still reproducing the argv[1]-vs-import.meta.url mismatch
// that is the actual defect.
//
// PRECONDITION: packages/cli's own dist must already be built. True under the documented order
// (`npm run typecheck` == `tsc -b`, which emits before `npm test` runs) — a bare `vitest run` on a
// checkout where src/index.ts changed since the last build spawns stale/missing output, so
// assertBuilt() below fails fast with a clear message.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliDistIndex = path.join(repoRoot, "packages/cli/dist/index.js");
const cliSrcIndex = path.join(repoRoot, "packages/cli/src/index.ts");

function assertBuilt(): void {
  if (!existsSync(cliDistIndex)) {
    throw new Error(
      `Expected ${cliDistIndex} to exist. This suite spawns the compiled bin, not the ` +
        "TypeScript source — run `npm run build` (or `npm run typecheck`, which also emits) first.",
    );
  }
  if (statSync(cliSrcIndex).mtimeMs > statSync(cliDistIndex).mtimeMs) {
    throw new Error(
      `${cliDistIndex} is older than ${cliSrcIndex}. This suite spawns the compiled bin, not ` +
        "the TypeScript source — run `npm run build` (or `npm run typecheck`, which also emits) " +
        "first.",
    );
  }
}
assertBuilt();

interface Spawned {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Every spawn in this file targets either node itself directly via an absolute path, or (for the
// npx smoke check below) the real `npx` binary resolved through PATH — neither needs a shell on
// either platform this file actually spawns on (the npx check skips itself on win32; see there).
function run(command: string, args: string[], cwd: string): Spawned {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  // spawnSync sets `error` (ENOENT for a missing target, EACCES for a non-executable one, etc.)
  // without ever populating `status`; surfacing it directly beats a bare "expected 0, received
  // null" for the repository's first process-spawn suite, where a platform-specific spawn failure
  // is exactly the class of bug this file exists to catch.
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Folds stderr into the assertion object so a status mismatch's failure diff shows *why* (crash
// output, wrong-path error) instead of a bare "expected 0, received 1" with no other context to
// debug a CI-only failure from.
function expectExitCode(result: Spawned, status: number): void {
  expect({ status: result.status, stderr: result.stderr }).toMatchObject({
    status,
  });
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureWithError(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-bin-e2e-"));
  tempDirs.push(root);
  await writeFile(path.join(root, "a.md"), "[broken](missing.md)\n", "utf8");
  await writeFile(
    path.join(root, "wastech-mdlint.config.json"),
    JSON.stringify({ rules: [{ rule: "REF-001" }] }),
    "utf8",
  );
  return root;
}

describe("installed-bin shape via symlink/junction (H-1 regression guard)", () => {
  let linkRoot: string;
  let linkedEntry: string;

  beforeAll(async () => {
    linkRoot = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-bin-link-"),
    );
    if (process.platform === "win32") {
      // Windows requires elevated privileges (or Developer Mode) to symlink a *file*, but
      // directory junctions need neither — and a junction is exactly what npm creates for a
      // workspace/global-linked install on Windows (not only the .cmd shim a plain registry
      // install gets, which passes an already-real relative path and never hit H-1: a linked
      // install's junction does, since Node's realpath resolution dereferences junctions the same
      // way it dereferences POSIX symlinks).
      const junctionDir = path.join(linkRoot, "dist-junction");
      symlinkSync(path.dirname(cliDistIndex), junctionDir, "junction");
      linkedEntry = path.join(junctionDir, path.basename(cliDistIndex));
    } else {
      linkedEntry = path.join(linkRoot, "wastech-mdlint");
      symlinkSync(cliDistIndex, linkedEntry);
    }
  });

  afterAll(async () => {
    await rm(linkRoot, { recursive: true, force: true });
  });

  it("--version through the symlinked/junctioned entrypoint prints the version and exits 0", () => {
    const result = run(process.execPath, [linkedEntry, "--version"], repoRoot);
    expectExitCode(result, EXIT_CODE_SUCCESS);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);

  it("node packages/cli/dist/index.js --version still works directly (no regression)", () => {
    const result = run(process.execPath, [cliDistIndex, "--version"], repoRoot);
    expectExitCode(result, EXIT_CODE_SUCCESS);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);

  it("lint <fixture> through the symlinked/junctioned entrypoint exits non-zero and prints the finding", async () => {
    const fixtureDir = await fixtureWithError();
    const result = run(
      process.execPath,
      [linkedEntry, "lint", fixtureDir, "--fail-on", "error"],
      repoRoot,
    );
    expectExitCode(result, EXIT_CODE_RUNTIME_ERROR);
    expect(result.stdout).toContain("REF-001");
    expect(result.stdout).toContain("missing.md");
    // Pins the exact finding count (1 error, 0 warnings), not just that *a* REF-001 finding
    // exists — this is the "known finding count" the regression guard is meant to check.
    expect(result.stdout).toContain("1 problem (1 error, 0 warnings)");
  }, 30_000);

  it("importing the compiled entrypoint does not execute the CLI as a side effect", async () => {
    const before = process.exitCode;
    await import(pathToFileURL(cliDistIndex).href);
    expect(process.exitCode).toBe(before);
  }, 30_000);
});

describe("npx smoke check (generated CI workflow parity)", () => {
  // npm's own `npx` (via libnpmexec) resolves its "local bin" by walking up from its own `cwd`
  // looking for the nearest ancestor directory with a package.json or a node_modules folder
  // (@npmcli/config's localPrefix detection), then probes <that dir>/node_modules/.bin/<name>
  // (libnpmexec's file-exists.js localFileExists) — confirmed by reading both directly, and by
  // spawning real `npx` against a manufactured fixture of this shape. Pointing `cwd` at such a
  // directory therefore *does* redirect npx's local-bin lookup there — contrary to an earlier
  // draft's claim that the lookup "can't be redirected into a temp dir", which caused that draft
  // to skip this check unconditionally in every environment, including CI. Verified directly:
  // `npx --no-install wastech-mdlint --version` run with `cwd` pointed at such a fixture resolves
  // and runs the symlinked bin with no network access, even though the fixture lives outside the
  // repo entirely.
  //
  // Windows is still skipped here, but for a real reason, not the disproven one above: npm's own
  // bin-linking additionally writes a matching wastech-mdlint.cmd/.ps1 pair next to the
  // extension-less file libnpmexec's local-bin probe looks for, and cmd.exe only resolves the bare
  // command name to .cmd via PATHEXT when it actually *runs* the resolved command. Reproducing
  // that reliably means hand-rolling npm's own cmd-shim templating, which is out of scope for this
  // fix — the guard fix itself is already verified on Windows by the junction-based spawns in the
  // "installed-bin" describe block above, so this block only adds POSIX confidence for the real
  // npx binary specifically.
  it.skipIf(process.platform === "win32")(
    "npx wastech-mdlint lint <fixture> --fail-on error exits non-zero and prints the finding",
    async () => {
      const npxRoot = await mkdtemp(
        path.join(os.tmpdir(), "wastech-mdlint-npx-install-"),
      );
      tempDirs.push(npxRoot);
      await writeFile(
        path.join(npxRoot, "package.json"),
        JSON.stringify({
          name: "wastech-mdlint-npx-fixture",
          version: "0.0.0",
          private: true,
        }),
        "utf8",
      );
      const npxBinDir = path.join(npxRoot, "node_modules", ".bin");
      await mkdir(npxBinDir, { recursive: true });
      // Matches npm's own bin-linking side effect (bin-links' fixBin chmods the *target*, not the
      // symlink): a fresh CI build of dist/index.js is not guaranteed to have the execute bit set
      // yet (see the PRECONDITION note above), and npx invokes the resolved bin through a real
      // shell, which execve()s the symlink's target directly.
      chmodSync(cliDistIndex, 0o755);
      symlinkSync(cliDistIndex, path.join(npxBinDir, "wastech-mdlint"));

      const fixtureDir = await fixtureWithError();
      // cwd is npxRoot (the manufactured local-bin fixture above), not the lint fixture dir, so
      // npx's own local-bin lookup resolves the symlinked bin; the lint fixture path is passed as
      // an argument instead. --no-install is defense-in-depth, not the determinism guarantee —
      // cwd already guarantees local resolution — but it's included since it was verified to work
      // against the pinned npm version (unlike a bare --no, which mis-parses and prints npm's own
      // version instead of forwarding to the CLI). This is what
      // packages/core/src/discovery/config-writer.ts's generated CI workflow actually runs
      // (`npx wastech-mdlint lint --fail-on error`).
      const result = run(
        "npx",
        [
          "--no-install",
          "wastech-mdlint",
          "lint",
          fixtureDir,
          "--fail-on",
          "error",
        ],
        npxRoot,
      );
      expectExitCode(result, EXIT_CODE_RUNTIME_ERROR);
      expect(result.stdout).toContain("REF-001");
      expect(result.stdout).toContain("1 problem (1 error, 0 warnings)");
    },
    30_000,
  );
});
