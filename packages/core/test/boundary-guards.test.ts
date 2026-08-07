import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";

// A whole class of defects shipped because nothing tested the process boundary: the CLI entrypoint
// had 0% coverage, `exclude` had zero end-to-end coverage, and no `init` test exercised a write
// failure. Each of those now has a guard — but a *prose* checklist of them rots silently, which is
// the same class of failure all over again: the checklist would still claim coverage the tree no
// longer has.
//
// So this file is the enforcement half: it asserts each named category still has at least one
// tagged guard. It is deliberately an inventory rather than an abstraction — the coding rules say
// not to build extension points for hypothetical needs, and this is not one: the deliverable
// explicitly asks for named categories that are *visibly* missing when absent, which needs
// something that fails.
//
// Tag-based (`@boundary-guard <category>`) rather than describe-name-based on purpose: renaming a
// test or restructuring its describe blocks is routine and must not fail here, whereas deleting the
// guard — or moving it to a file that drops the tag — is exactly what must fail. The tag also puts
// the category name at the guard itself, so a reader who lands there sees why it may not be
// deleted.
//
// Living in `core`'s suite while reading files from `cli` and `mcp-server` follows the existing
// precedent of `docs-sync.test.ts`, which reads the repo-root README from here. Repo-relative POSIX
// paths so the failure message is the same on every host.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// Every category's paths sorted, and the categories themselves declared in sorted order, so this
// inventory reads the same way the assertions below compare it (determinism invariant: the order
// here is incidental, not meaningful).
const BOUNDARY_GUARDS: Record<string, string[]> = {
  // Every user-facing surface renders twice — a human document and a structured one — and each host
  // renders both. This category exists because three missed defects all traced to
  // nothing ever diffing those against each other: they agree by construction in a handler test, and
  // diverge only in what a reader or a client actually receives.
  "host-parity": [
    "packages/cli/test/lint.e2e.test.ts",
    "packages/mcp-server/test/context-graph.test.ts",
    "packages/mcp-server/test/host-parity.test.ts",
    "packages/mcp-server/test/lint-files.test.ts",
    "packages/mcp-server/test/lint.test.ts",
  ],
  // Spawn the built entrypoint through an npm-style link. Only a real process can populate
  // `process.argv[1]`, which is what the entrypoint guard compares against `import.meta.url` — and
  // only a spawned server shows what a client actually receives, which is where a
  // plausible-looking success once hid a missing input guard.
  "installed-bin-spawn": [
    "packages/cli/test/bin.e2e.test.ts",
    "packages/mcp-server/test/bin-entrypoint.test.ts",
    "packages/mcp-server/test/stdio-integration.test.ts",
  ],
  // The shared `files`/`exclude` option shape stays covered as rules are added: an inventory drift
  // guard plus a runtime assert-kind coverage check — plus the top-level scope's own
  // zero-config default, which only a run with no config file at all can exercise. And the
  // other direction: the corpus an `init`-written scope produces, compared against the tracked set
  // both ways, so a document entering it is as visible as one missing from it.
  "shared-exclude": [
    "packages/cli/test/init.e2e.test.ts",
    "packages/cli/test/lint.e2e.test.ts",
    "packages/core/test/registry-inventory.test.ts",
    "packages/core/test/rules-custom.test.ts",
  ],
  // A write that fails partway must leave no temp file and no half-written target, and the command
  // must report it and exit non-zero rather than claiming success.
  "write-failure": [
    "packages/cli/test/init.e2e.test.ts",
    "packages/core/test/atomic-write.test.ts",
  ],
  // Output must not depend on evaluation order or on state carried between calls (a `g`-flagged
  // RegExp's `lastIndex` being the concrete case that shipped).
  determinism: ["packages/core/test/primitives.test.ts"],
};

function tagsIn(relativePath: string): string[] {
  const contents = readFileSync(path.join(repoRoot, relativePath), "utf8");
  return [...contents.matchAll(/@boundary-guard\s+(\S+)/g)].map(
    (match) => match[1] as string,
  );
}

describe("process-boundary guard inventory", () => {
  const categories = Object.keys(BOUNDARY_GUARDS).sort(compareStrings);

  it("names every category the testing rules document", () => {
    // This list is duplicated as a table in the repository's testing rules. If a category is added
    // there, add it here with its guard — and vice versa; that pairing is the whole point, and this
    // assertion is the half of it a machine can enforce.
    expect(categories).toEqual([
      "determinism",
      "host-parity",
      "installed-bin-spawn",
      "shared-exclude",
      "write-failure",
    ]);
  });

  for (const category of categories) {
    const guardFiles = [...BOUNDARY_GUARDS[category]!].sort(compareStrings);

    it(`keeps every guard file tagged for "${category}"`, () => {
      // Asserted as a whole object rather than per-file so one failure lists every file that lost
      // its tag, instead of stopping at the first.
      const tagged = Object.fromEntries(
        guardFiles.map((file) => [file, tagsIn(file).includes(category)]),
      );

      expect(tagged).toEqual(
        Object.fromEntries(guardFiles.map((file) => [file, true])),
      );
    });
  }
});
