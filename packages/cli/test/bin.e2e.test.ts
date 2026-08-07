import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import {
  EXIT_CODE_FINDINGS,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
} from "../src/commands.js";

// @boundary-guard installed-bin-spawn
//
// The only suite in this package that crosses a real OS process boundary (mirrors
// packages/mcp-server/test/stdio-integration.test.ts). Every other CLI test calls runCli()
// in-process, which can never exercise src/index.ts's entrypoint guard: that guard only does
// anything when Node itself populates process.argv[1] for a real invocation.
//
// The "installed bin" describe block below manufactures the exact install shape the entrypoint bug lived in
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
// assertBuilt() below fails fast with a clear message. That message, and the mtime heuristic behind
// it, are shared with the mcp-server twin: see packages/core/test/support/assert-built.ts.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliDistIndex = path.join(repoRoot, "packages/cli/dist/index.js");
const cliSrcIndex = path.join(repoRoot, "packages/cli/src/index.ts");

assertBuilt(cliDistIndex, cliSrcIndex);

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

describe("installed-bin shape via symlink/junction", () => {
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
      // install gets, which passes an already-real relative path and never hit the bug: a linked
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
    expectExitCode(result, EXIT_CODE_FINDINGS);
    expect(result.stdout).toContain("REF-001");
    expect(result.stdout).toContain("missing.md");
    // Pins the exact finding count (1 error, 0 warnings), not just that *a* REF-001 finding
    // exists — this is the "known finding count" the regression guard is meant to check.
    expect(result.stdout).toContain("1 problem (1 error, 0 warnings)");
  }, 30_000);

  // A typo'd subcommand, crossed over a real process boundary because that is the shape the defect
  // actually shipped in: a typo'd `run:` step in CI, whose only signal is the process exit status.
  it("a typo'd subcommand exits 2 through the real process boundary, not 0", async () => {
    const fixtureDir = await fixtureWithError();
    const result = run(
      process.execPath,
      [linkedEntry, "linnt", fixtureDir],
      repoRoot,
    );
    expectExitCode(result, EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("unknown command 'linnt'");
    expect(result.stdout).not.toContain("No problems found.");
  }, 30_000);

  it("importing the compiled entrypoint does not execute the CLI as a side effect", async () => {
    const before = process.exitCode;
    await import(pathToFileURL(cliDistIndex).href);
    expect(process.exitCode).toBe(before);
  }, 30_000);

  // @boundary-guard installed-bin-spawn
  //
  // `init`'s merge refusal is an exit-code defect and nothing else: the message was
  // always right, so an in-process test that reads stdout sees a correct-looking run either way.
  // Only a real process has an exit code, which is the whole reason this guard lives here — and the
  // shape that mattered is a CI `run:` step, which is a spawn too.
  describe("init's merge refusal vs. skip over the same unloadable config", () => {
    async function fixtureWithUnloadableConfig(): Promise<string> {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "wastech-mdlint-bin-init-"),
      );
      tempDirs.push(root);
      await writeFile(path.join(root, "a.md"), "# A\n", "utf8");
      await writeFile(
        path.join(root, "wastech-mdlint.config.json"),
        "{ not json",
        "utf8",
      );
      return root;
    }

    it("--on-existing merge over an unloadable config exits 2 and leaves the file untouched", async () => {
      const fixtureDir = await fixtureWithUnloadableConfig();
      const result = run(
        process.execPath,
        [linkedEntry, "init", "--yes", "--on-existing", "merge"],
        fixtureDir,
      );

      expectExitCode(result, EXIT_CODE_USAGE_ERROR);
      // Written out as a literal rather than imported from `src`: importing the formatter would
      // assert only that the code agrees with itself, and "the message is unchanged byte for byte"
      // is precisely what this task must not break while changing the code beside it.
      expect(result.stdout).toContain(
        "Not written: the existing config at wastech-mdlint.config.json could not be read, " +
          "parsed, or validated, so a merge cannot guarantee a valid config with its existing " +
          "entries preserved. Fix or remove it, then re-run init.",
      );
      await expect(
        readFile(path.join(fixtureDir, "wastech-mdlint.config.json"), "utf8"),
      ).resolves.toBe("{ not json");
      // The refusal writes *nothing*, so the project-local schema must not appear either.
      expect(existsSync(path.join(fixtureDir, "schema.json"))).toBe(false);
    }, 30_000);

    it("--on-existing skip over the same config exits 0", async () => {
      const fixtureDir = await fixtureWithUnloadableConfig();
      const result = run(
        process.execPath,
        [linkedEntry, "init", "--yes", "--on-existing", "skip"],
        fixtureDir,
      );

      // Same unloadable input, opposite exit codes: the split between a deliberate no-write and an
      // operational failure is the behavior under guard, not the no-write itself.
      expectExitCode(result, EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain(
        "skipped — existing config left untouched.",
      );
    }, 30_000);
  });
});

// Lockfile detection, and an exit-code contract at the process boundary. `runCli`'s own
// try/catch does not start until after `readPackageVersion()` has already run, so a rejection from
// there escapes the bin's top-level `await`. Node terminates an unhandled rejection with exit 1 —
// the code reserved for lint findings — so CI could not tell "found problems" from "could not
// start". Only a real spawn can observe that: in-process tests call `runCli` directly and never
// execute src/index.ts's top level at all.
describe("top-level rejection handling in the bin", () => {
  it("reports an operational error and exits 2 when runCli rejects before its own try", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-bin-reject-"),
    );
    tempDirs.push(root);

    const packageDir = path.join(root, "cli");
    await cp(path.dirname(cliDistIndex), path.join(packageDir, "dist"), {
      recursive: true,
    });

    // `readPackageVersion` reads `<dist>/../package.json`. A *directory* at that path fails the read
    // with EISDIR on every platform — unlike chmod, which root ignores and Windows does not model.
    // Node's own package.json lookup skips a non-file entry and keeps walking up, which is why the
    // ESM marker below still applies to dist/index.js (verified: with `"type": "commonjs"` there,
    // the compiled ESM entrypoint fails to parse).
    await mkdir(path.join(packageDir, "package.json"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module" }),
      "utf8",
    );

    // The copied dist still imports `@wastech-mdlint/core`; Node resolves it by walking up from the
    // entrypoint, so one link to the repo's installed tree is enough. A junction on Windows, where
    // symlinking needs elevation (same reasoning as the installed-bin block above).
    symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = run(
      process.execPath,
      [path.join(packageDir, "dist", "index.js"), "--version"],
      root,
    );

    // Not 1: that is EXIT_CODE_FINDINGS, which is what a bare unhandled rejection would have
    // produced and what this handler exists to prevent.
    expectExitCode(result, EXIT_CODE_USAGE_ERROR);
    expect(result.status).not.toBe(EXIT_CODE_FINDINGS);
    expect(result.stderr).toContain("Operational error:");
    expect(result.stderr).toContain("EISDIR");
    // Node's own unhandled-rejection banner must be absent — the failure was handled, not escaped.
    expect(result.stderr).not.toContain("UnhandledPromiseRejection");
    expect(result.stderr).not.toContain("ERR_UNHANDLED_REJECTION");
    // Exactly one diagnostic line, not a stack trace dump.
    expect(
      result.stderr.split("\n").filter((line) => line.trim().length > 0),
    ).toHaveLength(1);
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
      expectExitCode(result, EXIT_CODE_FINDINGS);
      expect(result.stdout).toContain("REF-001");
      expect(result.stdout).toContain("1 problem (1 error, 0 warnings)");
    },
    30_000,
  );
});
