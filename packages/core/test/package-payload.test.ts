import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RULE_DOCS_BASE_URL } from "../src/engine/rule-docs-url.js";
import { assertBuilt } from "./support/assert-built.js";
import { readTarball } from "./support/read-tarball.js";

// What a stranger downloads was never asserted on: every tarball carried only
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
// No packed-file counts anywhere: a count fails on every legitimate addition while saying nothing
// about what is actually in the payload. Properties only.
//
// Extend it to the payload's *shape*: no source maps, and no top-level entry
// outside each package's allowlist. That second half is what makes "no `docs/`" and "no `.github/`"
// assertions unnecessary — an allowed-set check states the same property positively and catches the
// leak this suite has not thought of, which is the one that would actually ship.
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
// throws EINVAL, and `shell: true` is exactly what a spawn here must not reach for.
// `npm_execpath` is set by any `npm run …`, which covers the documented gate
// (`npm test`) and CI (`.github/workflows/ci.yml`).
const npmExecPath = process.env["npm_execpath"];
if (npmExecPath === undefined || npmExecPath === "") {
  // Fail fast at module scope with the remedy, the same shape `assertBuilt()` uses — never a silent
  // skip. A guard that quietly skips where nobody looks is how untested boundaries stay untested.
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
  /**
   * Every top-level segment the payload is allowed to contain — `files` plus the two filenames npm
   * force-includes. Listing it per package rather than sharing one set keeps `cli`'s `schema.json`
   * a property of `cli` alone, so a copy of it leaking into `core` fails here.
   */
  readonly allowedTopLevelEntries: readonly string[];
}

// Adding a genuinely new payload file (a `CHANGELOG.md`, say) means one line here. That is
// the guard working, not friction: the edit is the moment somebody confirms the new file is meant
// to ship — the review that publishing an unexamined tarball would skip.
const ALWAYS_ALLOWED = ["package.json", "README.md", "LICENSE", "dist"];

const PUBLISHED_PACKAGES: readonly PublishedPackage[] = [
  {
    name: "@wastech-mdlint/core",
    directory: "packages/core",
    allowedTopLevelEntries: ALWAYS_ALLOWED,
  },
  {
    name: "@wastech-mdlint/cli",
    directory: "packages/cli",
    allowedTopLevelEntries: [...ALWAYS_ALLOWED, "schema.json"],
  },
  {
    name: "@wastech-mdlint/mcp-server",
    directory: "packages/mcp-server",
    allowedTopLevelEntries: ALWAYS_ALLOWED,
  },
];

// The suite packs with `--workspaces`, which takes npm's no-lifecycle-script path — so nothing here
// rebuilds, and the assertions below read `dist` directly. Without this, a never-built
// tree would fail the positive control below (`dist/index.js` present) as a packaging defect instead
// of "you did not build". It does not catch stale `.map` output either way — `assertBuilt()` only
// compares `dist/index.js` against `src/index.ts`, and `tsc` never deletes a `.map` on its own — so
// the map assertion's own failure message is what names that remedy.
for (const { directory } of PUBLISHED_PACKAGES) {
  assertBuilt(
    path.join(repoRoot, directory, "dist", "index.js"),
    path.join(repoRoot, directory, "src", "index.ts"),
  );
}

/**
 * npm's own tarball filename rule: drop the leading `@`, flatten the scope separator, then the
 * version. Derived rather than hard-coded so the suite is not coupled to the current `0.0.0` —
 * the release tool bumps every version in lockstep and this guard has to survive that.
 */
function tarballPrefix(packageName: string): string {
  return `${packageName.replace(/^@/, "").replace(/\//g, "-")}-`;
}

const rootManifest = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { repository: { url: string }; scripts: Record<string, string> };

/** `.gitattributes` pins LF, but a byte compare that fails only on Windows CI for line endings is a trap this repo has already hit. */
const rootLicense = readFileSync(
  path.join(repoRoot, "LICENSE"),
  "utf8",
).replace(/\r\n/g, "\n");

// The `…/blob/main/` prefix every in-repository link in a published README is written against,
// taken from the constant that already spells the repository once rather than spelled a second
// time here — `registry-inventory.test.ts` pins that constant against the root manifest, so this
// inherits the same anchor.
const blobPrefix = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/blob\/main\//.exec(
  RULE_DOCS_BASE_URL,
)?.[0];
if (blobPrefix === undefined) {
  // Module-scope fail-fast, the same shape the `npm_execpath` guard above uses: a silently
  // unmatched prefix would make the README link assertion below find nothing and pass vacuously.
  throw new Error(
    `RULE_DOCS_BASE_URL (${RULE_DOCS_BASE_URL}) is no longer a \`https://<host>/<owner>/<repo>/blob/main/\` ` +
      "URL, so the packed-README link guard cannot derive the repository prefix it resolves against.",
  );
}

let packDir: string | undefined;
const payloads = new Map<string, Map<string, Buffer>>();

beforeAll(async () => {
  packDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-pack-"));

  // `--workspaces` packs the three publishable packages; the root is `private: true` and is not
  // packed. That pack path runs no lifecycle script, so nothing here rebuilds — which is why the
  // `assertBuilt()` calls above are a precondition rather than a convenience.
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
  // `packDir` is assigned by the first statement of `beforeAll`, so an `mkdtemp` that fails leaves
  // it undefined and an unguarded `rm` throws a `TypeError` over the error that actually matters.
  if (packDir !== undefined) {
    await rm(packDir, { recursive: true, force: true });
  }
});

describe.each(PUBLISHED_PACKAGES)(
  "published payload of $name (W-29)",
  ({ name, directory, allowedTopLevelEntries }) => {
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

    it("links only to files that exist in the repository", () => {
      // The README's links to guide pages and to the sibling packages are absolute URLs, which is
      // what makes them work on the npm page — and also what makes the REF rules skip them, so a
      // renamed guide page rots them silently on the one surface this payload exists to make
      // readable. `registry-inventory.test.ts` already guards this class for rule doc pages;
      // resolving the path half back to disk is the same check for the prose half.
      const targets = [
        ...new Set(
          [
            ...text("README.md").matchAll(
              new RegExp(
                // The prefix is data, not a pattern: `github.com`'s dots must match themselves.
                `${blobPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^)\\s"'#]+)`,
                "g",
              ),
            ),
          ].map((match) => match[1]!),
        ),
      ].sort();

      // Non-vacuous: a README that lost every link (or a prefix that stopped matching) would
      // otherwise satisfy "no dead link" perfectly.
      expect(targets.length).toBeGreaterThan(0);
      expect(
        targets.filter((target) => !existsSync(path.join(repoRoot, target))),
        `${name}'s README links to repository paths that do not exist. A moved or renamed page ` +
          "has to be followed here, in the published README, or the npm page ships a 404.",
      ).toEqual([]);
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

    it("ships its compiled entry point", () => {
      // The positive control for the map assertion below. Without it, a `dist` that failed to emit
      // at all would satisfy "no entry ends in `.map`" perfectly.
      expect(payload().has("dist/index.js")).toBe(true);
    });

    it("ships no source maps", () => {
      const maps = [...payload().keys()].filter((entry) =>
        entry.endsWith(".map"),
      );
      // The remedy has to name the forced build, not `npm run build`: flipping `declarationMap` /
      // `sourceMap` off does not delete already-emitted `.map` files, and `tsc -b` decides
      // up-to-dateness from *content* — no `src` file changed, so an incremental build leaves them
      // in place and this stays red against a command that just exited 0. A contributor with a
      // checkout built before maps were turned off hits exactly this.
      expect(
        maps,
        `${name} packs ${String(maps.length)} source map(s). Maps are off in tsconfig.base.json ` +
          "(P16.03 / W-31), so these are stale build output: delete packages/*/dist and run " +
          "`npx tsc -b --force`, then re-run. `npm run build` alone will not clear them.",
      ).toEqual([]);
    });

    it("ships nothing outside its allowlist", () => {
      // Stated as an allowed set rather than as "no docs/, no .github/": a denylist only catches
      // the leaks somebody already imagined, and the root pack this replaced was shipping a CI
      // workflow and a guide page precisely because nobody had imagined them.
      const unexpected = [
        ...new Set(
          [...payload().keys()]
            .map((entry) => entry.split("/")[0]!)
            .filter((segment) => !allowedTopLevelEntries.includes(segment)),
        ),
      ].sort();
      expect(
        unexpected,
        `${name} packs top-level entries outside its allowlist. Allowed: ` +
          `${allowedTopLevelEntries.join(", ")}. If the new entry is meant to ship, add it to ` +
          "`files` in the package manifest and to this package's `allowedTopLevelEntries`.",
      ).toEqual([]);
    });
  },
);

describe("release:check", () => {
  // The script is the only local command a maintainer runs before tagging, and it used to pack the
  // *root* — which is `private: true` with no `files`, so it exercised none of the three
  // allowlists while being described as validating exactly those. Nothing could have
  // caught that: the payload assertions above pack the workspaces themselves, so they stay green no
  // matter what the script does. Reading the script text is the only way this property is visible.
  const releaseCheck = rootManifest.scripts["release:check"];

  it("packs the workspaces, not the private root", () => {
    expect(releaseCheck).toContain("npm pack --dry-run --workspaces");
  });

  it("builds before it packs", () => {
    // `--workspaces` takes the pack path that runs **no** lifecycle script, so unlike a root
    // `npm pack` this one gets no `prepack` rebuild. Every package's `files` is `dist`-first, so a
    // reordering that moved the pack ahead of the build would pack whatever `dist` happened to
    // hold — or nothing at all — and still exit 0. The constraint is otherwise invisible in the
    // one-line script.
    const build = releaseCheck!.indexOf("npm run build");
    const pack = releaseCheck!.indexOf("npm pack");
    expect(build).toBeGreaterThanOrEqual(0);
    expect(
      build,
      "`npm run build` must stay ahead of `npm pack` in release:check: the --workspaces pack path " +
        "runs no lifecycle script, so nothing else rebuilds dist/ before it is packed.",
    ).toBeLessThan(pack);
  });
});

describe("published payload of @wastech-mdlint/cli — allowlist-only files (W-29)", () => {
  // Named for its subject rather than for its package: `describe.each` above generates a suite
  // called `published payload of @wastech-mdlint/cli (W-29)` for the same package, and a title that
  // is a prefix of that one cannot be selected alone with `-t`.
  it("still ships schema.json", () => {
    // The one payload file that ships *only* because `files` lists it — README and LICENSE are
    // force-included by npm regardless. So this is where the suite has real allowlist sensitivity,
    // and it is what makes editor `$schema` resolution work from the installed package.
    const schema = payloads.get("@wastech-mdlint/cli")!.get("schema.json");
    expect(schema).toBeDefined();
    expect(JSON.parse(schema!.toString("utf8"))).toMatchObject({
      type: "object",
    });
  });
});
