import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseDocument } from "../src/markdown/parse-document.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import type { PrimitiveContext } from "../src/engine/primitives/types.js";
import {
  columnInSet,
  columnMatches,
  columnNotEmpty,
  columnUnique,
  crossColumn,
  requiredColumns
} from "../src/engine/primitives/table.js";
import { sectionOrder, sectionPresent } from "../src/engine/primitives/section.js";
import { contentNotMatch, noPlaceholders } from "../src/engine/primitives/content.js";
import { allChecked } from "../src/engine/primitives/checklist.js";
import { imageResolves, linkResolves } from "../src/engine/primitives/reference.js";
import { runAssertion } from "../src/engine/primitives/assert.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function doc(content: string, filePath = "doc.md"): ParsedDocument {
  return parseDocument({ path: filePath, content });
}

function ctx(document: ParsedDocument, extras: Partial<PrimitiveContext> = {}): PrimitiveContext {
  return {
    document,
    documents: extras.documents ?? new Map([[document.path, document]]),
    rootDir: extras.rootDir ?? "/nonexistent-root",
    settings: extras.settings ?? {}
  };
}

const TABLE = ["| ID | Owner | Status |", "| --- | --- | --- |", "| REQ-1 | Ann | open |", "| REQ-2 |  | done |"].join(
  "\n"
);

describe("table primitives", () => {
  it("requiredColumns flags a missing column", () => {
    const findings = requiredColumns(doc(TABLE), { columns: ["ID", "Priority"] });
    expect(findings.map((finding) => finding.data?.column)).toEqual(["Priority"]);
  });

  it("columnNotEmpty flags empty cells and marks them fixable", () => {
    const findings = columnNotEmpty(doc(TABLE), { columns: ["Owner"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 4, fixable: true, data: { column: "Owner" } });
  });

  it("columnNotEmpty checks every column when none specified", () => {
    const findings = columnNotEmpty(doc(TABLE), {});
    expect(findings).toHaveLength(1);
    expect(findings[0]?.data?.column).toBe("Owner");
  });

  it("columnInSet flags values outside the allowed set (case-insensitive optional)", () => {
    const sensitive = columnInSet(doc(TABLE), { column: "Status", values: ["open", "done"] });
    expect(sensitive).toHaveLength(0);

    const table = ["| Status |", "| --- |", "| OPEN |"].join("\n");
    expect(columnInSet(doc(table), { column: "Status", values: ["open"] })).toHaveLength(1);
    expect(
      columnInSet(doc(table), { column: "Status", values: ["open"], caseSensitive: false })
    ).toHaveLength(0);
  });

  it("columnMatches flags values that fail the pattern", () => {
    const findings = columnMatches(doc(TABLE), { column: "ID", pattern: "^REQ-\\d+$" });
    expect(findings).toHaveLength(0);
    expect(columnMatches(doc(TABLE), { column: "ID", pattern: "^BUG-" })).toHaveLength(2);
  });

  it("crossColumn enforces a when→then conditional", () => {
    const table = [
      "| Status | Resolution |",
      "| --- | --- |",
      "| done | fixed |",
      "| done |  |"
    ].join("\n");
    const findings = crossColumn(doc(table), {
      when: { column: "Status", equals: "done" },
      then: { column: "Resolution", notEmpty: true }
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(4);
  });

  it("columnUnique flags duplicates across the corpus (project) and attributes the second one", () => {
    const a = doc("| ID |\n| --- |\n| REQ-1 |\n", "a.md");
    const b = doc("| ID |\n| --- |\n| REQ-1 |\n", "b.md");
    const documents = new Map([
      [a.path, a],
      [b.path, b]
    ]);
    const findings = columnUnique({ documents }, { column: "ID" }, () => true);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ filePath: "b.md", data: { value: "REQ-1", firstSeenIn: "a.md" } });
  });
});

describe("section primitives", () => {
  it("sectionPresent flags a missing section at line 0", () => {
    const findings = sectionPresent(doc("# Intro\n## Details\n"), { sections: ["Intro", "Summary"] });
    expect(findings).toEqual([{ message: 'Required section "Summary" is missing.', line: 0, data: { section: "Summary" } }]);
  });

  it("sectionOrder flags an inversion of present sections", () => {
    const findings = sectionOrder(doc("# B\n# A\n"), { order: ["A", "B"] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.data).toMatchObject({ section: "B", expectedAfter: "A" });
  });

  it("sectionOrder honors the level filter", () => {
    const content = "## A\n### Z\n## B\n";
    expect(sectionOrder(doc(content), { order: ["A", "B"], level: 2 })).toHaveLength(0);
  });
});

describe("content & checklist primitives", () => {
  it("contentNotMatch reports each disallowed match with its line", () => {
    const findings = contentNotMatch(doc("line one\nsecret=abc\n"), { pattern: "secret=" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
  });

  it("noPlaceholders flags empty and placeholder-only sections but not prose mentions", () => {
    const content = ["## Empty", "", "## Todo", "TODO", "## Fine", "This mentions TODO in prose."].join("\n");
    const findings = noPlaceholders(doc(content), {});
    expect(findings.map((finding) => finding.data)).toEqual([
      { section: "Empty", kind: "empty" },
      { section: "Todo", kind: "placeholder" }
    ]);
  });

  it("noPlaceholders unions custom placeholders with the locked defaults", () => {
    const content = "## S\nLATER\n";
    expect(noPlaceholders(doc(content), {})).toHaveLength(0);
    expect(noPlaceholders(doc(content), { placeholders: ["LATER"] })).toHaveLength(1);
  });

  it("allChecked flags unchecked items", () => {
    const findings = allChecked(doc("- [x] a\n- [ ] b\n"), {});
    expect(findings).toHaveLength(1);
    expect(findings[0]?.data).toMatchObject({ text: "b" });
  });
});

describe("reference primitives", () => {
  it("linkResolves passes for corpus targets and flags unresolved ones", () => {
    const source = doc("[ok](b.md)\n[bad](missing.md)\n", "a.md");
    const target = doc("# B\n", "b.md");
    const documents = new Map([
      [source.path, source],
      [target.path, target]
    ]);
    const findings = linkResolves(source, { documents, rootDir: "/nonexistent-root", settings: {} }, {});
    expect(findings).toHaveLength(1);
    expect(findings[0]?.data).toMatchObject({ target: "missing.md" });
  });

  it("linkResolves routes root-relative links through the starlight site router", () => {
    const source = doc("[guide](/guide/intro)\n", "src/content/docs/index.md");
    const routed = doc("# Intro\n", "src/content/docs/guide/intro.md");
    const documents = new Map([
      [source.path, source],
      [routed.path, routed]
    ]);
    const settings = { siteRouter: { preset: "starlight", contentDir: "src/content/docs" } };
    expect(
      linkResolves(source, { documents, rootDir: "/nonexistent-root", settings }, {})
    ).toHaveLength(0);
  });

  it("imageResolves checks the filesystem and skips external images", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-img-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "real.png"), "x", "utf8");

    const source = doc("![a](real.png)\n![b](missing.png)\n![c](https://x/y.png)\n", "doc.md");
    const findings = imageResolves(source, { documents: new Map(), rootDir: root, settings: {} }, {});
    expect(findings.map((finding) => finding.data?.target)).toEqual(["missing.png"]);
  });
});

describe("runAssertion dispatch", () => {
  it("dispatches a validated assertion to the right primitive", () => {
    const findings = runAssertion({ kind: "columnNotEmpty", column: "Owner" }, ctx(doc(TABLE)));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.data?.column).toBe("Owner");
  });
});
