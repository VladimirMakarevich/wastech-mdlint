import type { Element, ElementContent, Root as HastRoot } from "hast";
import { raw } from "hast-util-raw";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";
import type { Definition, Heading, Image, Link } from "mdast";
import { toHast } from "mdast-util-to-hast";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { visit } from "unist-util-visit";

import {
  parseDocumentWithTree,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import { isExternalTarget, type ResolvedTarget } from "./corpus.js";
import { highlight, languageForFence } from "./highlight.js";
import { encodeRepoPath } from "./request-path.js";

export type RenderedDocument = {
  // Sanitized article markup, ready to place inside the page.
  html: string;
  title: string;
};

export type TargetResolver = (
  fromPath: string,
  target: string,
  isImage: boolean,
) => ResolvedTarget;

// GitHub's own allowlist, with one change. `clobberPrefix` is emptied because the prefix would
// rename every heading and HTML anchor (`id="setup"` → `id="user-content-setup"`), and then the
// anchors REF-002 validates — heading slugs and `<a id>`/`<a name>` targets alike — would not
// exist on the page. The prefix guards against DOM clobbering, where an element id shadows a global
// a script reads through `window.<name>`; the viewer's script reads nothing that way, so the
// protection buys nothing here and costs every anchor.
const SANITIZE_SCHEMA: Schema = { ...defaultSchema, clobberPrefix: "" };

/** The URL of a document page. */
export function documentHref(relPath: string): string {
  return `/doc/${encodeRepoPath(relPath)}`;
}

/** The URL of a non-Markdown repository file a document links to. */
export function fileHref(relPath: string): string {
  return `/file/${encodeRepoPath(relPath)}`;
}

/**
 * Render one corpus document to sanitized HTML.
 *
 * The tree comes from core's `parseDocumentWithTree`, the same parse that produced the facts the
 * linter checks, so heading ids are core's slugs taken verbatim rather than recomputed: an anchor
 * REF-002 accepts is an anchor that exists on this page.
 *
 * Order matters. Author content — Markdown and the raw HTML inside it — is sanitized first, as one
 * tree. Only then are code blocks replaced with Shiki's output and the Mermaid and chart
 * placeholders, because that markup is the viewer's own: Shiki colors tokens with `style` attributes
 * the sanitizer would (rightly) strip from an author, and it escapes the code text itself.
 */
export async function renderDocument(
  document: ParsedDocument,
  resolveTarget: TargetResolver,
): Promise<RenderedDocument> {
  const { document: parsed, tree } = parseDocumentWithTree({
    path: document.path,
    content: document.content,
  });

  // A pre-order walk meets headings in the order core recorded them, so the index pairs each node
  // with its slug.
  let headingIndex = 0;
  visit(tree, "heading", (node: Heading) => {
    const slug = parsed.headings[headingIndex]?.slug;
    headingIndex += 1;
    if (slug !== undefined) {
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, id: slug },
      };
    }
  });

  // Targets are rewritten on the Markdown tree, where `url` is still the target exactly as the
  // linter saw it, and before `toHast` percent-encodes it.
  const missingHrefs = new Set<string>();
  visit(tree, (node) => {
    if (
      node.type === "link" ||
      node.type === "definition" ||
      node.type === "image"
    ) {
      const target = node as Link | Definition | Image;
      const rewritten = rewriteTarget(
        document.path,
        target.url,
        node.type === "image",
        resolveTarget,
      );
      if (rewritten !== undefined) {
        target.url = rewritten.url;
        if (rewritten.missing) {
          // Recorded in the form `toHast` will write into `href`, so the lookup after sanitizing
          // matches a target with spaces or non-ASCII characters too.
          missingHrefs.add(normalizeUri(rewritten.url));
        }
      }
    }
  });

  const hast = toHast(tree, {
    allowDangerousHtml: true,
    // Front matter is shown as its own card from `ParsedDocument.frontmatter`; left to the default
    // handler, the YAML block would render as a paragraph of raw text at the top of the article.
    handlers: { yaml: () => undefined },
  }) as HastRoot;
  const clean = sanitize(raw(hast), SANITIZE_SCHEMA) as HastRoot;

  await replaceCodeBlocks(clean);
  markLinks(clean, missingHrefs);

  return { html: toHtml(clean), title: documentTitle(parsed) };
}

/**
 * The last heading at or above a 1-based source line, or `undefined` above the first heading.
 *
 * Search hits and lint findings carry a source line, while the rendered page only has anchors at
 * headings, so this is the closest place on the page to send a reader for that line.
 */
export function headingAbove(
  document: ParsedDocument,
  line: number,
): ParsedDocument["headings"][number] | undefined {
  let found: ParsedDocument["headings"][number] | undefined;
  for (const heading of document.headings) {
    if (heading.line > line) {
      break;
    }
    found = heading;
  }
  return found;
}

/** A document's first top-level heading, or its file name when it has none. */
export function documentTitle(document: ParsedDocument): string {
  return (
    document.headings.find((heading) => heading.depth === 1)?.text ??
    document.path.split("/").pop() ??
    document.path
  );
}

function rewriteTarget(
  fromPath: string,
  url: string,
  isImage: boolean,
  resolveTarget: TargetResolver,
): { url: string; missing: boolean } | undefined {
  // A bare fragment stays on this page, and its slug already matches a heading id.
  if (url.length === 0 || url.startsWith("#")) {
    return undefined;
  }
  const hashIndex = url.indexOf("#");
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  const resolved = resolveTarget(fromPath, url, isImage);
  switch (resolved.kind) {
    case "document":
      return {
        url: `${documentHref(resolved.path)}${fragment}`,
        missing: false,
      };
    case "file":
      return { url: `${fileHref(resolved.path)}${fragment}`, missing: false };
    case "missing":
      // External targets resolve to nothing too; only a local target that names no file is broken.
      return isExternalTarget(url) ? undefined : { url, missing: true };
  }
}

async function replaceCodeBlocks(tree: HastRoot): Promise<void> {
  const blocks: {
    parent: HastRoot | Element;
    index: number;
    code: string;
    info?: string;
  }[] = [];
  visit(tree, "element", (node: Element, index, parent) => {
    if (node.tagName !== "pre" || parent === undefined || index === undefined) {
      return;
    }
    const code = node.children.find(
      (child): child is Element =>
        child.type === "element" && child.tagName === "code",
    );
    if (code === undefined) {
      return;
    }
    const className = code.properties.className;
    const languageClass = Array.isArray(className)
      ? className.map(String).find((name) => name.startsWith("language-"))
      : undefined;
    blocks.push({
      parent: parent as HastRoot | Element,
      index,
      code: textContent(code),
      info: languageClass?.slice("language-".length),
    });
  });

  for (const block of blocks) {
    let replacement: ElementContent;
    const language = block.info?.toLowerCase();
    if (language === "echarts") {
      replacement = chartBlock(block.code);
    } else if (language === "mermaid") {
      // The diagram is drawn in the browser; the source stays readable as the fallback when the
      // script is blocked or the diagram fails to parse.
      replacement = {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid-diagram"] },
        children: [
          {
            type: "element",
            tagName: "pre",
            properties: { className: ["mermaid-source"] },
            children: [{ type: "text", value: block.code }],
          },
        ],
      };
    } else {
      replacement = await highlight(block.code, languageForFence(block.info));
    }
    block.parent.children[block.index] = replacement;
  }
}

/**
 * An `echarts` block: a chart option written as JSON, drawn in the browser like a Mermaid diagram.
 *
 * JSON and nothing else — not a JavaScript object literal, never a function — because the option is
 * author content and the page must not evaluate it. The block is checked here rather than only in
 * the browser so that a block which can never become a chart shows its reason beside the source
 * without script, and the browser skips it.
 */
function chartBlock(code: string): Element {
  const problem = chartOptionProblem(code);
  return h(
    "div.echarts-chart",
    { dataState: problem === undefined ? undefined : "invalid" },
    [
      problem === undefined
        ? undefined
        : h("p.echarts-error", `Chart could not be drawn: ${problem}`),
      h("pre.echarts-source", code),
    ],
  );
}

function chartOptionProblem(code: string): string | undefined {
  let option: unknown;
  try {
    option = JSON.parse(code);
  } catch (error) {
    return `the option is not valid JSON: ${(error as Error).message}`;
  }
  return typeof option === "object" && option !== null && !Array.isArray(option)
    ? undefined
    : "the option must be a JSON object";
}

function markLinks(tree: HastRoot, missingHrefs: ReadonlySet<string>): void {
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "a" || typeof node.properties.href !== "string") {
      return;
    }
    const href = node.properties.href;
    if (isExternalTarget(href)) {
      node.properties.target = "_blank";
      node.properties.rel = ["noopener", "noreferrer"];
      node.properties.className = [...classNames(node), "link-external"];
    } else if (missingHrefs.has(href)) {
      node.properties.className = [...classNames(node), "link-missing"];
      node.properties.title = "This target does not exist in the repository";
    }
  });
}

function classNames(node: Element): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

function textContent(node: Element): string {
  let text = "";
  visit(node, "text", (child) => {
    text += child.value;
  });
  return text;
}
