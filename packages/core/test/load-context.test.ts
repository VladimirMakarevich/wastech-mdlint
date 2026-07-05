import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadContext } from "../src/graph/load-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-load-context-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

describe("loadContext", () => {
  it("keys documents by repo-relative POSIX path and builds a matching graph", async () => {
    const root = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const context = await loadContext({ cwd: root, config: { include: ["**/*.md"] }, settings: {} });

    expect([...context.documents.keys()].sort()).toEqual(["a.md", "b.md"]);
    expect(context.graph.nodes.map((node) => node.path).sort()).toEqual(["a.md", "b.md"]);
    expect(context.graph.edges).toEqual([expect.objectContaining({ from: "a.md", to: "b.md", type: "link" })]);
  });

  it("respects config include/exclude when loading the corpus", async () => {
    const root = await fixtureRepo({ "a.md": "# A\n", "excluded.md": "# Excluded\n" });

    const context = await loadContext({
      cwd: root,
      config: { include: ["**/*.md"], exclude: ["excluded.md"] },
      settings: {}
    });

    expect([...context.documents.keys()]).toEqual(["a.md"]);
  });

  it("threads settings.idRef into the graph so id-ref edges materialize", async () => {
    const root = await fixtureRepo({
      "a.md": "See REQ-1 for details.\n",
      "b.md": "| id |\n| --- |\n| REQ-1 |\n"
    });

    const context = await loadContext({
      cwd: root,
      config: { include: ["**/*.md"] },
      settings: { idRef: { idPattern: "REQ-\\d+", definitions: ["**/*.md"], idColumn: "id" } }
    });

    expect(context.graph.edges.some((edge) => edge.type === "id-ref")).toBe(true);
  });

  it("is deterministic across repeated calls", async () => {
    const root = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "[c](c.md)\n", "c.md": "# C\n" });

    const first = await loadContext({ cwd: root, config: { include: ["**/*.md"] }, settings: {} });
    const second = await loadContext({ cwd: root, config: { include: ["**/*.md"] }, settings: {} });

    expect(first.graph).toEqual(second.graph);
  });
});
