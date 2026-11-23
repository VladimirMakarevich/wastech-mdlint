import type { Element, ElementContent, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";

import {
  compareStrings,
  type FrontmatterValue,
  type ParsedFrontmatter,
  type ParsedHeading,
} from "@wastech-mdlint/core";

import { documentHref } from "./render-document.js";

// Every page is assembled as a hast tree and serialized once, so text from the repository — file
// names, headings, front matter values — is escaped by construction. The only markup inserted as a
// string is the article itself, which `renderDocument` has already sanitized.

export type PageParams = {
  title: string;
  // The repository directory's own name, never its absolute path, which would leak the checkout
  // location into every page.
  siteName: string;
  documentPaths: readonly string[];
  // The repo-relative path of what the page shows, for the top bar.
  displayPath?: string;
  // Set only on a document page. It opens the tree down to the document and marks it, and the
  // live-reload script reloads when this exact path changes. A linked source file is not in the
  // tree, so opening folders toward it would lead nowhere.
  documentPath?: string;
  article: ElementContent[];
  headings?: readonly ParsedHeading[];
  backlinks?: readonly string[];
  // How many documents the page's document links to or is linked from. The rail draws them as a
  // small graph, and leaves the graph out when there are none.
  neighborCount?: number;
  frontmatter?: ParsedFrontmatter | null;
  // Pre-fills the header's search box on a results page.
  query?: string;
};

export function renderPage(params: PageParams): string {
  const tree: Root = {
    type: "root",
    children: [
      { type: "doctype" },
      h("html", { lang: "en" }, [
        h("head", [
          h("meta", { charSet: "utf-8" }),
          h("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          h("meta", { name: "color-scheme", content: "light dark" }),
          params.documentPath === undefined
            ? undefined
            : h("meta", { name: "wastech-doc", content: params.documentPath }),
          h("title", `${params.title} · ${params.siteName}`),
          // Classic and blocking, ahead of the stylesheet, so a stored theme is applied before the
          // first paint; every other script is a deferred module.
          h("script", { src: "/assets/theme.js" }),
          h("link", { rel: "stylesheet", href: "/assets/viewer.css" }),
          h("script", { type: "module", src: "/assets/viewer.js" }),
        ]),
        h("body", [
          h("a.skip-link", { href: "#content" }, "Skip to content"),
          h("header.topbar", [
            h("a.site-name", { href: "/" }, params.siteName),
            params.displayPath === undefined
              ? undefined
              : h("span.current-path", params.displayPath),
            // A plain GET form, so search works as a results page even before (or without) the
            // script that turns it into a live list.
            h(
              "form.search",
              { action: "/search", method: "get", role: "search" },
              [
                h("input", {
                  type: "search",
                  name: "q",
                  value: params.query,
                  placeholder: "Search documents",
                  ariaLabel: "Search documents",
                  autoComplete: "off",
                  spellCheck: false,
                }),
                h("kbd.search-shortcut", { ariaHidden: "true" }, "Ctrl K"),
              ],
            ),
            // From a document, the graph opens with that document and its neighbors lit, which is
            // how a reader gets from a page to its place among the others.
            h(
              "a.topbar-link",
              {
                href:
                  params.documentPath === undefined
                    ? "/graph"
                    : `/graph?${new URLSearchParams({ focus: params.documentPath }).toString()}`,
              },
              "Graph",
            ),
            // Hidden until the script that makes it work has run.
            h("button.theme-toggle", { type: "button", hidden: true }, "Theme"),
          ]),
          h("div.layout", [
            h("div.sidebar-frame", [
              h(
                "nav.sidebar",
                { ariaLabel: "Documents" },
                renderTree(params.documentPaths, params.documentPath),
              ),
              // Hidden until the script that drags it has run, like the theme switch.
              h("div.sidebar-resizer", {
                role: "separator",
                ariaOrientation: "vertical",
                ariaLabel: "Resize the document tree",
                tabIndex: 0,
                hidden: true,
              }),
            ]),
            h("main.content#content", [
              h("article.markdown-body", [
                renderFrontmatter(params.frontmatter ?? null),
                ...params.article,
              ]),
            ]),
            renderRail(params),
          ]),
        ]),
      ]),
    ],
  };
  return toHtml(tree, { allowDangerousHtml: true });
}

/** Article content for an already-sanitized HTML string. */
export function rawHtml(html: string): ElementContent[] {
  return [{ type: "raw", value: html }];
}

type DirectoryNode = {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  files: string[];
};

function renderTree(
  paths: readonly string[],
  currentPath: string | undefined,
): Element {
  const root: DirectoryNode = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
  };
  for (const relPath of paths) {
    const segments = relPath.split("/");
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const childPath =
        directory.path === "" ? segment : `${directory.path}/${segment}`;
      let child = directory.directories.get(segment);
      if (child === undefined) {
        child = {
          name: segment,
          path: childPath,
          directories: new Map(),
          files: [],
        };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.push(relPath);
  }
  return renderDirectory(root, currentPath);
}

// Folders before files, each in code-point order, the way an editor's file tree reads. Only the
// folders on the way to the current document start open: a few hundred documents fully expanded
// bury the one being read.
function renderDirectory(
  directory: DirectoryNode,
  currentPath: string | undefined,
): Element {
  const directories = [...directory.directories.values()].sort((a, b) =>
    compareStrings(a.name, b.name),
  );
  const files = [...directory.files].sort(compareStrings);
  return h("ul.tree", [
    ...directories.map((child) =>
      h("li", [
        h(
          "details",
          { open: currentPath?.startsWith(`${child.path}/`) === true },
          [
            // Names longer than the tree is wide end in an ellipsis; the full path is the tooltip.
            h("summary", { title: child.path }, [
              h("span.tree-name", child.name),
            ]),
            renderDirectory(child, currentPath),
          ],
        ),
      ]),
    ),
    ...files.map((file) =>
      h("li", [
        h(
          "a",
          {
            href: documentHref(file),
            title: file,
            ariaCurrent: file === currentPath ? "page" : undefined,
          },
          [h("span.tree-name", file.split("/").pop() ?? file)],
        ),
      ]),
    ),
  ]);
}

function renderRail(params: PageParams): Element | undefined {
  const backlinks = params.backlinks ?? [];
  // The document title is the page's own heading; the outline starts below it and stops at h3,
  // where entries become too fine-grained to scan in a side column.
  const outline = (params.headings ?? []).filter(
    (heading) => heading.depth === 2 || heading.depth === 3,
  );
  const neighborCount =
    params.documentPath === undefined ? 0 : (params.neighborCount ?? 0);
  if (outline.length === 0 && backlinks.length === 0 && neighborCount === 0) {
    return undefined;
  }
  return h("aside.rail", [
    neighborCount === 0 || params.documentPath === undefined
      ? undefined
      : h("section.local-graph", { ariaLabel: "Linked documents" }, [
          h("h2", `Links (${neighborCount})`),
          // Drawn by the page script, which shows the box once it has something to put in it.
          h("div.local-graph-canvas", {
            dataPath: params.documentPath,
            hidden: true,
          }),
          h(
            "a.local-graph-open",
            {
              href: `/graph?${new URLSearchParams({ focus: params.documentPath }).toString()}`,
            },
            "Open in the full graph",
          ),
        ]),
    outline.length === 0
      ? undefined
      : h("nav.outline", { ariaLabel: "On this page" }, [
          h("h2", "On this page"),
          h(
            "ul",
            outline.map((heading) =>
              h(`li.depth-${heading.depth}`, [
                h("a", { href: `#${heading.slug}` }, heading.text),
              ]),
            ),
          ),
        ]),
    backlinks.length === 0
      ? undefined
      : h("section.backlinks", { ariaLabel: "Linked from" }, [
          h("h2", `Linked from (${backlinks.length})`),
          h(
            "ul",
            backlinks.map((source) =>
              h("li", [h("a", { href: documentHref(source) }, source)]),
            ),
          ),
        ]),
  ]);
}

function renderFrontmatter(
  frontmatter: ParsedFrontmatter | null,
): Element | undefined {
  if (frontmatter === null) {
    return undefined;
  }
  const { parsed } = frontmatter;
  if (!parsed.ok) {
    // Shown rather than hidden: a block the linter cannot parse is the block an author needs to see.
    return h(
      "section.frontmatter.frontmatter-invalid",
      { ariaLabel: "Front matter" },
      [
        h("p", `Front matter is not valid YAML: ${parsed.error.message}`),
        h("pre", frontmatter.raw),
      ],
    );
  }
  const value = parsed.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return h("section.frontmatter", { ariaLabel: "Front matter" }, [
      h("pre", frontmatter.raw),
    ]);
  }
  return h("section.frontmatter", { ariaLabel: "Front matter" }, [
    h(
      "dl",
      Object.entries(value).flatMap(([key, entry]) => [
        h("dt", key),
        h("dd", formatFrontmatterValue(entry)),
      ]),
    ),
  ]);
}

function formatFrontmatterValue(value: FrontmatterValue): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(", ");
  }
  return JSON.stringify(value);
}
