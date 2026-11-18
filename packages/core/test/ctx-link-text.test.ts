import { describe, expect, it } from "vitest";

import {
  DEFAULT_NON_DESCRIPTIVE_LINK_TEXT,
  linkTextFindings,
  normalizeLinkText,
} from "../src/engine/rules/ctx-link-text.js";
import { parseDocument } from "../src/markdown/parse-document.js";

const DEFAULT_PHRASES = new Set(
  DEFAULT_NON_DESCRIPTIVE_LINK_TEXT.map(normalizeLinkText),
);

function findings(content: string, phrases = DEFAULT_PHRASES) {
  return linkTextFindings(parseDocument({ path: "doc.md", content }), {
    phrases,
  });
}

function texts(content: string) {
  return findings(content).map((finding) => finding.data?.text);
}

describe("CTX-004 default phrases", () => {
  it("reports English and Russian non-descriptive text and passes a descriptive one", () => {
    expect(
      findings(
        "See [here](a.md).\n\nСм. [здесь](b.md).\n\nRead the [installation guide](c.md).\n",
      ),
    ).toEqual([
      {
        message:
          'Link text "here" does not describe its target; name what the link leads to.',
        line: 1,
        column: 5,
        data: { text: "here", phrase: "here", target: "a.md" },
      },
      {
        message:
          'Link text "здесь" does not describe its target; name what the link leads to.',
        line: 3,
        column: 5,
        data: { text: "здесь", phrase: "здесь", target: "b.md" },
      },
    ]);
  });

  it("reports every shipped default phrase", () => {
    for (const phrase of DEFAULT_NON_DESCRIPTIVE_LINK_TEXT) {
      expect(texts(`[${phrase}](a.md)\n`)).toEqual([phrase]);
    }
  });

  it("compares case-insensitively after trimming edge punctuation, quoting the author's text", () => {
    expect(
      texts(
        "[Click Here!](a.md) [«Здесь»](a.md) [read more →](a.md) [(link)](a.md)\n",
      ),
    ).toEqual(["Click Here", "Здесь", "read more", "link"]);
  });

  it("keeps punctuation inside the text, and needs the whole text to match", () => {
    expect(
      texts("[here-and-there](a.md) [more about installation](a.md)\n"),
    ).toEqual([]);
  });

  it("collapses text wrapped across lines so the message stays on one line", () => {
    const [finding] = findings("[click\nhere](a.md)\n");
    expect(finding?.data?.text).toBe("click here");
    expect(finding?.message).not.toContain("\n");
  });

  it("collapses CRLF line endings the same way", () => {
    expect(texts("[click\r\nhere](a.md)\r\n")).toEqual(["click here"]);
  });
});

describe("CTX-004 edge-case contract", () => {
  it("passes autolinks and links whose text is the URL under the default list", () => {
    expect(
      texts(
        [
          "<https://example.com>",
          "<user@example.com>",
          "www.example.com",
          "[https://example.com](https://example.com)",
          "",
        ].join("\n\n"),
      ),
    ).toEqual([]);
  });

  it("matches URL text like any other text when a phrase names it", () => {
    // No special case for URLs: the default list simply holds none, so a configured one matches.
    const phrases = new Set([normalizeLinkText("https://example.com")]);
    expect(
      findings(
        "<https://example.com> [https://example.com](https://example.com)\n",
        phrases,
      ).map((finding) => finding.data?.text),
    ).toEqual(["https://example.com", "https://example.com"]);
  });

  it("ignores image-only link text and standalone images, but judges text beside an image", () => {
    expect(texts("[![here](b.png)](a.md)\n")).toEqual([]);
    expect(texts("![here](b.png)\n")).toEqual([]);
    expect(texts("[![i](i.png) here](a.md)\n")).toEqual(["here"]);
  });

  it("judges the text a reader sees, without raw inline HTML", () => {
    expect(
      texts("[<em>here</em>](a.md) [here<!-- x -->](a.md) [<b></b>](a.md)\n"),
    ).toEqual(["here", "here"]);
  });

  it("treats a hard line break or an inline <br> inside the text as whitespace", () => {
    expect(
      texts(
        "[click\\\nhere](a.md) [click<br>here](a.md) [click<br/>here](a.md) [click<BR />here](a.md)\n",
      ),
    ).toEqual(["click here", "click here", "click here", "click here"]);
    // A `<br>` carrying attributes, one whose attributes span a line, and the stray `</br>` end
    // tag all render a line break too.
    expect(
      texts(
        '[click<br class="x">here](a.md) [click<br\nid="y" />here](a.md) [click</br>here](a.md)\n',
      ),
    ).toEqual(["click here", "click here", "click here"]);
    // Other tags stay markup, not whitespace, including ones whose name merely starts with `br`.
    expect(texts("[cl<b>ick</b> here](a.md) [click<bra>here](a.md)\n")).toEqual(
      ["click here"],
    );
  });

  it("counts inline code as text and judges reference links", () => {
    expect(
      texts("[`here`](a.md) [here][r] [здесь]\n\n[r]: a.md\n[здесь]: b.md\n"),
    ).toEqual(["here", "here", "здесь"]);
  });

  it("does not report a reference whose definition is missing", () => {
    expect(texts("[here][missing]\n")).toEqual([]);
  });

  it("decides by text alone, so a target named like a phrase changes nothing", () => {
    expect(texts("[here](here) [guide](here)\n")).toEqual(["here"]);
  });

  it("skips empty and punctuation-only text", () => {
    expect(texts("[](a.md) [→](a.md)\n")).toEqual([]);
  });

  it("reports links in headings, table cells and list items", () => {
    expect(
      findings(
        "# See [here](a.md)\n\n| A |\n| --- |\n| [link](b.md) |\n\n- [more](c.md)\n",
      ).map((finding) => finding.line),
    ).toEqual([1, 5, 7]);
  });

  it("matches only the phrases it is given", () => {
    expect(findings("[here](a.md) [docs](b.md)\n", new Set(["docs"]))).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ text: "docs" }),
      }),
    ]);
  });
});

describe("CTX-004 normalisation", () => {
  it("normalises configured phrases the same way as link text", () => {
    expect(normalizeLinkText("  Click\tHERE! ")).toBe("click here");
    expect(normalizeLinkText("«ПОДРОБНЕЕ»")).toBe("подробнее");
    expect(normalizeLinkText("...")).toBe("");
  });

  it("composes decomposed letters, so a combining-mark spelling matches the phrase", () => {
    // `й` written as `и` + U+0306 COMBINING BREVE, against the precomposed U+0439 in the phrase.
    expect(normalizeLinkText("мой")).toBe("мой");
    const phrases = new Set([normalizeLinkText("мой")]);
    expect(
      findings("[мой](a.md)\n", phrases).map((finding) => finding.data?.phrase),
    ).toEqual(["мой"]);
  });
});

describe("CTX-004 determinism", () => {
  it("returns identical findings across repeated calls and between documents", () => {
    const first = parseDocument({ path: "a.md", content: "[here](x.md)\n" });
    const second = parseDocument({
      path: "b.md",
      content: "[guide](y.md) [здесь](z.md)\n",
    });
    const options = { phrases: DEFAULT_PHRASES };

    const firstRun = linkTextFindings(first, options);
    const secondRun = linkTextFindings(second, options);
    expect(linkTextFindings(first, options)).toEqual(firstRun);
    expect(linkTextFindings(second, options)).toEqual(secondRun);
    expect(secondRun.map((finding) => finding.data?.text)).toEqual(["здесь"]);
  });
});
