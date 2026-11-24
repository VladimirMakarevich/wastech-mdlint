import { describe, expect, it } from "vitest";

import { documentSections } from "../src/changes/sections.js";
import { parseDocument } from "../src/markdown/parse-document.js";

describe("documentSections", () => {
  const content = [
    "# Title", // 1
    "",
    "Intro.", // 3
    "",
    "## Install", // 5
    "",
    "Run it.", // 7
    "",
    "### On Windows", // 9
    "",
    "#### Details", // 11
    "",
    "Deep text.", // 13
    "",
    "## Use", // 15
    "",
    "Use it.", // 17
    "",
  ].join("\r\n");

  it("cuts a document at its second- and third-level headings, each section its own text only", () => {
    const sections = documentSections(
      parseDocument({ path: "doc.md", content }),
    );
    expect(
      sections.map(({ key, start, end, text }) => ({ key, start, end, text })),
    ).toEqual([
      { key: "", start: 1, end: 4, text: "# Title\n\nIntro." },
      { key: "install", start: 5, end: 8, text: "## Install\n\nRun it." },
      {
        key: "on-windows",
        start: 9,
        end: 14,
        text: "### On Windows\n\n#### Details\n\nDeep text.",
      },
      { key: "use", start: 15, end: 17, text: "## Use\n\nUse it." },
    ]);
    expect(sections[1]?.heading?.text).toBe("Install");
  });

  it("reads the last section the same once another is added below it", () => {
    const before = documentSections(parseDocument({ path: "doc.md", content }));
    const after = documentSections(
      parseDocument({ path: "doc.md", content: `${content}\r\n## More\r\n` }),
    );
    expect(after[3]?.text).toBe(before[3]?.text);
    expect(after[4]?.key).toBe("more");
  });

  it("has one empty section before the first heading when the document starts with one", () => {
    const sections = documentSections(
      parseDocument({ path: "doc.md", content: "## Only\n\nText.\n" }),
    );
    expect(sections.map(({ key, text }) => ({ key, text }))).toEqual([
      { key: "", text: "" },
      { key: "only", text: "## Only\n\nText." },
    ]);
  });
});
