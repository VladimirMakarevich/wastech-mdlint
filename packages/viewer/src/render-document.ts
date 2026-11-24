import type { Element, ElementContent, Root as HastRoot } from "hast";
import { raw } from "hast-util-raw";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";
import type {
  Definition,
  Heading,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Parent,
} from "mdast";
import { toHast } from "mdast-util-to-hast";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";

import {
  type HeadChanges,
  normalizeText,
  parseDocumentWithTree,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import {
  type BlockChange,
  type MarkedSide,
  markChanges,
} from "./change-marks.js";
import { isExternalTarget, type ResolvedTarget } from "./corpus.js";
import { highlight, languageForFence, withCopyButton } from "./highlight.js";
import { encodeRepoPath } from "./request-path.js";

export type RenderedDocument = {
  // Sanitized article markup, ready to place inside the page.
  html: string;
  title: string;
  // Set when rendered with its changes and the front matter is among them. The page draws front
  // matter as a card of its own, outside the article markup, so the mark travels beside it.
  frontmatterChange?: BlockChange;
};

/** What the branch did to a document, for marking it on its rendered page. */
export type DocumentChange = {
  changes: HeadChanges;
  // The document as the base holds it, at its path there: the source of the blocks the branch
  // removed, which the page shows folded where they stood.
  basePath: string;
  baseText: string;
};

export type TargetResolver = (
  fromPath: string,
  target: string,
  isImage: boolean,
) => ResolvedTarget;

export type TargetResolvers = {
  // A target the Markdown writes, as a link, an image or a reference definition.
  resolve: TargetResolver;
  // A target in the document's raw HTML. Asynchronous because whether a file there may be served is
  // found on disk, which the Markdown targets had done for them when the corpus loaded.
  resolveEmbedded: (
    target: string,
    isImage: boolean,
  ) => Promise<ResolvedTarget>;
};

// GitHub's own allowlist, with two changes, both about DOM clobbering: an element whose `id` or
// `name` makes it a property of `window` or `document`, shadowing what a script reads there.
//
// `clobberPrefix` is emptied because the prefix would rename every heading and HTML anchor
// (`id="setup"` → `id="user-content-setup"`), and then the anchors REF-002 validates — heading slugs
// and `<a id>`/`<a name>` targets alike — would not exist on the page. An `id` only shadows a global
// read through `window.<name>`, which the viewer's scripts never do.
//
// `name` is therefore allowed on `<a>` alone, where it is an anchor and makes nothing a property of
// `document`. On an `<img>`, the one other tag GitHub's list lets an author write that `document`
// exposes by name, it would override the document's own members: `<img name="querySelector">` turns
// `document.querySelector` into that image, and every script on the page fails at its first call.
const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  clobberPrefix: "",
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter(
      (attribute) => attribute !== "name",
    ),
    a: [...(defaultSchema.attributes?.a ?? []), "name"],
  },
};

// Set on every link and image the Markdown writes, whose target is rewritten on the Markdown tree, so
// that after `raw` an `<a>` or `<img>` without it is one the author wrote as raw HTML. The sanitizer
// strips it like any `data-*` attribute it does not list, so it never reaches the page; an author who
// writes it on raw HTML only stops their own link from being rewritten.
const FROM_MARKDOWN = "dataViewerFromMarkdown";

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
 *
 * With `change`, the blocks the branch changed are marked and the ones it removed are put back,
 * folded, where they stood. The base side goes through the same pipeline, so a removed block is
 * sanitized like any other, and its links resolve against the current corpus: a link that only
 * worked at the base shows as missing, which is what a reviewer needs to learn about it.
 */
/**
 * What the right margin says about the source lines from `start` to `end`, beside the number of the
 * first: a short `text` and a longer `title` a pointer shows. `undefined` adds nothing.
 */
export type LineAnnotator = (
  start: number,
  end: number,
) => { text: string; title: string } | undefined;

export async function renderDocument(
  document: ParsedDocument,
  resolvers: TargetResolvers,
  change?: DocumentChange,
  annotate?: LineAnnotator,
): Promise<RenderedDocument> {
  const head = await renderTree(document, resolvers);
  let frontmatterChange: BlockChange | undefined;
  if (change !== undefined) {
    const base = await renderTree(
      { path: change.basePath, content: change.baseText },
      resolvers,
    );
    for (const href of base.missingHrefs) {
      head.missingHrefs.add(href);
    }
    frontmatterChange = markChanges(head, base, change.changes);
  }
  // After the removed blocks are in, so their code is highlighted and their links marked too.
  await replaceCodeBlocks(head.tree);
  markLinks(head.tree, head.missingHrefs);
  if (annotate !== undefined) {
    // Every element that carries its source lines — the same ones the margin numbers — and none of
    // the removed blocks put back, which carry none.
    visit(head.tree, "element", (node: Element) => {
      const { dataLine, dataLineEnd } = node.properties;
      if (dataLine === undefined || dataLineEnd === undefined) {
        return;
      }
      const note = annotate(Number(dataLine), Number(dataLineEnd));
      if (note !== undefined) {
        node.properties.dataBlame = note.text;
        node.properties.title = note.title;
      }
    });
  }

  return {
    html: toHtml(head.tree),
    title: documentTitle(head.parsed),
    ...(frontmatterChange === undefined ? {} : { frontmatterChange }),
  };
}

type RenderedTree = MarkedSide & {
  parsed: ParsedDocument;
  missingHrefs: Set<string>;
};

/**
 * One side's sanitized tree, every block numbered with its source lines, before the viewer's own
 * code-block markup goes in: everything about the author's content that does not depend on what
 * else is shown beside it.
 */
async function renderTree(
  document: { path: string; content: string },
  resolvers: TargetResolvers,
): Promise<RenderedTree> {
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

  // A reference (`[text][id]`, `![alt][id]`) becomes the link or image it stands for, with its
  // definition's target. A definition is shared by every reference to it and does not say whether
  // those are links or images, while a target resolves differently for each: an image never goes
  // through the site router, which maps URLs to Markdown sources only. Core reads a reference's
  // target from the same definition, the first one with its label, so the page and the linter still
  // agree on it.
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node: Definition) => {
    if (!definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
  });
  visit(tree, (node, index, parent: Parent | undefined) => {
    if (
      (node.type !== "linkReference" && node.type !== "imageReference") ||
      parent === undefined ||
      index === undefined
    ) {
      return;
    }
    const reference = node as LinkReference | ImageReference;
    const definition = definitions.get(reference.identifier);
    if (definition === undefined) {
      return;
    }
    const common = {
      url: definition.url,
      title: definition.title,
      position: reference.position,
      data: reference.data,
    };
    parent.children[index] =
      reference.type === "linkReference"
        ? ({ type: "link", children: reference.children, ...common } as Link)
        : ({ type: "image", alt: reference.alt, ...common } as Image);
  });

  // Targets are rewritten on the Markdown tree, where `url` is still the target exactly as the
  // linter saw it, and before `toHast` percent-encodes it.
  const missingHrefs = new Set<string>();
  visit(tree, (node) => {
    if (node.type !== "link" && node.type !== "image") {
      return;
    }
    const target = node as Link | Image;
    target.data = {
      ...target.data,
      hProperties: { ...target.data?.hProperties, [FROM_MARKDOWN]: "" },
    };
    if (!isLocalTarget(target.url)) {
      return;
    }
    const rewritten = rewriteTarget(
      target.url,
      resolvers.resolve(document.path, target.url, node.type === "image"),
    );
    if (rewritten !== undefined) {
      target.url = rewritten.url;
      if (rewritten.missing) {
        // Recorded in the form `toHast` will write into `href`, so the lookup after sanitizing
        // matches a target with spaces or non-ASCII characters too.
        missingHrefs.add(normalizeUri(rewritten.url));
      }
    }
  });

  const hast = toHast(tree, {
    allowDangerousHtml: true,
    // Front matter is shown as its own card from `ParsedDocument.frontmatter`; left to the default
    // handler, the YAML block would render as a paragraph of raw text at the top of the article.
    handlers: { yaml: () => undefined },
  }) as HastRoot;
  // The file lets `raw` keep each node's place in the source as it reparses the tree; without it
  // every position is dropped, and with them the line numbers the page shows beside each block.
  const reparsed = raw(hast, {
    file: new VFile({ value: document.content }),
  }) as HastRoot;
  await rewriteEmbeddedTargets(reparsed, resolvers, missingHrefs);
  const clean = sanitize(reparsed, SANITIZE_SCHEMA) as HastRoot;
  markSourceLines(clean);

  // Numbered as the diff numbers them: the parser counts a lone `\r` as a line ending and a byte
  // order mark as no line at all, and so does `normalizeText`.
  const lines = normalizeText(document.content).split("\n");
  const yaml = tree.children[0]?.type === "yaml" ? tree.children[0] : undefined;
  return {
    tree: clean,
    parsed,
    missingHrefs,
    blank: (line) => (lines[line - 1] ?? "").trim() === "",
    ...(yaml?.position === undefined || parsed.frontmatter === null
      ? {}
      : {
          frontmatter: {
            start: yaml.position.start.line,
            end: yaml.position.end.line,
            raw: parsed.frontmatter.raw,
          },
        }),
  };
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

// A bare fragment stays on this page, where its slug already matches a heading id, and an external
// URL leaves the repository; only the rest name something the corpus can resolve.
function isLocalTarget(url: string): boolean {
  return url.length > 0 && !url.startsWith("#") && !isExternalTarget(url);
}

/**
 * Point the `<a href>` and `<img src>` an author wrote as raw HTML where the same target written as
 * Markdown would point: a document's page or the file route, resolved from the document's own
 * folder. Left alone, a relative target resolves against the page's address under `/doc/`, where no
 * image or source file is ever served. Done before sanitizing, so the sanitizer still judges every
 * URL the page ends up with.
 */
async function rewriteEmbeddedTargets(
  tree: HastRoot,
  resolvers: TargetResolvers,
  missingHrefs: Set<string>,
): Promise<void> {
  const targets: { node: Element; property: "href" | "src" }[] = [];
  visit(tree, "element", (node: Element) => {
    const property =
      node.tagName === "a"
        ? "href"
        : node.tagName === "img"
          ? "src"
          : undefined;
    const url = property === undefined ? undefined : node.properties[property];
    if (
      property !== undefined &&
      node.properties[FROM_MARKDOWN] === undefined &&
      typeof url === "string" &&
      isLocalTarget(url)
    ) {
      targets.push({ node, property });
    }
  });
  for (const { node, property } of targets) {
    const url = node.properties[property] as string;
    const rewritten = rewriteTarget(
      url,
      await resolvers.resolveEmbedded(url, property === "src"),
    );
    if (rewritten !== undefined) {
      node.properties[property] = rewritten.url;
      if (rewritten.missing && property === "href") {
        missingHrefs.add(rewritten.url);
      }
    }
  }
}

function rewriteTarget(
  url: string,
  resolved: ResolvedTarget,
): { url: string; missing: boolean } | undefined {
  const hashIndex = url.indexOf("#");
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  switch (resolved.kind) {
    case "document":
      return {
        url: `${documentHref(resolved.path)}${fragment}`,
        missing: false,
      };
    case "file":
      return { url: `${fileHref(resolved.path)}${fragment}`, missing: false };
    case "missing":
      return { url, missing: true };
  }
}

// Blocks that scroll sideways. A number set beside one would be cut off by its own overflow, so it
// goes on a wrapper around the block instead.
const SCROLLING_BLOCKS = new Set(["table", "pre"]);

/**
 * Give each block and each list item the line it starts on in the Markdown file, as `data-line`,
 * for the page to show beside it — so a reader can go from the page to the file, and from a
 * finding's "line 42" to the block it is about — and the line it ends on, as `data-line-end`, so a
 * block's whole range is known without guessing it from where the next block starts.
 *
 * Done on the sanitized tree: the attributes are the viewer's own, and the sanitizer has already
 * stripped any `data-*` an author wrote, so no document can label a block with a line it is not on.
 * A list gets no number of its own, since its first item carries the same line.
 */
function markSourceLines(tree: HastRoot): void {
  tree.children = tree.children.map((node) => {
    if (
      node.type !== "element" ||
      node.position === undefined ||
      node.tagName === "ul" ||
      node.tagName === "ol"
    ) {
      return node;
    }
    const line = node.position.start.line;
    const lineEnd = node.position.end.line;
    if (SCROLLING_BLOCKS.has(node.tagName)) {
      return h("div.source-line", { dataLine: line, dataLineEnd: lineEnd }, [
        node,
      ]);
    }
    node.properties.dataLine = line;
    node.properties.dataLineEnd = lineEnd;
    return node;
  });
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "li" && node.position !== undefined) {
      node.properties.dataLine = node.position.start.line;
      node.properties.dataLineEnd = node.position.end.line;
    }
  });
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
      replacement = withCopyButton(
        await highlight(block.code, languageForFence(block.info)),
      );
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
      // Missing, or a file the viewer does not serve: Markdown outside the corpus, or a path an
      // `exclude` pattern or a `.gitignore` covers.
      node.properties.title =
        "The viewer has no page for this target: it does not exist, or is outside what the viewer serves";
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
