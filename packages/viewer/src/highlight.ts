import type { Element, Root } from "hast";
import { h } from "hastscript";
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ShikiTransformer,
} from "shiki";

// Highlighting runs on the server so a page ships no highlighter and no grammars: the browser gets
// finished markup. Both themes are emitted at once, as `--shiki-light` and `--shiki-dark` variables,
// so the stylesheet picks one with the page's color scheme and a theme change needs no re-render.

const THEMES = { light: "github-light", dark: "github-dark" } as const;

// Grammars load on first use, not up front: Shiki ships a few hundred, a page uses a handful, and
// loading them all would put seconds on startup for languages nobody wrote.
let highlighter: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({
    themes: Object.values(THEMES),
    langs: [],
  });
  return highlighter;
}

/** Shiki's id for a fence's info string, or `undefined` when it names no grammar Shiki has. */
export function languageForFence(
  info: string | undefined,
): BundledLanguage | undefined {
  const lang = info?.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (lang === undefined || lang.length === 0) {
    return undefined;
  }
  return Object.hasOwn(bundledLanguages, lang)
    ? (lang as BundledLanguage)
    : undefined;
}

// Extensions whose name is not itself a Shiki language id.
const EXTENSION_LANGUAGES: Record<string, string> = {
  cjs: "javascript",
  mjs: "javascript",
  cts: "typescript",
  mts: "typescript",
  yml: "yaml",
  htm: "html",
  ps1: "powershell",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  txt: "text",
};

/** Shiki's id for a source file shown as a page, chosen by its extension. */
export function languageForPath(relPath: string): BundledLanguage | undefined {
  const name = relPath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const extension =
    dot > 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
  return languageForFence(EXTENSION_LANGUAGES[extension] ?? extension);
}

/**
 * Highlight `code` as the `pre` element Shiki builds. Unknown languages render as plain text through
 * the same path, so every code block has the same markup and styling whether or not it is colored.
 *
 * `lineAnchors` gives each line an `id` of `L<n>`, the fragment GitHub uses for a line of a file, so
 * a document's link to `file.ts#L42` lands on that line of the source view.
 */
export async function highlight(
  code: string,
  lang: BundledLanguage | undefined,
  options: { lineAnchors?: boolean } = {},
): Promise<Element> {
  const instance = await getHighlighter();
  if (lang !== undefined && !instance.getLoadedLanguages().includes(lang)) {
    await instance.loadLanguage(lang);
  }
  const transformers: ShikiTransformer[] = options.lineAnchors
    ? [
        {
          line(node, line) {
            node.properties.id = `L${line}`;
          },
        },
      ]
    : [];
  const root: Root = instance.codeToHast(code, {
    lang: lang ?? "text",
    themes: THEMES,
    // Both themes as variables and neither inline, so the page's theme switch recolors code without
    // a `!important` fight against inline styles.
    defaultColor: false,
    transformers,
  });
  const pre = root.children[0];
  if (pre?.type !== "element") {
    throw new Error("Shiki returned no <pre> element");
  }
  return pre;
}

/**
 * A highlighted block with a button the page script turns into "copy this code". The block scrolls
 * sideways on its own, and a button inside it would scroll away with the text, so both sit in a
 * wrapper that holds the button in the block's corner. Hidden without script, which the copying
 * needs; the code itself is read from the block when the button is pressed, so the page does not
 * carry every block twice.
 */
export function withCopyButton(block: Element): Element {
  return h("div.code-block", [
    h(
      "button.code-copy",
      {
        type: "button",
        hidden: true,
        title: "Copy the code",
        ariaLabel: "Copy the code",
      },
      "Copy",
    ),
    block,
  ]);
}
