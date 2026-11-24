import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ImpactClassification } from "@wastech-mdlint/core";
import { describe, expect, it } from "vitest";

import { tempDir } from "../../core/test/support/git-fixture.js";
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

  // One subject or the other: both would leave the answer's subject ambiguous, and neither leaves it
  // without one. Refused in the handler, so the client gets the hint rather than a bare schema error.
  it.each([
    { label: "neither file nor since", input: { cwd: graphProject } },
    {
      label: "both file and since",
      input: { cwd: graphProject, file: "requirements.md", since: "main" },
    },
  ])("refuses $label with a hint", async ({ input }) => {
    const result = await handleImpactAnalysis(input);
    expect(result.isError).toBe(true);
    const error = result.structuredContent as { code: string; hint?: string };
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.hint).toContain('"since"');
  });

  it("answers since outside a git work tree with git's reason, not an empty blast radius", async () => {
    const outside = await tempDir();
    await writeFile(path.join(outside, "a.md"), "# A\n");
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    // Kept from finding a repository above the temporary folder, as a home-directory one would be.
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(outside);
    try {
      const result = await handleImpactAnalysis({
        cwd: outside,
        since: "main",
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: "INVALID_INPUT",
        message: "The directory is not inside a git work tree.",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.GIT_CEILING_DIRECTORIES;
      } else {
        process.env.GIT_CEILING_DIRECTORIES = previous;
      }
    }
  });
});
