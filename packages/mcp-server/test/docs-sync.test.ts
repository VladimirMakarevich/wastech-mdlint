import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateToolInventory } from "../src/tool-docs.js";

// M3 sync check, mirroring packages/core/test/docs-sync.test.ts: the README's MCP tool table must
// equal what the generator produces, so it can't drift from the live registration.
const readmePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../README.md");

function extractGeneratedTable(readme: string): string {
  const match = /<!-- BEGIN GENERATED MCP TOOLS -->\n([\s\S]*?)\n<!-- END GENERATED MCP TOOLS -->/.exec(
    readme
  );
  if (match === null) {
    throw new Error("README is missing the generated MCP-tools markers");
  }
  return match[1]!;
}

describe("README MCP tool inventory", () => {
  it("renders one row per registered tool with the locked structured-output split", async () => {
    const table = await generateToolInventory();
    const rows = table.split("\n").filter((line) => line.startsWith("| `"));

    expect(rows).toHaveLength(6);

    // Parse each row anchored from both ends rather than splitting on every `|`: a description may
    // contain an escaped `\|`, which a raw split would miscount into the wrong columns. The name is
    // the leading backticked cell; the read-only and structured-output flags are the last two cells.
    const rowPattern = /^\|\s*(`[^`]+`)\s*\|.*\|\s*(yes|no)\s*\|\s*(yes|no)\s*\|$/;
    const parsed = rows.map((row) => {
      const match = rowPattern.exec(row);
      if (match === null) {
        throw new Error(`Unparseable tool-inventory row: ${row}`);
      }
      return { name: match[1]!, readOnly: match[2]!, structured: match[3]! };
    });

    expect(parsed.map((entry) => entry.name).sort()).toEqual([
      "`compile-context`",
      "`context-graph`",
      "`context-slice`",
      "`impact-analysis`",
      "`lint-files`",
      "`lint`"
    ]);

    // Every tool is read-only (M7); compile-context is the M1 exception with no structured output.
    expect(parsed.every((entry) => entry.readOnly === "yes")).toBe(true);
    const structuredOf = (name: string): string =>
      parsed.find((entry) => entry.name === `\`${name}\``)!.structured;
    expect(structuredOf("compile-context")).toBe("no");
    expect(structuredOf("lint")).toBe("yes");
  });

  it("stays in sync with the README (M3)", async () => {
    // If this fails, regenerate: `npm run build && npm run generate:docs`.
    const readme = readFileSync(readmePath, "utf8");
    expect(extractGeneratedTable(readme)).toBe(await generateToolInventory());
  });
});
