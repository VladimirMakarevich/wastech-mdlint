import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";

// P12.06, deliverable 1. The post-P9 audit's systemic cause was that nothing tested the process
// boundary: `src/index.ts` had 0% coverage (H-1), `exclude` had zero e2e coverage (L-4), no `init`
// test exercised a write failure (M-5). Each of those now has a guard — but a *prose* checklist of
// them (`.agents/rules/testing.md`, "Process-Boundary Guards") rots silently, which is the same
// class of failure all over again: the checklist would still claim coverage the tree no longer has.
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
  // Spawn the built entrypoint through an npm-style link. Only a real process can populate
  // `process.argv[1]`, which is what the entrypoint guard compares against `import.meta.url`.
  "installed-bin-spawn": [
    "packages/cli/test/bin.e2e.test.ts",
    "packages/mcp-server/test/bin-entrypoint.test.ts",
  ],
  // The shared `files`/`exclude` option shape stays covered as rules are added: an inventory drift
  // guard plus a runtime assert-kind coverage check — and, since P13.02, the top-level scope's own
  // zero-config default, which only a run with no config file at all can exercise.
  "shared-exclude": [
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

describe("process-boundary guard inventory (P12.06)", () => {
  const categories = Object.keys(BOUNDARY_GUARDS).sort(compareStrings);

  it("names every category the testing rules document", () => {
    // Mirrors `.agents/rules/testing.md`'s "Process-Boundary Guards" section. If a category is
    // added there, add it here (with its guard) — and vice versa; that pairing is the whole point.
    expect(categories).toEqual([
      "determinism",
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
