import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ImpactClassification } from "@wastech-mdlint/core";
import { describe, expect, it } from "vitest";

import { handleImpactAnalysis } from "../src/tools/impact-analysis.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const graphProject = path.join(fixturesDir, "graph-project");

function structured(
  result: Awaited<ReturnType<typeof handleImpactAnalysis>>,
): ImpactClassification {
  return result.structuredContent as unknown as ImpactClassification;
}

describe("handleImpactAnalysis", () => {
  it("classifies the blast radius of a referenced file", async () => {
    const result = await handleImpactAnalysis({
      cwd: graphProject,
      file: "requirements.md",
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.file).toBe("requirements.md");
    expect(output.directlyAffected).toEqual([
      { path: "design.md", references: 1 },
      { path: "guide.md", references: 1 },
    ]);
    expect(output.transitivelyAffected).toEqual([
      { path: "index.md", depth: 2, via: "guide.md" },
    ]);
    expect(output.readingOrder).toEqual([
      "design.md",
      "index.md",
      "guide.md",
      "requirements.md",
    ]);
    expect(output.excluded).toEqual([]);
  });

  it("excludes cycle members from the reading order", async () => {
    const result = await handleImpactAnalysis({
      cwd: graphProject,
      file: "cycle-b.md",
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.readingOrder).toEqual([]);
    expect(output.excluded).toEqual(["cycle-a.md", "cycle-b.md"]);
  });

  it("returns an actionable error for a file outside the corpus", async () => {
    const result = await handleImpactAnalysis({
      cwd: graphProject,
      file: "missing.md",
    });

    expect(result.isError).toBe(true);
    const error = result.structuredContent as { code: string; hint?: string };
    expect(error.code).toBe("TARGET_NOT_FOUND");
    expect(error.hint).toBeTruthy();
  });
});
