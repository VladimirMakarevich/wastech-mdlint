// What the reader can change about how the viewer looks: the accent color and fonts of the whole
// site, and the article's own fonts, sizes, spacing, width and margins. Pure — no DOM, no storage — so the rules that turn a stored or typed value
// into CSS are tested on their own, and the panel in `display-settings.ts` only wires inputs to them.
//
// Every setting becomes one `--reader-*` custom property on <html>, and the stylesheet reads each one
// with the default look as its fallback. Only settings that differ from the default are stored and
// set, so a reader who changed nothing gets exactly the stylesheet's own values, and Reset is simply
// "set none of them".

export type TextFont = "system" | "serif" | "wide" | "mono" | "custom";
export type CodeFont = "system" | "custom";
export type Alignment = "start" | "justify";
export type Accent = "blue" | "indigo" | "purple" | "red" | "teal" | "graphite";

/**
 * The accent colors the reader can pick, each with its caption and its light and dark value. A closed
 * list rather than a free color: the accent carries small text — links, rule ids — so each light value
 * is dark enough for 4.5:1 on white and each dark value light enough for the same on the dark page,
 * which a picked color would not be. Green and amber are left out because they already mean "added"
 * and "changed" on every changed document, and a link in either would read as a change mark. The red
 * is a crimson, apart from the brighter red that marks a removal.
 */
export const ACCENTS: readonly (readonly [
  Accent,
  string,
  { light: string; dark: string },
])[] = [
  ["blue", "Blue", { light: "#0066cc", dark: "#0a84ff" }],
  ["indigo", "Indigo", { light: "#4b48c8", dark: "#7d7aff" }],
  ["purple", "Purple", { light: "#8e3cc8", dark: "#bf5af2" }],
  ["red", "Red", { light: "#b8204a", dark: "#ff5c7a" }],
  ["teal", "Teal", { light: "#007a8a", dark: "#40c8e0" }],
  ["graphite", "Graphite", { light: "#48484a", dark: "#aeaeb2" }],
];

/** An accent's value as the stylesheet reads it: one token for both themes. */
export function accentColor(accent: Accent): string {
  const entry = ACCENTS.find(([value]) => value === accent) ?? ACCENTS[0]!;
  return `light-dark(${entry[2].light}, ${entry[2].dark})`;
}

export type DisplaySettings = {
  // The color of links, focus rings, the chosen tab and the other marks of the interface.
  accent: Accent;
  // The fonts of the whole site — header, tree, side column, panels, dashboard — and the ones the
  // article uses while its own are left at "same as the site".
  siteFont: TextFont;
  customSiteFont: string;
  siteCodeFont: CodeFont;
  customSiteCodeFont: string;
  // The article's text font; "system" here means the site's.
  textFont: TextFont;
  // An installed font's family name, used when `textFont` is "custom".
  customTextFont: string;
  codeFont: CodeFont;
  customCodeFont: string;
  // Pixels.
  fontSize: number;
  // A multiple of the font size.
  lineHeight: number;
  // Extra space between letters, in multiples of the font size; code keeps its own spacing.
  letterSpacing: number;
  // The article's greatest width in pixels, unless `fullWidth`.
  textWidth: number;
  fullWidth: boolean;
  // The space after a paragraph, list, table, quote or details block, in multiples of the font size.
  blockSpacing: number;
  // Code's size relative to the size it has by default, which is already smaller than the text.
  codeScale: number;
  align: Alignment;
  // The margins around the article, in pixels. A phone keeps its own narrow ones regardless: the
  // whole width there is barely a desktop margin and a half.
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  // The Markdown line each block starts on, in the right margin.
  sourceLines: boolean;
};

export const DEFAULT_SETTINGS: Readonly<DisplaySettings> = {
  accent: "blue",
  siteFont: "system",
  customSiteFont: "",
  siteCodeFont: "system",
  customSiteCodeFont: "",
  textFont: "system",
  customTextFont: "",
  codeFont: "system",
  customCodeFont: "",
  fontSize: 16,
  lineHeight: 1.6,
  letterSpacing: 0,
  textWidth: 860,
  fullWidth: false,
  blockSpacing: 1,
  codeScale: 1,
  align: "start",
  paddingTop: 32,
  paddingRight: 48,
  paddingBottom: 96,
  paddingLeft: 48,
  sourceLines: true,
};

type NumericKey = {
  [K in keyof DisplaySettings]: DisplaySettings[K] extends number ? K : never;
}[keyof DisplaySettings];

// The range of each number and its step, which the panel's inputs use as their `min`, `max` and
// `step`. A value outside its range is clamped into it, so a stored value from a range that has since
// narrowed, or a number typed past the end, still lands on something the layout can carry.
export const NUMBER_RANGES: Readonly<
  Record<NumericKey, { min: number; max: number; step: number }>
> = {
  fontSize: { min: 12, max: 28, step: 1 },
  lineHeight: { min: 1.1, max: 2.4, step: 0.05 },
  letterSpacing: { min: 0, max: 0.2, step: 0.01 },
  textWidth: { min: 480, max: 1800, step: 20 },
  blockSpacing: { min: 0, max: 3, step: 0.05 },
  codeScale: { min: 0.7, max: 1.4, step: 0.05 },
  paddingTop: { min: 0, max: 320, step: 4 },
  paddingRight: { min: 0, max: 320, step: 4 },
  paddingBottom: { min: 0, max: 320, step: 4 },
  paddingLeft: { min: 0, max: 320, step: 4 },
};

const TEXT_FONTS: readonly TextFont[] = [
  "system",
  "serif",
  "wide",
  "mono",
  "custom",
];
const CODE_FONTS: readonly CodeFont[] = ["system", "custom"];
const ALIGNMENTS: readonly Alignment[] = ["start", "justify"];
const ACCENT_VALUES: readonly Accent[] = ACCENTS.map(([value]) => value);

// Font stacks of faces that ship with the common systems, since the viewer fetches nothing from the
// network: Charter/Sitka/Cambria/Georgia for serif text, Verdana and its look-alikes for a wide sans
// that stays legible at small sizes.
const SERIF_STACK =
  'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Noto Serif", serif';
const WIDE_STACK =
  'Verdana, "DejaVu Sans", "Bitstream Vera Sans", Geneva, sans-serif';

// The two layers of stacks. The stylesheet keeps the system's own as `--font-sans-system` and
// `--font-mono-system`, and makes `--font-sans` and `--font-mono` — which the whole page reads — the
// site fonts, falling back to those. A site choice is built on the system stacks; an article choice
// on the site's, so "same as the site" is the article's default. Building a site font on
// `--font-sans` itself would make that property refer to itself, which CSS treats as invalid.
const SITE_BASE = {
  sans: "var(--font-sans-system)",
  mono: "var(--font-mono-system)",
};
const ARTICLE_BASE = { sans: "var(--font-sans)", mono: "var(--font-mono)" };

// A family name can hold letters of any script, digits, spaces and a little punctuation; anything
// else is dropped rather than quoted, so a name can never close its quotes and carry a second value
// into the property. Long enough for any real family name.
const MAX_FONT_NAME = 64;

export function cleanFontName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FONT_NAME)
    .trim();
}

function clamp(value: number, key: NumericKey): number {
  const { min, max, step } = NUMBER_RANGES[key];
  const stepped = Math.round((value - min) / step) * step + min;
  // Rounded to the step's own precision, so 1.6 stays 1.6 and is not stored as 1.6000000000000003.
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
}

/**
 * Settings from anything: a stored object, a partial one, or junk. Each field that is missing, of the
 * wrong type or not one of its choices takes its default; each number is clamped into its range. So
 * storage edited by hand, or written by an older or newer viewer, can never break the page.
 */
export function parseSettings(value: unknown): DisplaySettings {
  const input =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const settings: DisplaySettings = { ...DEFAULT_SETTINGS };
  const choice = <T extends string>(
    key: keyof DisplaySettings,
    options: readonly T[],
  ): T | undefined => {
    const raw = input[key];
    return typeof raw === "string" &&
      (options as readonly string[]).includes(raw)
      ? (raw as T)
      : undefined;
  };
  settings.accent = choice("accent", ACCENT_VALUES) ?? settings.accent;
  settings.siteFont = choice("siteFont", TEXT_FONTS) ?? settings.siteFont;
  settings.siteCodeFont =
    choice("siteCodeFont", CODE_FONTS) ?? settings.siteCodeFont;
  settings.textFont = choice("textFont", TEXT_FONTS) ?? settings.textFont;
  settings.codeFont = choice("codeFont", CODE_FONTS) ?? settings.codeFont;
  settings.align = choice("align", ALIGNMENTS) ?? settings.align;
  copyFreeFields(input, settings);
  return settings;
}

/**
 * The fields that are not a choice among fixed options — font names, switches and numbers — each
 * taken only when it has the right type, so a missing or mistyped one keeps its default.
 */
function copyFreeFields(
  input: Record<string, unknown>,
  settings: DisplaySettings,
): void {
  for (const key of [
    "customSiteFont",
    "customSiteCodeFont",
    "customTextFont",
    "customCodeFont",
  ] as const) {
    const raw = input[key];
    if (typeof raw === "string") {
      settings[key] = cleanFontName(raw);
    }
  }
  for (const key of ["fullWidth", "sourceLines"] as const) {
    const raw = input[key];
    if (typeof raw === "boolean") {
      settings[key] = raw;
    }
  }
  for (const key of Object.keys(NUMBER_RANGES) as NumericKey[]) {
    const raw = input[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      settings[key] = clamp(raw, key);
    }
  }
}

function textFontStack(
  choice: TextFont,
  customName: string,
  base: { sans: string; mono: string },
): string {
  switch (choice) {
    case "serif":
      return SERIF_STACK;
    case "wide":
      return WIDE_STACK;
    case "mono":
      return base.mono;
    case "custom": {
      const name = cleanFontName(customName);
      // An installed face first, then the stack below it, so a name the machine lacks still reads.
      return name === "" ? base.sans : `"${name}", ${base.sans}`;
    }
    case "system":
      return base.sans;
  }
}

function codeFontStack(
  choice: CodeFont,
  customName: string,
  base: string,
): string {
  const name = choice === "custom" ? cleanFontName(customName) : "";
  return name === "" ? base : `"${name}", ${base}`;
}

/** Every custom property the settings define, defaults included, as the stylesheet reads them. */
export function allVariables(
  settings: DisplaySettings,
): Record<string, string> {
  return {
    // Only ever one of the fixed values in `ACCENTS`, never text from storage, so nothing stored can
    // carry a second declaration into the property.
    "--reader-accent": accentColor(settings.accent),
    "--reader-site-font": textFontStack(
      settings.siteFont,
      settings.customSiteFont,
      SITE_BASE,
    ),
    "--reader-site-mono": codeFontStack(
      settings.siteCodeFont,
      settings.customSiteCodeFont,
      SITE_BASE.mono,
    ),
    "--reader-font": textFontStack(
      settings.textFont,
      settings.customTextFont,
      ARTICLE_BASE,
    ),
    "--reader-code-font": codeFontStack(
      settings.codeFont,
      settings.customCodeFont,
      ARTICLE_BASE.mono,
    ),
    "--reader-font-size": `${settings.fontSize}px`,
    "--reader-line-height": String(settings.lineHeight),
    "--reader-letter-spacing": `${settings.letterSpacing}em`,
    "--reader-width": settings.fullWidth ? "none" : `${settings.textWidth}px`,
    "--reader-block-gap": `${settings.blockSpacing}em`,
    "--reader-code-scale": String(settings.codeScale),
    "--reader-align": settings.align,
    // Justified text without hyphenation opens wide gaps between words on a narrow line.
    "--reader-hyphens": settings.align === "justify" ? "auto" : "manual",
    "--reader-pad-top": `${settings.paddingTop}px`,
    "--reader-pad-right": `${settings.paddingRight}px`,
    "--reader-pad-bottom": `${settings.paddingBottom}px`,
    "--reader-pad-left": `${settings.paddingLeft}px`,
    "--reader-source-lines": settings.sourceLines ? "block" : "none",
  };
}

const DEFAULT_VARIABLES = allVariables(DEFAULT_SETTINGS);

/** Only the custom properties whose value differs from the stylesheet's default. */
export function changedVariables(
  settings: DisplaySettings,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(allVariables(settings)).filter(
      ([name, value]) => DEFAULT_VARIABLES[name] !== value,
    ),
  );
}

// The page's script stores the settings (for the panel) and the properties they produce (for the
// classic script in `theme.ts`, which sets them before the first paint and cannot import this
// module) under one key, so the two can never come from different saves.
export const STORAGE_KEY = "wastech-mdlint-viewer:display";

// The only properties `theme.ts` will set from storage.
export const VARIABLE_NAME = /^--reader-[a-z-]+$/;

export type StoredDisplay = {
  settings: DisplaySettings;
  vars: Record<string, string>;
};

export function storedDisplay(settings: DisplaySettings): StoredDisplay {
  return { settings, vars: changedVariables(settings) };
}
