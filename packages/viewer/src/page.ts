import type { Element, ElementContent, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { type Child, h, s } from "hastscript";

import type {
  FrontmatterValue,
  ParsedFrontmatter,
  ParsedHeading,
} from "@wastech-mdlint/core";

import type { BlockChange } from "./change-marks.js";
import { renderTree } from "./page-tree.js";
import type { SectionMark } from "./review-state.js";
import { documentHref } from "./render-document.js";
import { changesCount, type TreeMarks } from "./tree-marks.js";

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
  // The same file's absolute path on this machine, for the copy button beside `displayPath`. Set only
  // when the viewer is bound to a loopback address (`exposesAbsolutePaths`): otherwise other machines
  // read the page, and the checkout's location is not theirs to learn.
  absolutePath?: string;
  // Set only on a document page. It opens the tree down to the document and marks it, and the
  // live-reload script reloads when this exact path changes. A linked source file is not in the
  // tree, so opening folders toward it would lead nowhere.
  documentPath?: string;
  article: ElementContent[];
  // Above everything in the article, front matter included: on a changed document, what the branch
  // did to it and how the page shows that.
  changeBanner?: Element;
  // In its place on a document the branch did not change, in a git work tree: the line that lists the
  // commits that last touched it, since the history of a page is worth a look whether or not this
  // branch is what changed it.
  historyLine?: Element;
  headings?: readonly ParsedHeading[];
  // Slugs of the headings whose section the branch changed, marked in the outline so a reader sees
  // where the changes are before scrolling to them.
  changedSections?: ReadonlySet<string>;
  // On a changed document with review marks on: each section's place in the reader's review, by its
  // heading's slug, so a section can be marked from the outline on its own.
  sectionMarks?: { path: string; marks: ReadonlyMap<string, SectionMark> };
  // The outline's first entry, for the text before the first section, where the page marks sections
  // or the branch changed that text: it has no heading of its own to list.
  introduction?: { changed: boolean };
  backlinks?: readonly string[];
  // How many documents the page's document links to or is linked from. The rail draws them as a
  // small graph, and leaves the graph out when there are none.
  neighborCount?: number;
  // On a changed document that shows its changes: the small graph marks them too.
  localGraphChanges?: boolean;
  frontmatter?: ParsedFrontmatter | null;
  frontmatterChange?: BlockChange;
  // Pre-fills the header's search box on a results page.
  query?: string;
  // On a document page in a git work tree: the link that shows or hides who last changed each block,
  // in the right margin, and whether it is shown now.
  blameToggle?: { href: string; on: boolean };
  // Set on the pages that send a change — the config page, and where review marks are on, the Changes
  // page and a changed document's page: the token their scripts send with it, so the server can tell
  // a request from its own page from one another page made the browser send.
  changeToken?: string;
  // Which of the header's sections the page is, marked on its link. The only thing about the header
  // that differs between those pages: everything else is byte-identical, so switching between them
  // leaves the bar exactly where it was.
  section?: Section;
  // Whether the repository is a git work tree, where a branch's changes can be reviewed: the header
  // then has a Changes section and the tree a switch for changed files. The same on every page, so
  // the header still stays put between them.
  showChanges?: boolean;
  // Whether review marks are on — a git work tree, on a loopback binding — so the tree also has a
  // switch for the changed files not yet reviewed. The same on every page, like `showChanges`.
  showReview?: boolean;
  // The marks beside the tree's files and on the Changes section, drawn into the page so it is whole
  // from its first frame.
  marks?: TreeMarks;
  // The number of the last server event the page's state includes; its script connects to the event
  // stream with it and is sent whatever came after.
  eventSequence?: number;
  // On a document with findings, once the first lint is in: the panel that lists them, above
  // everything else in the article.
  findingsPanel?: Element;
  // Set by a long page whose article marks where its first screen ends with `FIRST_SCREEN_ID`: the
  // page is drawn once that much is read. A page that sets it but has no such element, being short
  // after all, is drawn once all of it is read.
  firstScreen?: boolean;
};
  // Set by a page whose script builds part of what the page is laid out around — the config page's
  // editor, above the file — so it is not drawn before its script has run. Drawn first, the page
  // showed without that part and then pushed everything below it down when the script added it.
  scriptFirst?: boolean;

export type Section = "graph" | "dashboard" | "changes" | "config";

/**
 * The id of the page's main column, the skip link's target and where a finding about the whole file
 * jumps to.
 *
 * Every id the viewer gives its own elements contains a `.`: author headings get core's slugs as ids,
 * verbatim so the anchors REF-002 accepts exist on the page, and a slug never contains a `.`. An id a
 * heading could also have — `content` for a heading "Content" — would send that heading's outline
 * entry to the first element with it, the viewer's own.
 */
export const CONTENT_ID = "viewer.content";

// The id of an empty element at the very end of the page, which the page is not drawn before (see
// `renderHead`). An element of its own rather than the layout around the tree and the article, since
// a browser stops waiting for an element as soon as it has read its start tag.
const END_ID = "viewer.end";

/**
 * The id a long page gives the first element below its first screen, so the page is drawn once
 * everything above it has been read rather than all of it (`firstScreen`). The Changes page and the
 * dashboard are several hundred kilobytes, most of it far below the first screen, and waiting for all
 * of it held them back by a fifth of a second; what arrives after the first frame is out of sight.
 */
export const FIRST_SCREEN_ID = "viewer.first-screen";

/** An empty element to place where a long page's first screen ends, when nothing there can carry the id. */
export function firstScreenMarker(): Element {
  return h("div", { id: FIRST_SCREEN_ID, hidden: true });
}

// The theme switch's three choices, one segment each. The stylesheet marks the chosen one from the
// choice `theme.js` applied before the first paint, so the control is right from the first frame
// rather than once the module script has run. Each segment is an icon, drawn as SVG paths rather than
// the ◐ ☀ ☾ characters, which sit at a different height in every font the reader can pick; its label
// is the segment's name and tooltip.
const THEME_CHOICES = [
  {
    choice: "system",
    label: "Auto",
    // A circle, half filled: the system decides.
    icon: [
      s("circle", { cx: 8, cy: 8, r: 5.75 }),
      s("path", {
        d: "M8 2.25a5.75 5.75 0 0 1 0 11.5Z",
        fill: "currentColor",
        stroke: "none",
      }),
    ],
  },
  {
    choice: "light",
    label: "Light",
    // A sun: a disc and eight rays.
    icon: [
      s("circle", { cx: 8, cy: 8, r: 3 }),
      s("path", {
        d: "M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06",
      }),
    ],
  },
  {
    choice: "dark",
    label: "Dark",
    // A crescent moon.
    icon: [
      s("path", {
        d: "M13.5 9.6A5.75 5.75 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1Z",
      }),
    ],
  },
] as const;

export function renderPage(params: PageParams): string {
  const tree: Root = {
    type: "root",
    children: [
      { type: "doctype" },
      h("html", { lang: "en" }, [
        renderHead(params),
        h("body", [
          h("a.skip-link", { href: `#${CONTENT_ID}` }, "Skip to content"),
          renderTopbar(params),
          h("div.layout", [
            renderSidebar(params),
            h("main.content", { id: CONTENT_ID }, [
              h(
                `article.markdown-body${params.blameToggle?.on === true ? ".has-blame" : ""}`,
                [
                  params.findingsPanel,
                  params.changeBanner ?? params.historyLine,
                  renderFrontmatter(
                    params.frontmatter ?? null,
                    params.frontmatterChange,
                  ),
                  ...params.article,
                ],
              ),
            ]),
            renderRail(params),
          ]),
          h("div", { id: END_ID, hidden: true }),
        ]),
      ]),
    ],
  };
  return toHtml(tree, { allowDangerousHtml: true });
}

function renderHead(params: PageParams): Element {
  return h("head", [
    h("meta", { charSet: "utf-8" }),
    h("meta", {
      name: "viewport",
      content: "width=device-width, initial-scale=1",
    }),
    h("meta", { name: "color-scheme", content: "light dark" }),
    params.documentPath === undefined
      ? undefined
      : h("meta", { name: "wastech-doc", content: params.documentPath }),
    params.changeToken === undefined
      ? undefined
      : h("meta", {
          name: "wastech-change-token",
          content: params.changeToken,
        }),
    params.eventSequence === undefined
      ? undefined
      : h("meta", {
          name: "wastech-events",
          content: String(params.eventSequence),
        }),
    h("title", `${params.title} · ${params.siteName}`),
    h("link", { rel: "icon", href: "/favicon.ico" }),
    // Classic and blocking, ahead of the stylesheet, so a stored theme is applied before the
    // first paint; every other script is a deferred module.
    h("script", { src: "/assets/theme.js" }),
    h("link", { rel: "stylesheet", href: "/assets/viewer.css" }),
    h("script", {
      type: "module",
      src: "/assets/viewer.js",
      blocking: params.scriptFirst === true ? "render" : undefined,
    }),
    // Nothing of the page is drawn until all of it has been read, or on a long page all of its first
    // screen. The blocking script after the tree stops the parser while it is fetched, and the
    // browser drew what it had by then — the header and the tree over an empty article — one frame
    // before the rest, so a navigation blinked through an empty page. Browsers that do not know this
    // link draw as before.
    h("link", {
      rel: "expect",
      href: `#${params.firstScreen === true ? FIRST_SCREEN_ID : END_ID}`,
      blocking: "render",
    }),
  ]);
}

function renderTopbar(params: PageParams): Element {
  return h("header.topbar", [
    h("a.site-name", { href: "/" }, params.siteName),
    params.displayPath === undefined
      ? undefined
      : h("span.current-path", params.displayPath),
    params.displayPath === undefined
      ? undefined
      : copyPathButton(params.displayPath, params.absolutePath),
    params.blameToggle === undefined
      ? undefined
      : h(
          "a.blame-toggle",
          {
            href: params.blameToggle.href,
            ariaPressed: params.blameToggle.on ? "true" : "false",
            title: params.blameToggle.on
              ? "Hide who last changed each block"
              : "Show who last changed each block, in the right margin",
          },
          "Blame",
        ),
    // A plain GET form, so search works as a results page even before (or without) the
    // script that turns it into a live list.
    h("form.search", { action: "/search", method: "get", role: "search" }, [
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
    ]),
    renderSectionNav(params),
    renderThemeSwitch(),
    // Opens the display settings panel the page script builds; laid out like the theme
    // switch, and for the same reason.
    h(
      "button.settings-toggle",
      {
        type: "button",
        hidden: true,
        title: "Display settings",
        ariaLabel: "Display settings",
      },
      "Aa",
    ),
  ]);
}

// The three sections as one segmented control of plain links: the page's own section is the chosen
// segment, and the links work without script.
function renderSectionNav(params: PageParams): Element {
  return h("nav.section-nav.segmented", { ariaLabel: "Sections" }, [
    // From a document, the graph opens with that document and its neighbors lit, which is
    // how a reader gets from a page to its place among the others.
    sectionLink(
      params,
      "graph",
      params.documentPath === undefined
        ? "/graph"
        : `/graph?${new URLSearchParams({ focus: params.documentPath }).toString()}`,
      "Graph",
    ),
    sectionLink(params, "dashboard", "/dashboard", "Dashboard"),
    params.showChanges === true
      ? sectionLink(params, "changes", "/changes", [
          "Changes",
          params.marks?.changes === undefined
            ? undefined
            : changesCount(params.marks.changes),
        ])
      : undefined,
    sectionLink(params, "config", "/config", "Config"),
  ]);
}

// Hidden without script, which it needs to do anything. With script, the stylesheet lays it out
// from the first paint (see `theme.ts`), before the module that wires it has run.
function renderThemeSwitch(): Element {
  return h(
    "div.theme-switch.segmented",
    { role: "radiogroup", ariaLabel: "Theme", hidden: true },
    THEME_CHOICES.map(({ choice, icon, label }) =>
      h(
        "button.segment",
        {
          type: "button",
          role: "radio",
          dataChoice: choice,
          title: label,
          ariaLabel: label,
        },
        s(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 16,
            height: 16,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            ariaHidden: "true",
          },
          [...icon],
        ),
      ),
    ),
  );
}

function renderSidebar(params: PageParams): Element {
  const current = params.marks?.current ?? [];
  return h("div.sidebar-frame", [
    h(
      "nav.sidebar",
      {
        ariaLabel: "Documents",
        // Which marks in the tree are current, so the page script does not ask for them again and
        // the tree-state script may narrow the tree to them before the first paint.
        dataMarked: current.length === 0 ? undefined : current.join(" "),
      },
      [
        // On a phone the tree folds behind this row, so the article starts under the header
        // rather than below a screenful of file names; the tree-state script closes it there
        // before the first paint. On a wider screen the row is not drawn and the tree stays
        // open, and without script it is open everywhere, as a list that cannot be opened
        // would be no list at all.
        h("details.sidebar-disclosure", { open: true }, [
          h("summary.sidebar-summary", "Documents"),
          ...renderTreeFilters(params),
          renderTree(params.documentPaths, params.documentPath, params.marks),
        ]),
      ],
    ),
    // Classic and blocking, right after the tree, so the folders the reader had open and
    // the tree's scroll position are back before the tree is first painted.
    h("script", { src: "/assets/tree-state.js" }),
    columnResizer("sidebar", "Resize the document tree"),
  ]);
}

// The switches that narrow the tree, each with the line it shows when nothing is left. Hidden until
// the script that knows the findings and the changes has run, like the theme switch.
function renderTreeFilters(params: PageParams): (Element | undefined)[] {
  return [
    treeSwitch("findings", "Only files with findings"),
    h(
      "p.tree-filter-empty.tree-filter-findings-empty",
      { hidden: true },
      "No file has findings.",
    ),
    params.showChanges === true
      ? treeSwitch("changes", "Only changed files")
      : undefined,
    params.showReview === true
      ? treeSwitch("unreviewed", "Only files left to review")
      : undefined,
    params.showChanges === true
      ? h(
          "p.tree-filter-empty.tree-filter-changes-empty",
          { hidden: true },
          "No document changed.",
        )
      : undefined,
  ];
}

function treeSwitch(name: string, label: string): Element {
  return h(
    `label.tree-filter.tree-filter-${name}.switch-row`,
    { hidden: true },
    [h("span", label), h("input.switch", { type: "checkbox", role: "switch" })],
  );
}

/**
 * The button that copies a file's path, relative or absolute, through a menu the page script adds.
 * Hidden without script, which the copying needs. `absolutePath` is left off unless the viewer is
 * bound to a loopback address; the menu then says why that choice is missing.
 */
export function copyPathButton(
  relativePath: string,
  absolutePath: string | undefined,
): Element {
  return h(
    "button.copy-path",
    {
      type: "button",
      hidden: true,
      title: "Copy the path",
      ariaLabel: `Copy the path of ${relativePath}`,
      dataPath: relativePath,
      dataAbsolutePath: absolutePath,
    },
    // Two overlapping sheets, the usual mark for copying, drawn in the text color.
    s(
      "svg",
      {
        viewBox: "0 0 16 16",
        width: 14,
        height: 14,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        ariaHidden: "true",
      },
      [
        s("rect", { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }),
        s("path", {
          d: "M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1",
        }),
      ],
    ),
  );
}

function sectionLink(
  params: PageParams,
  section: Section,
  href: string,
  content: Child,
): Element {
  return h(
    "a.segment",
    {
      href,
      ariaCurrent: params.section === section ? "page" : undefined,
    },
    content,
  );
}

/** Article content for an already-sanitized HTML string. */
export function rawHtml(html: string): ElementContent[] {
  return [{ type: "raw", value: html }];
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
  // Framed like the tree, so its width handle spans the full height wherever the rail is scrolled to.
  return h("div.rail-frame", [
    h("aside.rail", [
      neighborCount === 0 || params.documentPath === undefined
        ? undefined
        : h("section.local-graph", { ariaLabel: "Linked documents" }, [
            h("h2", `Links (${neighborCount})`),
            // Drawn by the page script, which shows the box once it has something to put in it.
            h("div.local-graph-canvas", {
              dataPath: params.documentPath,
              dataChanges: params.localGraphChanges === true ? "1" : undefined,
              hidden: true,
            }),
            h(
              "p.local-graph-hint",
              { hidden: true },
              "Ctrl or ⌘ + scroll to zoom, drag to move",
            ),
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
            h("ul", [
              params.introduction === undefined
                ? undefined
                : outlineEntry(params, {
                    // Its section key is `""`, as core's `documentSections` names it. It jumps to the
                    // top of the main column, where the text it stands for begins.
                    key: "",
                    depth: 2,
                    text: "Introduction",
                    href: `#${CONTENT_ID}`,
                    changed: params.introduction.changed,
                  }),
              ...outline.map((heading) =>
                outlineEntry(params, {
                  key: heading.slug,
                  depth: heading.depth,
                  text: heading.text,
                  href: `#${heading.slug}`,
                  changed: params.changedSections?.has(heading.slug) === true,
                }),
              ),
            ]),
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
    ]),
    columnResizer("rail", "Resize the side column"),
  ]);
}

/**
 * One entry of the outline: a link to its section, the branch's change mark, and the button that
 * marks the section viewed where the page marks sections.
 */
function outlineEntry(
  params: PageParams,
  entry: {
    key: string;
    depth: number;
    text: string;
    href: string;
    changed: boolean;
  },
): Element {
  const mark = params.sectionMarks?.marks.get(entry.key);
  return h(`li.depth-${entry.depth}`, { dataReview: mark?.status }, [
    h("a", { href: entry.href }, [
      entry.text,
      entry.changed
        ? h("span.outline-change", {
            role: "img",
            ariaLabel: "changed in this branch",
            title: "Changed in this branch",
          })
        : undefined,
    ]),
    mark === undefined || params.sectionMarks === undefined
      ? undefined
      : sectionMarkButton(params.sectionMarks.path, entry.text, mark),
  ]);
}

const SECTION_STATUS: Record<SectionMark["status"], string> = {
  reviewed: "Viewed",
  changed: "Changed since you viewed it",
  unreviewed: "Not viewed yet",
};

/**
 * The button that marks one section viewed, beside its outline entry: pressed while the section's
 * own text is one the reader reviewed. Hidden until the script that sends the mark has run; without
 * it, the entry's `data-review` still shows where the section stands.
 */
function sectionMarkButton(
  relPath: string,
  headingText: string,
  mark: SectionMark,
): Element {
  return h(
    "button.section-mark",
    {
      type: "button",
      hidden: true,
      ariaPressed: mark.status === "reviewed" ? "true" : "false",
      ariaLabel: `Mark the section "${headingText}" as viewed`,
      title: SECTION_STATUS[mark.status],
      dataPath: relPath,
      dataSection: mark.key,
      dataHash: mark.hash,
    },
    "✓",
  );
}

// A column's width handle, on its edge toward the article. Hidden until the script that drags it has
// run, like the theme switch, but rendered as the focusable separator it becomes.
function columnResizer(column: "sidebar" | "rail", label: string): Element {
  return h("div.column-resizer", {
    dataColumn: column,
    role: "separator",
    ariaOrientation: "vertical",
    ariaLabel: label,
    tabIndex: 0,
    hidden: true,
  });
}

function renderFrontmatter(
  frontmatter: ParsedFrontmatter | null,
  change: BlockChange | undefined,
): Element | undefined {
  if (frontmatter === null) {
    return undefined;
  }
  // Marked like any block of the article, so the card shows a change the same way and the page
  // script finds its hunks the same way.
  const properties = {
    ariaLabel: "Front matter",
    dataChange: change?.kind,
    dataChangeHunks: change?.hunks.join(" "),
  };
  const { parsed } = frontmatter;
  if (!parsed.ok) {
    // Shown rather than hidden: a block the linter cannot parse is the block an author needs to see.
    return h("section.frontmatter.frontmatter-invalid", properties, [
      h("p", `Front matter is not valid YAML: ${parsed.error.message}`),
      h("pre", frontmatter.raw),
    ]);
  }
  const value = parsed.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return h("section.frontmatter", properties, [h("pre", frontmatter.raw)]);
  }
  return h("section.frontmatter", properties, [
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
