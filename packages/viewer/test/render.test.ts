import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

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
  return renderDocument(document, (fromPath, target, isImage) =>
    corpus.resolve(fromPath, target, isImage),
  );
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
    expect(guide.html).toMatch(/<details>\s*<summary>More<\/summary>/);
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
