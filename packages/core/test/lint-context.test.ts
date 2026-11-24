import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfiguration } from "../src/config/load-config.js";
import { lintContext, lintFiles } from "../src/engine/lint-files.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { loadContext } from "../src/graph/load-context.js";
import { parseDocument } from "../src/markdown/parse-document.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "wastech-lint-context-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "wastech-mdlint.config.json"),
    JSON.stringify({
      include: ["**/*.md"],
      rules: [{ rule: "REF-001" }, { rule: "REF-002" }, { rule: "GRP-001" }],
    }),
  );
  await writeFile(
    path.join(root, "README.md"),
    "# Home\n\nSee [the guide](docs/guide.md#install) and [a missing page](docs/nope.md).\n",
  );
  await writeFile(
    path.join(root, "docs", "guide.md"),
    "# Guide\n\n## Install\n\nRead [the notes](notes.md), and [a missing anchor](../README.md#nowhere).\n",
  );
  await writeFile(
    path.join(root, "docs", "notes.md"),
    "# Notes\n\nBack [home](../README.md).\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("lintContext", () => {
  // The guarantee that makes it safe for a host to use: for the same tree it answers exactly what
  // `lintFiles` answers, findings and counts alike. The fixture carries a broken link, a broken
  // anchor and a three-file cycle, so document rules, a project rule and the graph all take part.
  it("gives lintFiles' result for a corpus loaded with loadContext", async () => {
    const loaded = await loadConfiguration({ cwd: root });
    const context = await loadContext({
      cwd: root,
      config: loaded.config,
      settings: loaded.settings,
    });

    const fromContext = lintContext({
      cwd: root,
      context,
      rules: loaded.rules,
      settings: loaded.settings,
    });
    const fromFiles = await lintFiles({
      cwd: root,
      config: loaded.config,
      rules: loaded.rules,
      settings: loaded.settings,
    });

    expect(fromContext.messages.length).toBeGreaterThan(0);
    expect(fromContext.messages.map((message) => message.ruleId)).toEqual(
      expect.arrayContaining(["REF-001", "REF-002", "GRP-001"]),
    );
    expect(fromContext).toEqual(fromFiles);
  });

  // A long-running host edits its in-memory corpus rather than reloading it; the result must follow
  // the edited documents, not anything read from disk. On disk README.md still has its broken link.
  it("lints the documents it is given, not the files on disk", async () => {
    const loaded = await loadConfiguration({ cwd: root });
    const context = await loadContext({
      cwd: root,
      config: loaded.config,
      settings: loaded.settings,
    });
    const documents = new Map(context.documents);
    documents.set(
      "README.md",
      parseDocument({
        path: "README.md",
        content: "# Home\n\nSee [the guide](docs/guide.md#install).\n",
      }),
    );
    const result = lintContext({
      cwd: root,
      context: {
        documents,
        graph: buildContextGraph(documents, {}),
      },
      rules: loaded.rules,
      settings: loaded.settings,
    });
    const brokenLinks = result.messages.filter(
      (message) =>
        message.filePath === "README.md" && message.ruleId === "REF-001",
    );
    expect(brokenLinks).toEqual([]);
  });
});
