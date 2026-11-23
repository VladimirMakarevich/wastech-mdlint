import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDocument } from "@wastech-mdlint/core";

import { Corpus } from "../src/corpus.js";
import {
  renderDocument,
  type RenderedDocument,
} from "../src/render-document.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

let corpus: Corpus;
let guide: RenderedDocument;
let home: RenderedDocument;
let charts: RenderedDocument;

function render(relPath: string): Promise<RenderedDocument> {
  const document = corpus.documents.get(relPath);
  if (document === undefined) {
    throw new Error(`fixture has no ${relPath}`);
  }
  return renderDocument(document, {
    resolve: (fromPath, target, isImage) =>
      corpus.resolve(fromPath, target, isImage),
    resolveEmbedded: (target, isImage) =>
      corpus.resolveEmbedded(document, target, isImage),
  });
}

beforeAll(async () => {
  corpus = await Corpus.load({ cwd: fixtureRoot });
  guide = await render("docs/guide.md");
  home = await render("README.md");
  charts = await render("docs/charts.md");
}, 30_000);

describe("anchors", () => {
  // The point of rendering from core's parse: an anchor REF-002 accepts is an id on the page. The
  // expected ids are read from core's own headings, not restated, so this compares the two sides.
  it("gives every heading core's slug, duplicates and non-ASCII text included", () => {
    const headings = corpus.documents.get("docs/guide.md")!.headings;
    expect(headings.map((heading) => heading.slug)).toEqual([
      "guide",
      "setup",
      "setup-1",
      "заголовок-по-русски",
    ]);
    for (const heading of headings) {
      expect(guide.html).toContain(`id="${heading.slug}"`);
    }
  });

  it("keeps an HTML anchor's id unprefixed", () => {
    expect(guide.html).toContain('id="custom-anchor"');
  });

  it("takes the title from the first top-level heading", () => {
    expect(guide.title).toBe("Guide");
  });
});

describe("sanitizing author content", () => {
  it("drops scripts, event handlers and javascript: links", () => {
    expect(guide.html).not.toContain("<script");
    expect(guide.html).not.toContain("window.injected");
    expect(guide.html).not.toContain("onerror");
    expect(guide.html).not.toContain("javascript:");
  });

  it("keeps collapsible sections", () => {
    expect(guide.html).toMatch(
      /<details data-line="26">\s*<summary>More<\/summary>/,
    );
    expect(guide.html).toContain("Hidden text.");
  });

  it("renders task list items as disabled checkboxes", () => {
    expect(guide.html).toMatch(/<input type="checkbox" checked disabled>/);
    expect(guide.html).toMatch(/<input type="checkbox" disabled>/);
  });

  it("does not print front matter into the article", () => {
    expect(guide.html).not.toContain("tags:");
  });
});

describe("links", () => {
  it("points a document link at its page, keeping the fragment", () => {
    expect(home.html).toContain('href="/doc/docs/guide.md#setup"');
  });

  it("opens a folder link on the folder's README", () => {
    expect(home.html).toContain('href="/doc/docs/README.md"');
  });

  it("points a link to a source file at the source view, keeping the line fragment", () => {
    expect(home.html).toContain('href="/file/src/app.ts#L2"');
  });

  it("points an embedded image at the file route", () => {
    expect(guide.html).toContain('src="/file/images/pic.svg"');
  });

  it("marks a link whose target does not exist", () => {
    expect(home.html).toMatch(/<a href="docs\/nope\.md" class="link-missing"/);
  });

  it("opens an external link in a new tab without an opener", () => {
    expect(home.html).toMatch(
      /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer" class="link-external">/,
    );
  });
});

describe("code blocks", () => {
  // Every highlighted block carries the button that copies it, beside the block rather than inside
  // it, so it stays in the corner while the code scrolls sideways — in a list item as well as at the
  // top level. Diagrams and charts are drawings, not code to paste, and get none.
  it("gives every highlighted block a copy button, and diagrams none", async () => {
    const nested = await renderText(
      "# Steps\n\n1. Run it:\n\n   ```sh\n   npm test\n   ```\n",
    );
    expect(nested.html).toMatch(
      /<li data-line="3">[\s\S]*<div class="code-block"><button class="code-copy" type="button" hidden title="Copy the code" aria-label="Copy the code">Copy<\/button><pre class="shiki/,
    );
    expect(guide.html).not.toMatch(
      /<div class="mermaid-diagram"><div class="code-block">/,
    );
    expect(guide.html).not.toMatch(
      /<div class="code-block"><button class="code-copy"[^>]*>Copy<\/button><pre class="mermaid-source/,
    );
  });

  it("highlights a known language on the server", () => {
    expect(guide.html).toContain(
      'class="shiki shiki-themes github-light github-dark"',
    );
    expect(guide.html).toContain("answer");
  });

  // The JSON's title tries to close the <pre> and open a script; as text inside the block it must
  // stay text.
  it("leaves a valid chart block as escaped source for the browser to draw", () => {
    expect(charts.html).toContain(
      '<div class="echarts-chart"><pre class="echarts-source">{\n  "title": { "text": "&#x3C;/pre>&#x3C;script>window.injected = true;&#x3C;/script>" },',
    );
    expect(charts.html).not.toContain("<script");
  });

  it("shows why a chart block that is not JSON cannot be drawn, beside its source", () => {
    expect(charts.html).toMatch(
      /<div class="echarts-chart" data-state="invalid"><p class="echarts-error">Chart could not be drawn: the option is not valid JSON: [^<]+<\/p><pre class="echarts-source">\{ title: "not JSON" \}\n<\/pre><\/div>/,
    );
  });

  it("refuses chart JSON that is not an option object", () => {
    expect(charts.html).toContain(
      '<div class="echarts-chart" data-state="invalid"><p class="echarts-error">Chart could not be drawn: the option must be a JSON object</p><pre class="echarts-source">[1, 2, 3]\n</pre></div>',
    );
  });

  it("leaves a Mermaid block as escaped source for the browser to draw", () => {
    expect(guide.html).toMatch(
      /<div class="mermaid-diagram"><pre class="mermaid-source">graph TD\n {2}A\["&#x3C;b>start&#x3C;\/b>"\] --> B\n<\/pre><\/div>/,
    );
  });
});

// A document rendered on its own, for cases the fixture corpus does not hold. Nothing in it links
// anywhere, so every target resolves to nothing.
function renderText(content: string): Promise<RenderedDocument> {
  return renderDocument(parseDocument({ path: "doc.md", content }), {
    resolve: () => ({ kind: "missing" }),
    resolveEmbedded: () => Promise.resolve({ kind: "missing" }),
  });
}

describe("source lines", () => {
  // Counted from the top of the file, front matter included, since that is the line an editor and
  // a finding name.
  it("labels each block with the line it starts on in the file", () => {
    expect(guide.html).toContain('<h1 id="guide" data-line="6">Guide</h1>');
    expect(guide.html).toContain('<h2 id="setup" data-line="8">Setup</h2>');
    expect(guide.html).toContain('<p data-line="10">First setup section.</p>');
  });

  // The list's first item carries the list's line, so the list itself carries none.
  it("labels each list item, and not the list", () => {
    expect(guide.html).toContain('<ul class="contains-task-list">');
    expect(guide.html).toMatch(
      /<li class="task-list-item" data-line="43"><input type="checkbox" checked disabled> done item<\/li>/,
    );
    expect(guide.html).toMatch(/<li class="task-list-item" data-line="44">/);
  });

  // A table or a code block scrolls sideways and would clip a number set beside it, so the number
  // goes on a wrapper, and the code is still replaced inside it.
  it("labels a code block, a diagram and a table through a wrapper", async () => {
    expect(guide.html).toContain(
      '<div class="source-line" data-line="34"><div class="mermaid-diagram">',
    );
    expect(guide.html).toMatch(
      /<div class="source-line" data-line="39"><div class="code-block"><button class="code-copy"[^>]*>Copy<\/button><pre class="shiki/,
    );
    const table = await renderText("# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(table.html).toContain(
      '<div class="source-line" data-line="3"><table>',
    );
  });

  it("counts CRLF lines as lines", async () => {
    const { html } = await renderText("# T\r\n\r\nOne\r\n\r\nTwo\r\n");
    expect(html).toContain('<p data-line="3">One</p>');
    expect(html).toContain('<p data-line="5">Two</p>');
  });

  // The attribute is added after sanitizing, so an author cannot set it to claim another line.
  it("ignores a line an author writes into raw HTML", async () => {
    const { html } = await renderText('# T\n\n<p data-line="999">x</p>\n');
    expect(html).not.toContain("999");
    expect(html).toContain('<p data-line="3">x</p>');
  });
});

describe("raw HTML targets", () => {
  // A repository of its own, so the fixture's line numbers above stay as they are.
  let dir: string;
  let raw: Corpus;
  let page: RenderedDocument;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-render-"));
    const files: Record<string, string> = {
      "images/logo.png": "png",
      "src/app.ts": "export {};\n",
      "docs/other.md": "# Other\n",
      "docs/page.md": [
        "# Page",
        "",
        '<p align="center"><img src="../images/logo.png" alt="Logo"></p>',
        "",
        '<a href="../src/app.ts#L2">source</a> <a href="other.md">other</a> <a href="gone.md">gone</a>',
        "",
        "[markdown link](other.md)",
        "",
      ].join("\n"),
    };
    for (const [relPath, content] of Object.entries(files)) {
      const absolutePath = path.join(dir, ...relPath.split("/"));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
    }
    raw = await Corpus.load({ cwd: dir });
    const document = raw.documents.get("docs/page.md")!;
    page = await renderDocument(document, {
      resolve: (fromPath, target, isImage) =>
        raw.resolve(fromPath, target, isImage),
      resolveEmbedded: (target, isImage) =>
        raw.resolveEmbedded(document, target, isImage),
    });
  }, 30_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Left relative, an image resolves against the page's address under /doc/, where no image is served.
  it("points a raw <img> at the file route, and lets that route serve it", () => {
    expect(page.html).toContain('src="/file/images/logo.png"');
    expect(raw.isLinkedFile("images/logo.png")).toBe(true);
  });

  it("points raw links where the same Markdown links would point", () => {
    expect(page.html).toContain('href="/file/src/app.ts#L2"');
    expect(page.html).toContain('<a href="/doc/docs/other.md">other</a>');
    expect(page.html).toMatch(/<a href="gone\.md" class="link-missing"/);
  });

  // The marker that tells Markdown links from raw ones is the viewer's own and never reaches the page.
  it("rewrites a Markdown link once and leaves no marker on the page", () => {
    expect(page.html).toContain(
      '<a href="/doc/docs/other.md">markdown link</a>',
    );
    expect(page.html).not.toContain("data-viewer-from-markdown");
  });
});

describe("references", () => {
  // A definition does not say whether its references are links or images, and an image must not go
  // through the site router; each reference is resolved as what it is.
  it("resolves an image reference as an image and a link reference as a link", async () => {
    const calls: [string, boolean][] = [];
    await renderDocument(
      parseDocument({
        path: "doc.md",
        content: "# T\n\n![logo][l] and [text][l]\n\n[l]: /assets/logo.png\n",
      }),
      {
        resolve: (_fromPath, target, isImage) => {
          calls.push([target, isImage]);
          return { kind: "missing" };
        },
        resolveEmbedded: () => Promise.resolve({ kind: "missing" }),
      },
    );
    expect(calls).toEqual([
      ["/assets/logo.png", true],
      ["/assets/logo.png", false],
    ]);
  });
});

describe("DOM clobbering", () => {
  // A named <img> would become a property of `document`, overriding its own members:
  // `document.querySelector` would be the image, and every script on the page would fail.
  it("drops name from an image and keeps it on an anchor", async () => {
    const { html } = await renderText(
      '# T\n\n<img name="querySelector" src="x.png" alt="x">\n\n<a name="here"></a>\n',
    );
    expect(html).not.toContain('name="querySelector"');
    expect(html).toContain('<a name="here"></a>');
  });
});
