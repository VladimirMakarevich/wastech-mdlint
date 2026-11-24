import { diffText } from "@wastech-mdlint/core";
import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";

import { renderDiff } from "../src/change-diff.js";

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `Line ${String(index + 1)}`);

describe("renderDiff", () => {
  it("puts the unchanged lines between hunks in the table, hidden behind a button the script shows", () => {
    const base = `${numbered(40).join("\n")}\n`;
    const headLines = numbered(40);
    headLines[19] = "Line 20, edited";
    const head = `${headLines.join("\n")}\n`;
    const html = toHtml(renderDiff(diffText(base, head), head));

    // Above the hunk, 16 lines opened from the bottom; below it, 17 opened from the top.
    expect(html).toContain(
      '<tbody class="diff-gap" data-from="end" data-step="20"><tr class="diff-expand" hidden><td colspan="4"><button class="diff-expand-button" type="button">Show 16 unchanged lines</button></td></tr>',
    );
    expect(html).toContain(
      '<tbody class="diff-gap" data-from="start" data-step="20"><tr class="diff-expand" hidden><td colspan="4"><button class="diff-expand-button" type="button">Show 17 unchanged lines</button>',
    );
    expect(html).toContain(
      '<tr class="diff-line diff-context" hidden><td class="diff-number">16</td><td class="diff-number">16</td><td class="diff-marker"></td><td class="diff-code">Line 16</td></tr>',
    );
    expect(
      html.match(/<tr class="diff-line diff-context" hidden>/g),
    ).toHaveLength(33);
  });

  it("draws the diff as before without the text it ends in", () => {
    const html = toHtml(renderDiff(diffText("a\nb\n", "a\nc\n")));
    expect(html).not.toContain("diff-gap");
    expect(html.match(/<tbody>/g)).toHaveLength(1);
  });

  it("says where a moved line went and where it came from", () => {
    const base = "Paragraph that moves away from here.\n\nStays.\n";
    const head = "Stays.\n\nParagraph that moves away from here.\n";
    const html = toHtml(renderDiff(diffText(base, head), head));
    expect(html).toContain(
      '<tr class="diff-line diff-removed diff-moved"><td class="diff-number">1</td><td class="diff-number"></td><td class="diff-marker">−</td><td class="diff-code">Paragraph that moves away from here.<span class="diff-move">moved to line 3</span></td></tr>',
    );
    expect(html).toContain('<span class="diff-move">moved from line 1</span>');
  });
});
