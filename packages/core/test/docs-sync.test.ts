import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateRuleDocs } from "../src/engine/rule-docs.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const readmePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../README.md",
);

function extractGeneratedTable(readme: string): string {
  // The `<!-- prettier-ignore -->` line and trailing blank line are formatting scaffolding
  // that keep `npm run format` from re-wrapping the table's padding; they sit outside
  // the captured group so this still compares the raw generated string byte-for-byte.
  const match =
    /<!-- BEGIN GENERATED RULES -->\n<!-- prettier-ignore -->\n([\s\S]*?)\n\n<!-- END GENERATED RULES -->/.exec(
      readme,
    );
  if (match === null) {
    throw new Error("README is missing the generated-rules markers");
  }
  return match[1]!;
}

describe("README rule table", () => {
  it("stays in sync with the rule metadata", () => {
    // If this fails, regenerate: `npm run build && npm run generate:docs`.
    const readme = readFileSync(readmePath, "utf8");
    expect(extractGeneratedTable(readme)).toBe(generateRuleDocs());
  });

  it("marks exactly the deterministic-fixable subset as fixable", () => {
    // The rule cell is `[`ID`](url)` — linked to the rule's `docsUrl` — so a data row is
    // recognized by the link opener and the id is read out of the code span inside it rather than
    // being the whole cell. The header and divider rows still fail both.
    const fixable = generateRuleDocs()
      .split("\n")
      .filter((line) => line.startsWith("| [`"))
      .filter((line) => line.split("|")[5]?.trim() === "yes")
      .map((line) => /^\| \[`([^`]+)`\]/.exec(line)?.[1]);
    expect(fixable.sort()).toEqual([
      "CTX-003",
      "REF-002",
      "REF-009",
      "SEC-001",
      "TBL-002",
    ]);
  });

  it("links every rule id to its own documentation page", () => {
    const rows = generateRuleDocs()
      .split("\n")
      .filter((line) => line.startsWith("| [`"));
    // One linked row per registered built-in — a rule whose cell lost its link (or gained a
    // mismatched one) fails here rather than only showing up as a stale README diff. The count comes
    // from the registry so it moves with it; registry-inventory.test.ts pins the exact id set.
    expect(rows).toHaveLength(ruleRegistry.getAllMetadata().length);
    for (const row of rows) {
      const match = /^\| \[`([^`]+)`\]\((\S+)\) \|/.exec(row);
      expect(match, row).not.toBeNull();
      expect(match![2]).toBe(
        `https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/${match![1]}.md`,
      );
    }
  });
});
