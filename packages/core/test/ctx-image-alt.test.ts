import { describe, expect, it } from "vitest";

import { imageAltFindings } from "../src/engine/rules/ctx-image-alt.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function findings(content: string) {
  return imageAltFindings(parseDocument({ path: "doc.md", content }));
}

function targets(content: string) {
  return findings(content).map((finding) => finding.data?.target);
}

describe("CTX-005 image alt text", () => {
  it("reports empty and whitespace-only alt and passes a descriptive one", () => {
    expect(
      findings(
        "![](a.png)\n\n![ ](b.png)\n\n![diagram of the pipeline](c.png)\n",
      ),
    ).toEqual([
      {
        message:
          'Image "a.png" has no alt text; describe what the image shows.',
        line: 1,
        column: 1,
        data: { target: "a.png" },
      },
      {
        message:
          'Image "b.png" has no alt text; describe what the image shows.',
        line: 3,
        column: 1,
        data: { target: "b.png" },
      },
    ]);
  });

  it("returns nothing for a document without images", () => {
    expect(findings("# Title\n\nJust [a link](a.md).\n")).toEqual([]);
  });

  it("resolves reference images the same way as inline images", () => {
    expect(
      targets(
        "![full][r] ![collapsed][] ![shortcut]\n\n![][r]\n\n[r]: r.png\n[collapsed]: c.png\n[shortcut]: s.png\n",
      ),
    ).toEqual(["r.png"]);
  });

  it("does not report a reference image whose definition is missing", () => {
    expect(findings("![][missing]\n")).toEqual([]);
  });

  it("reports an image inside a link, since the alt is all a model gets of it", () => {
    expect(targets("[![](badge.svg)](https://example.com)\n")).toEqual([
      "badge.svg",
    ]);
  });

  it("reports images wherever they appear: heading, list item, table cell", () => {
    expect(
      targets(
        "# Logo ![](h.png)\n\n- item ![](l.png)\n\n| a | b |\n| --- | --- |\n| ![](t.png) | x |\n",
      ),
    ).toEqual(["h.png", "l.png", "t.png"]);
  });

  it("treats Unicode and newline whitespace as empty", () => {
    expect(targets("![\u00a0](n.png) ![\u3000](i.png) ![\n](w.png)\n")).toEqual(
      ["n.png", "i.png", "w.png"],
    );
  });

  it("does not report punctuation-only alt, which is a quality judgment out of scope", () => {
    expect(findings("![-](a.png)\n")).toEqual([]);
  });

  it("ignores image syntax inside fenced and inline code", () => {
    expect(
      findings("```md\n![](x.png)\n```\n\nUse `![](y.png)` here.\n"),
    ).toEqual([]);
  });

  it("reports several images on one line in column order", () => {
    expect(
      findings("![](a.png) ![](b.png) ![](c.png)\n").map((finding) => [
        finding.data?.target,
        finding.column,
      ]),
    ).toEqual([
      ["a.png", 1],
      ["b.png", 12],
      ["c.png", 23],
    ]);
  });
});
