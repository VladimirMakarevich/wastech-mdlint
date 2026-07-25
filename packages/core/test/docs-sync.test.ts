import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateRuleDocs } from "../src/engine/rule-docs.js";

const readmePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../README.md",
);

function extractGeneratedTable(readme: string): string {
  // The `<!-- prettier-ignore -->` line and trailing blank line are formatting scaffolding
  // (P9.06) that keep `npm run format` from re-wrapping the table's padding; they sit outside
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
  it("stays in sync with the rule metadata (R6)", () => {
    // If this fails, regenerate: `npm run build && npm run generate:docs`.
    const readme = readFileSync(readmePath, "utf8");
    expect(extractGeneratedTable(readme)).toBe(generateRuleDocs());
  });

  it("marks exactly the deterministic-fixable subset as fixable (audit 4.2)", () => {
    const fixable = generateRuleDocs()
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .filter((line) => line.split("|")[5]?.trim() === "yes")
      .map((line) => line.split("|")[1]?.trim());
    expect(fixable.sort()).toEqual(["`SEC-001`", "`TBL-002`"]);
  });
});
