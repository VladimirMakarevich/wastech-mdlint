import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ChangedDocument,
  computeContextDelta,
  swapsTowardBase,
  swapsTowardHead,
} from "../src/changes/context-delta.js";
import { eagerContextBudgets } from "../src/changes/influence.js";
import {
  compareEdges,
  linksIntoChangedLines,
} from "../src/changes/link-delta.js";
import { replaceDocuments } from "../src/changes/snapshot.js";
import { diffText } from "../src/changes/text-diff.js";
import { parseConfiguration } from "../src/config/load-config.js";
import { lintContext } from "../src/engine/lint-files.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// No file is read: every document comes in as text, and the links that would need a file on disk
// point at Markdown documents only.
const cwd = path.join(os.tmpdir(), "wastech-mdlint-context-delta");

const configuration = (rules: unknown[]) =>
  parseConfiguration({
    text: JSON.stringify({ rules }),
    cwd,
    configPath: path.join(cwd, "wastech-mdlint.config.json"),
  });

function corpus(texts: Record<string, string>): Map<string, ParsedDocument> {
  return new Map(
    Object.entries(texts).map(([relPath, content]) => [
      relPath,
      parseDocument({ path: relPath, content }),
    ]),
  );
}

function change(
  status: ChangedDocument["status"],
  relPath: string,
  texts: { base?: string; head?: string; oldPath?: string },
): ChangedDocument {
  const basePath = texts.oldPath ?? relPath;
  return {
    path: relPath,
    ...(texts.oldPath === undefined ? {} : { oldPath: texts.oldPath }),
    status,
    diff: diffText(texts.base ?? "", texts.head ?? ""),
    ...(texts.base === undefined
      ? {}
      : { base: parseDocument({ path: basePath, content: texts.base }) }),
    ...(texts.head === undefined
      ? {}
      : { head: parseDocument({ path: relPath, content: texts.head }) }),
  };
}

const BASE = {
  "guide.md": "# Guide\n\nSee [missing](nowhere.md).\n",
  "hub.md": "# Hub\n\n## Setup\n\nText.\n",
  "reader.md": "# Reader\n\nSee [setup](hub.md#setup).\n",
  "gone.md": "# Gone\n\nSee [missing](elsewhere.md).\n",
};
const HEAD = {
  "guide.md":
    "# Guide\n\nA new paragraph above.\n\nSee [missing](nowhere.md).\n",
  "hub.md": "# Hub\n\n## Installation\n\nText.\n",
  "reader.md": BASE["reader.md"],
  "added.md": "# Added\n\nSee [broken](nope.md).\n",
};
const CHANGES = [
  change("M", "guide.md", { base: BASE["guide.md"], head: HEAD["guide.md"] }),
  change("M", "hub.md", { base: BASE["hub.md"], head: HEAD["hub.md"] }),
  change("D", "gone.md", { base: BASE["gone.md"] }),
  change("A", "added.md", { head: HEAD["added.md"] }),
];

describe("replaceDocuments and the swaps between versions", () => {
  // The base is the head with only the changed documents swapped; every other document stays the
  // very object the head holds, so nothing is parsed again.
  it("turns the head's corpus into the base's and back", () => {
    const head = corpus(HEAD);
    const base = replaceDocuments(head, swapsTowardBase(CHANGES));
    expect([...base.keys()]).toEqual([
      "gone.md",
      "guide.md",
      "hub.md",
      "reader.md",
    ]);
    expect(base.get("guide.md")?.content).toBe(BASE["guide.md"]);
    expect(base.get("reader.md")).toBe(head.get("reader.md"));

    const again = replaceDocuments(base, swapsTowardHead(CHANGES));
    expect([...again.keys()]).toEqual([
      "added.md",
      "guide.md",
      "hub.md",
      "reader.md",
    ]);
    expect(again.get("hub.md")?.content).toBe(HEAD["hub.md"]);
  });
});

describe("computeContextDelta", () => {
  const rules = configuration([{ rule: "REF-001" }, { rule: "REF-002" }]);
  const head = corpus(HEAD);
  const delta = computeContextDelta({
    cwd,
    base: {
      documents: replaceDocuments(head, swapsTowardBase(CHANGES)),
      configuration: rules,
    },
    head: { documents: head, configuration: rules },
    changes: CHANGES,
  });
  const where = (
    messages: { filePath: string; line: number; ruleId: string }[],
  ) =>
    messages.map(
      (message) => `${message.ruleId} ${message.filePath}:${message.line}`,
    );

  // The paragraph inserted above the guide's broken link moved its finding from line 3 to line 5;
  // mapped through the diff it is the same finding, and the change neither added nor removed it.
  it("follows a finding a change above it moved, and counts a deleted document's as removed", () => {
    expect(where(delta.findings.added)).toEqual([
      "REF-001 added.md:3",
      "REF-002 reader.md:3",
    ]);
    expect(where(delta.findings.removed)).toEqual(["REF-001 gone.md:3"]);
    const guide = delta.documents.find((entry) => entry.path === "guide.md");
    expect(guide?.findings).toEqual({ added: [], removed: [] });
  });

  it("lists an unchanged document whose anchor the change broke as affected", () => {
    expect(delta.affected.findings.map((entry) => entry.path)).toEqual([
      "reader.md",
    ]);
    expect(delta.affected.linking).toEqual([
      { path: "reader.md", targets: ["hub.md"] },
    ]);
  });

  it("names the changed documents given new errors", () => {
    expect(delta.newErrors).toEqual(["added.md"]);
  });

  it("measures each side a document exists on", () => {
    const added = delta.documents.find((entry) => entry.path === "added.md");
    expect(added?.base).toBeUndefined();
    expect(added?.head?.lines).toBe(3);
    const gone = delta.documents.find((entry) => entry.path === "gone.md");
    expect(gone?.head).toBeUndefined();
    expect(gone?.base?.lines).toBe(3);
  });

  it("finds nothing to compare when both sides use one configuration", () => {
    expect(delta.configOnly).toBeUndefined();
    expect(delta.scopeChanged).toBe(false);
  });

  // The config's own effect is the head's documents linted with each side's rules: here the base
  // ran no rules, so every head finding is the config's doing.
  it("separates what the config change alone does", () => {
    const noRules = configuration([]);
    const configured = computeContextDelta({
      cwd,
      base: { documents: corpus(HEAD), configuration: noRules },
      head: { documents: corpus(HEAD), configuration: rules },
      changes: [],
    });
    expect(where(configured.configOnly?.added ?? [])).toEqual([
      "REF-001 added.md:3",
      "REF-001 guide.md:5",
      "REF-002 reader.md:3",
    ]);
  });
});

describe("compareEdges", () => {
  // A document that only moved keeps its links: the rename maps its old path onto its new one.
  it("compares links as multisets, following renamed documents", () => {
    const before = buildContextGraph(
      corpus({
        "old.md": "[x](x.md) [x again](x.md)\n",
        "x.md": "# X\n",
        "y.md": "# Y\n",
      }),
    );
    const after = buildContextGraph(
      corpus({
        "new.md": "[x](x.md) [y](y.md)\n",
        "x.md": "# X\n",
        "y.md": "# Y\n",
      }),
    );
    const delta = compareEdges(before, after, new Map([["old.md", "new.md"]]));
    expect(delta.added.map((edge) => `${edge.from}→${edge.to}`)).toEqual([
      "new.md→y.md",
    ]);
    expect(delta.removed.map((edge) => `${edge.from}→${edge.to}`)).toEqual([
      "old.md→x.md",
    ]);
  });
});

describe("linksIntoChangedLines", () => {
  const code = (lines: string[]) => `${lines.join("\n")}\n`;
  const base = code(
    Array.from({ length: 12 }, (_, index) => `line ${index + 1}`),
  );
  const links = (anchor: string) =>
    parseDocument({
      path: "docs/notes.md",
      content: `# Notes\n\nSee [code](../src/app.ts#${anchor}).\n`,
    });
  const flagged = (head: string, anchor: string) =>
    linksIntoChangedLines(
      [links(anchor)],
      new Map([["src/app.ts", { baseText: base, headText: head }]]),
    ).map((link) => `${link.from}:${link.line} ${link.start}-${link.end}`);

  it("flags a link into edited lines, and one into lines an insertion above moved", () => {
    const edited = base.replace("line 4\n", "line four\n");
    expect(flagged(edited, "L3-L5")).toEqual(["docs/notes.md:3 3-5"]);
    const shifted = base.replace("line 2\n", "line 2\nnew line\n");
    expect(flagged(shifted, "L10")).toEqual(["docs/notes.md:3 10-10"]);
  });

  it("leaves a link alone when the change is below its range", () => {
    const below = base.replace("line 11\n", "line eleven\n");
    expect(flagged(below, "L3-L5")).toEqual([]);
    expect(flagged(below, "L5C2-L3")).toEqual([]);
  });
});

describe("eagerContextBudgets", () => {
  // The number shown beside a budget is the number LLM-001 judges: both come from one traversal.
  it("gives the totals LLM-001 reports", () => {
    const documents = corpus({
      "CLAUDE.md": "# Rules\n\n@rules/style.md\n",
      "rules/style.md": `# Style\n\n${"Write short sentences. ".repeat(40)}\n`,
    });
    const budgeted = configuration([
      {
        rule: "LLM-001",
        options: { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 10 },
      },
    ]);
    const [budget] = eagerContextBudgets(documents, budgeted.config);
    const reported = lintContext({
      cwd,
      context: { documents, graph: buildContextGraph(documents) },
      rules: budgeted.rules,
      settings: budgeted.settings,
    }).messages.find((message) => message.ruleId === "LLM-001");
    expect(budget).toMatchObject({
      entrypoint: "CLAUDE.md",
      maxTokens: 10,
      importedFiles: 1,
    });
    expect(reported?.data?.totalTokens).toBe(budget?.tokens);
  });
});
