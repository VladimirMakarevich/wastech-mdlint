import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  NUMBER_RANGES,
  STORAGE_KEY,
  VARIABLE_NAME,
  allVariables,
  changedVariables,
  cleanFontName,
  parseSettings,
} from "../src/client/display-settings-model.js";

describe("parseSettings", () => {
  // Storage is edited by hand, cleared halfway or written by another version of the viewer; none of
  // that may break the page, so anything unusable means the default.
  it.each([undefined, null, 42, "dark", [1, 2], {}])(
    "turns %j into the defaults",
    (value) => {
      expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it("keeps valid values and replaces each invalid one with its default alone", () => {
    const parsed = parseSettings({
      textFont: "serif",
      codeFont: "comic",
      align: "justify",
      fontSize: "18",
      lineHeight: 1.8,
      fullWidth: true,
      sourceLines: "no",
      unknown: 1,
    });
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      textFont: "serif",
      align: "justify",
      lineHeight: 1.8,
      fullWidth: true,
    });
  });

  it("clamps a number into its range and onto its step", () => {
    const parsed = parseSettings({
      fontSize: 400,
      lineHeight: 0,
      textWidth: 871,
      paddingLeft: -5,
      blockSpacing: 1.0300000001,
    });
    expect(parsed.fontSize).toBe(NUMBER_RANGES.fontSize.max);
    expect(parsed.lineHeight).toBe(NUMBER_RANGES.lineHeight.min);
    expect(parsed.textWidth).toBe(880);
    expect(parsed.paddingLeft).toBe(0);
    expect(parsed.blockSpacing).toBe(1.05);
    expect(parseSettings({ letterSpacing: 0.333 }).letterSpacing).toBe(
      NUMBER_RANGES.letterSpacing.max,
    );
    expect(parseSettings({ letterSpacing: 0.034 }).letterSpacing).toBe(0.03);
    expect(parseSettings({ fontSize: Number.NaN }).fontSize).toBe(16);
  });

  // Every default must be a value its own control can show, or the panel would open on a setting
  // the reader cannot get back to by moving the slider.
  it("accepts every default as it is", () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("font names", () => {
  // The name is written into a CSS value between quotes; a quote, a semicolon or a parenthesis would
  // let it end the family list and carry something else into the property.
  it("keeps letters of any script, digits, spaces and light punctuation only", () => {
    expect(cleanFontName('  Inter"; color: red  ')).toBe("Inter color red");
    expect(cleanFontName("PT Sans Caption")).toBe("PT Sans Caption");
    expect(cleanFontName("Шрифт-1.2_b")).toBe("Шрифт-1.2_b");
    expect(cleanFontName("url(x)")).toBe("urlx");
    expect(cleanFontName("a".repeat(100))).toHaveLength(64);
  });

  it("puts an installed font in front of the stack it falls back to", () => {
    const vars = allVariables(
      parseSettings({
        textFont: "custom",
        customTextFont: 'Inter"',
        codeFont: "custom",
        customCodeFont: "JetBrains Mono",
      }),
    );
    expect(vars["--reader-font"]).toBe('"Inter", var(--font-sans)');
    expect(vars["--reader-code-font"]).toBe(
      '"JetBrains Mono", var(--font-mono)',
    );
  });

  // The site fonts are what the whole page reads as `--font-sans` and `--font-mono`, so they are built
  // on the system stacks beneath those; built on `--font-sans` itself the property would refer to
  // itself, which CSS discards. The article's "same as the site" is then the site's choice.
  it("builds the site fonts on the system stacks and the article's on the site's", () => {
    const vars = allVariables(
      parseSettings({
        siteFont: "custom",
        customSiteFont: "Inter",
        siteCodeFont: "custom",
        customSiteCodeFont: "JetBrains Mono",
      }),
    );
    expect(vars["--reader-site-font"]).toBe('"Inter", var(--font-sans-system)');
    expect(vars["--reader-site-mono"]).toBe(
      '"JetBrains Mono", var(--font-mono-system)',
    );
    expect(vars["--reader-font"]).toBe("var(--font-sans)");
    expect(vars["--reader-code-font"]).toBe("var(--font-mono)");
    expect(
      allVariables(parseSettings({ siteFont: "mono" }))["--reader-site-font"],
    ).toBe("var(--font-mono-system)");
    expect(changedVariables(parseSettings({ siteFont: "serif" }))).toEqual({
      "--reader-site-font":
        'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Noto Serif", serif',
    });
  });

  it("falls back to the system stack when the custom name is empty", () => {
    const vars = allVariables(
      parseSettings({ textFont: "custom", customTextFont: '";' }),
    );
    expect(vars["--reader-font"]).toBe("var(--font-sans)");
  });
});

describe("custom properties", () => {
  it("sets nothing for the defaults, so the stylesheet's own values apply", () => {
    expect(changedVariables(DEFAULT_SETTINGS)).toEqual({});
  });

  it("sets only what differs from the default", () => {
    expect(
      changedVariables(
        parseSettings({ fontSize: 18, fullWidth: true, sourceLines: false }),
      ),
    ).toEqual({
      "--reader-font-size": "18px",
      "--reader-width": "none",
      "--reader-source-lines": "none",
    });
    expect(changedVariables(parseSettings({ letterSpacing: 0.05 }))).toEqual({
      "--reader-letter-spacing": "0.05em",
    });
    expect(changedVariables(parseSettings({ align: "justify" }))).toEqual({
      "--reader-align": "justify",
      "--reader-hyphens": "auto",
    });
  });

  // A property is set only when it differs from the default, so the stylesheet's fallback is what
  // every other reader sees. A fallback that drifted from the model's default would show one look
  // with nothing stored and another after the reader set and reset a value.
  it("matches every stylesheet fallback to the default the model computes", async () => {
    const css = await readFile(
      new URL("../assets/viewer.css", import.meta.url),
      "utf8",
    );
    for (const [name, value] of Object.entries(
      allVariables(DEFAULT_SETTINGS),
    )) {
      expect(name).toMatch(VARIABLE_NAME);
      expect(css, name).toContain(`var(${name}, ${value})`);
    }
  });

  // `theme.ts` sets the stored properties before the first paint, and as a classic script it cannot
  // import the model, so it spells the storage key and the name pattern out itself.
  it("is read back before the first paint under the same key and name pattern", async () => {
    const boot = await readFile(
      new URL("../src/client/theme.ts", import.meta.url),
      "utf8",
    );
    expect(boot).toContain(`"${STORAGE_KEY}"`);
    expect(boot).toContain(`/${VARIABLE_NAME.source}/`);
  });
});
