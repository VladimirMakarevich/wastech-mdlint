import type { Element } from "hast";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";
import { describe, expect, it } from "vitest";

import type { LintResult } from "@wastech-mdlint/core";

import * as client from "../src/client/tree-marks.js";
import type { Review } from "../src/changes.js";
import { Diagnostics } from "../src/diagnostics.js";
import { renderTree } from "../src/page-tree.js";
import * as server from "../src/tree-marks.js";

// The server draws the tree's marks and the Changes count into every page, and the page script draws
// them again from JSON when an event says they changed. Two builders of one markup drift apart
// unseen - each looks right on its own - and a mark the script redrew would then look unlike the one
// the server drew, which is the very change on screen these marks are drawn server-side to avoid.
// So every mark is built both ways here and the markup compared.

// A client mark as markup, through the same serializer the server uses, so only what the two builders
// decide is compared and not how each happens to order its attributes.
function clientHtml(spec: client.MarkSpec | undefined): string {
  if (spec === undefined) {
    return "";
  }
  const element = h(
    "span",
    { className: spec.className.split(" ") },
    spec.text === "" ? [] : [spec.text],
  );
  for (const [name, value] of Object.entries(spec.attributes).sort(byName)) {
    element.properties[propertyOf(name)] = value;
  }
  return toHtml(element);
}

function serverHtml(element: Element | undefined): string {
  if (element === undefined) {
    return "";
  }
  const { className, ...rest } = element.properties;
  return toHtml({
    ...element,
    properties: {
      className,
      ...Object.fromEntries(
        Object.entries(rest)
          .map(([name, value]) => [attributeOf(name), value] as const)
          .sort(byName)
          .map(([name, value]) => [propertyOf(name), value]),
      ),
    },
  });
}

// Attributes in one order on both sides, by their HTML names in code-point order.
function byName(
  [left]: readonly [string, unknown],
  [right]: readonly [string, unknown],
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// hast names `aria-label` `ariaLabel`; the client sets attributes by their HTML names.
function propertyOf(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function attributeOf(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

describe("tree marks", () => {
  it("are the same markup from the server and from the page script", () => {
    for (const counts of [
      { errors: 1, warnings: 0 },
      { errors: 0, warnings: 1 },
      { errors: 2, warnings: 3 },
    ]) {
      expect(clientHtml(client.findingsBadge(counts))).toBe(
        serverHtml(server.findingsBadge(counts)),
      );
    }
    for (const file of [
      { status: "A" as const, review: null },
      { status: "M" as const, review: null },
      { status: "D" as const, review: null },
      { status: "R" as const, oldPath: "old/name.md", review: null },
    ]) {
      expect(clientHtml(client.changeLetter(file))).toBe(
        serverHtml(server.changeLetter(file)),
      );
    }
    for (const status of ["unreviewed", "changed", "reviewed", null] as const) {
      expect(clientHtml(client.reviewDot(status)), String(status)).toBe(
        serverHtml(server.reviewDot(status)),
      );
    }
    for (const [changed, review] of [
      [0, null],
      [3, null],
      [1, null],
      [3, { left: 2, total: 3 }],
      [1, { left: 0, total: 1 }],
    ] as const) {
      expect(clientHtml(client.changesCount(changed, review))).toBe(
        serverHtml(server.changesCount({ files: new Map(), changed, review })),
      );
    }
    // Spot-checked as written, so the comparison above cannot pass on two empty strings.
    expect(serverHtml(server.findingsBadge({ errors: 1, warnings: 2 }))).toBe(
      '<span class="tree-badge tree-badge-error" title="1 error, 2 warnings">3</span>',
    );
  });

  it("are current only where the page will be told when they change", async () => {
    const review = {
      documents: [
        { path: "docs/a.md", status: "M" },
        { path: "b.md", status: "R", oldPath: "old.md" },
      ],
    } as unknown as Review;
    const pending = new Diagnostics();
    const early = await server.treeMarksOf({
      diagnostics: pending,
      review: undefined,
      reviewStore: undefined,
      watch: true,
    });
    expect(early).toEqual({
      findings: undefined,
      changes: undefined,
      current: [],
    });

    const linted = new Diagnostics();
    linted.update({
      messages: [
        {
          ruleId: "REF-001",
          severity: "error",
          message: "broken",
          filePath: "docs/a.md",
          line: 3,
        },
      ],
    } as unknown as LintResult);
    const watched = await server.treeMarksOf({
      diagnostics: linted,
      review,
      reviewStore: undefined,
      watch: true,
    });
    expect(watched.current).toEqual(["findings", "changes"]);
    expect(watched.findings).toEqual({
      "docs/a.md": { errors: 1, warnings: 0 },
    });
    expect(watched.changes).toEqual({
      files: new Map([
        ["docs/a.md", { status: "M", review: null }],
        ["b.md", { status: "R", oldPath: "old.md", review: null }],
      ]),
      changed: 2,
      review: null,
    });
    // Without a watcher nothing says when a commit moves the review, so the page asks once.
    const unwatched = await server.treeMarksOf({
      diagnostics: linted,
      review,
      reviewStore: undefined,
      watch: false,
    });
    expect(unwatched.current).toEqual(["findings"]);
    expect(unwatched.changes).toEqual(watched.changes);
  });

  it("flag each marked file and every folder above it, and put the marks in the script's order", () => {
    const marks: server.TreeMarks = {
      findings: { "docs/deep/a.md": { errors: 0, warnings: 2 } },
      changes: {
        files: new Map([
          ["docs/deep/a.md", { status: "M", review: "changed" }],
          ["docs/b.md", { status: "A", review: "reviewed" }],
        ]),
        changed: 2,
        review: { left: 1, total: 2 },
      },
      current: ["findings", "changes"],
    };
    const html = toHtml(
      renderTree(["docs/deep/a.md", "docs/b.md", "c.md"], "docs/b.md", marks),
    );
    expect(html).toContain(
      '<li data-findings="" data-changed="" data-unreviewed=""><details open data-folder="docs">',
    );
    expect(html).toContain(
      '<li data-findings="" data-changed="" data-unreviewed=""><details data-folder="docs/deep">',
    );
    expect(html).toContain(
      '<li data-findings="" data-changed="" data-unreviewed=""><a href="/doc/docs/deep/a.md" title="docs/deep/a.md"><span class="tree-name">a.md</span><span class="tree-change tree-change-M" title="Modified in this branch">M</span><span class="tree-review-dot tree-review-changed" role="img" aria-label="Changed since your review" title="Changed since your review"></span><span class="tree-badge" title="2 warnings">2</span></a></li>',
    );
    // Reviewed: changed, but nothing left to do.
    expect(html).toContain(
      '<li data-changed=""><a href="/doc/docs/b.md" title="docs/b.md" aria-current="page"><span class="tree-name">b.md</span><span class="tree-change tree-change-A" title="Added in this branch">A</span></a></li>',
    );
    expect(html).toContain(
      '<li><a href="/doc/c.md" title="c.md"><span class="tree-name">c.md</span></a></li>',
    );
  });
});
