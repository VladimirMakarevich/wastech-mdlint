import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readTarball } from "./support/read-tarball.js";

// P16.02 / W-29. What a stranger downloads was never asserted on: every tarball carried only
// `package.json` + `dist/` (plus `cli`'s `schema.json`), so publishing would have produced three
// blank npm pages under an MIT claim with no license text and no link back to the source. The
// defect is only visible *after* publishing, which is the one moment it cannot be undone.
//
// So this suite reads the packed tarballs themselves rather than the manifests: a manifest is the
// promise, and the promise is exactly what was already being believed. It packs once in `beforeAll`
// into a temp directory so nothing lands in the checkout.
//
// One thing to know before trusting a green run here as proof that `files` is right: npm
// **force-includes** a package-root `README*` and `LICENSE*` regardless of the `files` allowlist.
// Its bundled `npm-packlist` injects `!/readme{,.*[^~$]}` / `!/license{,.*[^~$]}` into the
// highest-precedence rule set (`npm-packlist/lib/index.js:283-286`), matched case-insensitively.
// The teeth of the README/LICENSE assertions below are therefore *the files existing*, not the
// allowlist entries naming them. `cli`'s `schema.json` is the one payload file that ships only
// because `files` lists it, which is what gives this suite genuine allowlist sensitivity.
//
// No packed-file counts anywhere: `docs/mdlint_v2/P16-release-readiness/03-published-payload.md`
// rules a count out as a baseline, because it fails on every legitimate addition while saying
// nothing about what is in the payload. Properties only.
//
// Living in `core`'s suite while reading the whole repository follows `docs-sync.test.ts` and
// `boundary-guards.test.ts`, both of which resolve `repoRoot` the same way and read files outside
// this package.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// Spawning npm as `node <npm-cli.js>` is the one formulation that is both explicit-argv and
// shell-free on Windows: since Node 18.20.2/20.12.2 `spawnSync("npm.cmd", …)` without `shell: true`
// throws EINVAL, and `shell: true` is what `.agents/rules/security.md` (Command Execution) tells us
// not to reach for. `npm_execpath` is set by any `npm run …`, which covers the documented gate
// (`npm test`) and CI (`.github/workflows/ci.yml`).
const npmExecPath = process.env["npm_execpath"];
if (npmExecPath === undefined || npmExecPath === "") {
  // Fail fast at module scope with the remedy, the same shape `assertBuilt()` uses — never a silent
  // skip. A guard that quietly skips where nobody looks is the post-P9 audit's systemic cause again.
  throw new Error(
    "This suite packs the workspace with npm, which it locates through the `npm_execpath` " +
      "environment variable — set by any `npm run …`, and absent under a bare `vitest run`. " +
      "Run `npm test` (the documented gate) instead.",
  );
}

interface PublishedPackage {
  /** Manifest `name`, and the string each README must name so three copies of one file are visible. */
  readonly name: string;
  /** Repository-relative POSIX subpath, which is what `repository.directory` must carry. */
  readonly directory: string;
}

const PUBLISHED_PACKAGES: readonly PublishedPackage[] = [
  { name: "@wastech-mdlint/core", directory: "packages/core" },
  { name: "@wastech-mdlint/cli", directory: "packages/cli" },
  { name: "@wastech-mdlint/mcp-server", directory: "packages/mcp-server" },
];

/**
 * npm's own tarball filename rule: drop the leading `@`, flatten the scope separator, then the
 * version. Derived rather than hard-coded because P16.02 must not couple this suite to `0.0.0` —
 * the release tool bumps every version in lockstep and this guard has to survive that.
 */
function tarballPrefix(packageName: string): string {
  return `${packageName.replace(/^@/, "").replace(/\//g, "-")}-`;
}

const rootManifest = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { repository: { url: string } };

/** `.gitattributes` pins LF, but a byte compare that fails only on Windows CI for line endings is a trap this repo has already hit. */
const rootLicense = readFileSync(
  path.join(repoRoot, "LICENSE"),
  "utf8",
).replace(/\r\n/g, "\n");

let packDir: string;
const payloads = new Map<string, Map<string, Buffer>>();

beforeAll(async () => {
  packDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-pack-"));

  // `--workspaces` packs the three publishable packages; the root is `private: true` and is not
  // packed. That pack path runs no lifecycle script, so nothing here rebuilds — fine, because no
  // assertion below reads `dist`.
  const packed = spawnSync(
    process.execPath,
    [npmExecPath, "pack", "--workspaces", "--pack-destination", packDir],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true },
  );
  if (packed.status !== 0) {
    throw new Error(
      `npm pack --workspaces exited ${String(packed.status)}:\n${packed.stderr}`,
    );
  }

  const files = await readdir(packDir);
  for (const { name } of PUBLISHED_PACKAGES) {
    const prefix = tarballPrefix(name);
    const tarball = files.find(
      (file) => file.startsWith(prefix) && file.endsWith(".tgz"),
    );
    if (tarball === undefined) {
      throw new Error(
        `npm pack produced no ${prefix}*.tgz for ${name}; got: ${files.join(", ")}`,
      );
    }
    payloads.set(name, readTarball(path.join(packDir, tarball)));
  }
  // npm startup plus three packs is slow enough to trip the default timeout on Windows CI.
}, 120_000);

afterAll(async () => {
  await rm(packDir, { recursive: true, force: true });
});

describe.each(PUBLISHED_PACKAGES)(
  "published payload of $name (W-29)",
  ({ name, directory }) => {
    function payload(): Map<string, Buffer> {
      return payloads.get(name)!;
    }

    function text(entry: string): string {
      const contents = payload().get(entry);
      expect(contents, `${name} ships no ${entry}`).toBeDefined();
      return contents!.toString("utf8").replace(/\r\n/g, "\n");
    }

    it("is a tarball this suite could actually read", () => {
      // Positive control. A reader that silently returned an empty map would make every assertion
      // below vacuously true, which is the failure mode a payload guard can least afford.
      expect(payload().size).toBeGreaterThan(0);
      expect(payload().has("package.json")).toBe(true);
    });

    it("ships a README written for this package", () => {
      const readme = text("README.md");
      expect(readme.trim()).not.toBe("");
      // Cheap guard against three copies of one file, or of the root README.
      expect(readme).toContain(name);
    });

    it("ships readable MIT license text", () => {
      const license = text("LICENSE");
      // Two phrases rather than a length check: an empty or placeholder file would otherwise pass
      // for "a LICENSE entry exists", which is the claim the manifest already makes.
      expect(license).toContain("MIT License");
      expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
      // Four copies of one file drift; comparing against the root keeps them one text.
      expect(license).toBe(rootLicense);
    });

    it("declares MIT and a repository pointing at its own subdirectory", () => {
      // Read out of the *payload's* manifest, not the working tree's, so this stays an assertion
      // about what ships. `directory` is what makes npm link to the package's subtree rather than
      // to the repository root.
      const manifest = JSON.parse(text("package.json")) as {
        license: string;
        repository: unknown;
      };
      expect(manifest.license).toBe("MIT");
      expect(manifest.repository).toEqual({
        type: "git",
        url: rootManifest.repository.url,
        directory,
      });
    });
  },
);

describe("published payload of @wastech-mdlint/cli (W-29)", () => {
  it("still ships schema.json", () => {
    // The one payload file that ships *only* because `files` lists it — README and LICENSE are
    // force-included by npm regardless. So this is where the suite has real allowlist sensitivity,
    // and it is also PR.01 deliverable 3 (editor `$schema` resolution from the installed package).
    const schema = payloads.get("@wastech-mdlint/cli")!.get("schema.json");
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!.toString("utf8"))).toMatchObject({
      type: "object",
    });
  });
});
