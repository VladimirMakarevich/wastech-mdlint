import {
  DEFAULT_SETTINGS,
  NUMBER_RANGES,
  STORAGE_KEY,
  VARIABLE_NAME,
  changedVariables,
  parseSettings,
  storedDisplay,
  type DisplaySettings,
} from "./display-settings-model.js";
import { segmentedControl } from "./segmented.js";

// The header's display settings: a button at the right end of the bar opens a panel that slides in
// from the right edge, where the reader sets the fonts of the whole site and the article's own fonts,
// sizes, spacing, width and margins. Every change applies as it is made and is remembered for this
// address, like the theme; `theme.ts` puts the stored values back before the first paint, so a page never shows the defaults
// first and then jumps — not on the next page, not after the viewer restarts.

type NumericKey = keyof typeof NUMBER_RANGES;

export function initDisplaySettings(): void {
  const button = document.querySelector<HTMLButtonElement>(".settings-toggle");
  if (button === null) {
    return;
  }
  // Rendered hidden by the server: without this script the button could do nothing.
  button.hidden = false;

  let settings = readStored();
  const panel = buildPanel();
  document.body.append(panel.element);
  button.setAttribute("aria-controls", panel.element.id);
  button.setAttribute("aria-expanded", "false");

  const isOpen = (): boolean => panel.element.classList.contains("is-open");
  const open = (): void => {
    panel.render(settings);
    panel.element.classList.add("is-open");
    panel.element.removeAttribute("inert");
    button.setAttribute("aria-expanded", "true");
    panel.focusFirst();
  };
  const close = (returnFocus: boolean): void => {
    if (!isOpen()) {
      return;
    }
    panel.element.classList.remove("is-open");
    // Out of the tab order and the accessibility tree while it is off screen.
    panel.element.setAttribute("inert", "");
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      button.focus();
    }
  };

  button.addEventListener("click", () => (isOpen() ? close(true) : open()));
  panel.closeButton.addEventListener("click", () => close(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close(true);
    }
  });
  // A click anywhere else puts the panel away, as a menu would; the article stays readable beside it
  // until then, so a change can be judged on the text it changes.
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node | null;
    if (
      isOpen() &&
      target !== null &&
      !panel.element.contains(target) &&
      !button.contains(target)
    ) {
      close(false);
    }
  });

  panel.onChange((next) => {
    settings = next;
    apply(settings);
    writeStored(settings);
  });
}

/** Set exactly the properties the settings change, and clear every other one. */
function apply(settings: DisplaySettings): void {
  const style = document.documentElement.style;
  for (const name of [...style]) {
    if (VARIABLE_NAME.test(name)) {
      style.removeProperty(name);
    }
  }
  for (const [name, value] of Object.entries(changedVariables(settings))) {
    style.setProperty(name, value);
  }
}

// Storage can be unavailable (private windows, blocked site data); the settings then hold for this
// page only, and the next one opens with the defaults.
function readStored(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseSettings(
      raw === null
        ? undefined
        : (JSON.parse(raw) as { settings?: unknown }).settings,
    );
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStored(settings: DisplaySettings): void {
  try {
    if (Object.keys(changedVariables(settings)).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(storedDisplay(settings)),
      );
    }
  } catch {
    // Applied to this page, not remembered.
  }
}

type Panel = {
  element: HTMLElement;
  closeButton: HTMLButtonElement;
  render(settings: DisplaySettings): void;
  focusFirst(): void;
  onChange(listener: (settings: DisplaySettings) => void): void;
};

function buildPanel(): Panel {
  const element = document.createElement("aside");
  element.className = "settings-panel";
  element.id = "display-settings";
  element.setAttribute("aria-label", "Display settings");
  element.setAttribute("inert", "");

  const head = document.createElement("div");
  head.className = "settings-head";
  const title = document.createElement("h2");
  title.textContent = "Display";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "settings-close";
  // An × drawn as two strokes rather than the character, which sits off center in most fonts.
  const cross = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cross.setAttribute("viewBox", "0 0 16 16");
  cross.setAttribute("width", "12");
  cross.setAttribute("height", "12");
  cross.setAttribute("aria-hidden", "true");
  const strokes = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  strokes.setAttribute("d", "M3.5 3.5l9 9M12.5 3.5l-9 9");
  strokes.setAttribute("stroke", "currentColor");
  strokes.setAttribute("stroke-width", "2");
  strokes.setAttribute("stroke-linecap", "round");
  cross.append(strokes);
  closeButton.append(cross);
  closeButton.setAttribute("aria-label", "Close display settings");
  head.append(title, closeButton);

  const form = document.createElement("form");
  form.className = "settings-form";
  // Nothing is submitted: every control applies itself.
  form.addEventListener("submit", (event) => event.preventDefault());

  const listeners: ((settings: DisplaySettings) => void)[] = [];
  let current: DisplaySettings = { ...DEFAULT_SETTINGS };
  // Each control reads its value out of `current` when drawn and writes it back on input.
  const renderers: (() => void)[] = [];
  const change = (patch: Partial<DisplaySettings>): void => {
    current = parseSettings({ ...current, ...patch });
    for (const render of renderers) {
      render();
    }
    for (const listener of listeners) {
      listener(current);
    }
  };

  const select = <
    K extends "siteFont" | "siteCodeFont" | "textFont" | "codeFont",
  >(
    key: K,
    label: string,
    options: readonly [DisplaySettings[K], string][],
  ): HTMLElement => {
    const control = document.createElement("select");
    for (const [value, text] of options) {
      control.append(new Option(text, value));
    }
    control.addEventListener("change", () =>
      change({ [key]: control.value } as Partial<DisplaySettings>),
    );
    renderers.push(() => (control.value = current[key]));
    return field(label, control, "select");
  };

  // A choice of two or three short words, shown all at once rather than behind a select.
  const segmented = <K extends "align">(
    key: K,
    label: string,
    options: readonly [DisplaySettings[K], string][],
  ): HTMLElement => {
    const control = segmentedControl(label, options, (value) =>
      change({ [key]: value } as Partial<DisplaySettings>),
    );
    renderers.push(() => control.render(current[key]));
    const row = document.createElement("div");
    row.className = "settings-field is-segmented";
    const text = document.createElement("span");
    text.className = "settings-label";
    text.textContent = label;
    row.append(text, control.element);
    return row;
  };

  const fontName = (
    key:
      | "customSiteFont"
      | "customSiteCodeFont"
      | "customTextFont"
      | "customCodeFont",
    chooser: "siteFont" | "siteCodeFont" | "textFont" | "codeFont",
    label: string,
  ): HTMLElement => {
    const control = document.createElement("input");
    control.type = "text";
    control.placeholder = "An installed font, e.g. Inter";
    control.spellcheck = false;
    control.autocomplete = "off";
    // Applied as typed, but the typed text is left alone while the field has focus: rewriting it
    // with the cleaned name would move the caret under the reader's fingers.
    control.addEventListener("input", () =>
      change({ [key]: control.value } as Partial<DisplaySettings>),
    );
    const row = field(label, control, "text");
    renderers.push(() => {
      row.hidden = current[chooser] !== "custom";
      if (document.activeElement !== control) {
        control.value = current[key];
      }
    });
    return row;
  };

  const range = (key: NumericKey, label: string, unit: string): HTMLElement => {
    const { min, max, step } = NUMBER_RANGES[key];
    const control = document.createElement("input");
    control.type = "range";
    control.min = String(min);
    control.max = String(max);
    control.step = String(step);
    const output = document.createElement("output");
    control.addEventListener("input", () =>
      change({ [key]: Number(control.value) } as Partial<DisplaySettings>),
    );
    renderers.push(() => {
      control.value = String(current[key]);
      output.textContent = `${current[key]}${unit}`;
      // How far along the track the value is, for the stylesheet to fill the track up to the thumb.
      control.style.setProperty(
        "--range-pct",
        `${((current[key] - min) / (max - min)) * 100}%`,
      );
    });
    const row = field(label, control, "range");
    row.querySelector(".settings-label")?.append(output);
    return row;
  };

  const number = (key: NumericKey, label: string): HTMLElement => {
    const { min, max, step } = NUMBER_RANGES[key];
    const control = document.createElement("input");
    control.type = "number";
    control.min = String(min);
    control.max = String(max);
    control.step = String(step);
    control.inputMode = "numeric";
    control.addEventListener("change", () => {
      const value = Number(control.value);
      change({
        [key]: Number.isFinite(value) ? value : DEFAULT_SETTINGS[key],
      } as Partial<DisplaySettings>);
    });
    renderers.push(() => (control.value = String(current[key])));
    return field(label, control, "number");
  };

  const checkbox = (
    key: "fullWidth" | "sourceLines",
    label: string,
  ): HTMLElement => {
    const control = document.createElement("input");
    control.type = "checkbox";
    control.className = "switch";
    // An on/off setting that applies at once is a switch, not a box to tick and then submit.
    control.setAttribute("role", "switch");
    control.addEventListener("change", () =>
      change({ [key]: control.checked } as Partial<DisplaySettings>),
    );
    renderers.push(() => (control.checked = current[key]));
    const row = document.createElement("label");
    row.className = "settings-switch switch-row";
    const text = document.createElement("span");
    text.textContent = label;
    row.append(text, control);
    return row;
  };

  const width = range("textWidth", "Text width", "px");
  renderers.push(() => {
    const slider = width.querySelector("input");
    if (slider !== null) {
      // A fixed width means nothing while the article fills the column.
      slider.disabled = current.fullWidth;
    }
  });

  const margins = group("Margins", [
    number("paddingTop", "Top"),
    number("paddingRight", "Right"),
    number("paddingBottom", "Bottom"),
    number("paddingLeft", "Left"),
  ]);
  margins.classList.add("settings-margins");

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "settings-reset";
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => change({ ...DEFAULT_SETTINGS }));

  form.append(
    group("Whole site", [
      select("siteFont", "Font", [
        ["system", "System"],
        ["serif", "Serif"],
        ["wide", "Wide sans"],
        ["mono", "Monospace"],
        ["custom", "Other…"],
      ]),
      fontName("customSiteFont", "siteFont", "Font name"),
      select("siteCodeFont", "Monospace font", [
        ["system", "System monospace"],
        ["custom", "Other…"],
      ]),
      fontName("customSiteCodeFont", "siteCodeFont", "Font name"),
    ]),
    group("Text", [
      select("textFont", "Font", [
        ["system", "Same as the site"],
        ["serif", "Serif"],
        ["wide", "Wide sans"],
        ["mono", "Monospace"],
        ["custom", "Other…"],
      ]),
      fontName("customTextFont", "textFont", "Font name"),
      range("fontSize", "Size", "px"),
      range("lineHeight", "Line height", "×"),
      range("letterSpacing", "Letter spacing", "em"),
      range("blockSpacing", "Space between blocks", "em"),
      segmented("align", "Alignment", [
        ["start", "Left"],
        ["justify", "Justified"],
      ]),
    ]),
    group("Layout", [
      width,
      checkbox("fullWidth", "Fill the column"),
      checkbox("sourceLines", "Source line numbers"),
    ]),
    margins,
    group("Code", [
      select("codeFont", "Font", [
        ["system", "Same as the site"],
        ["custom", "Other…"],
      ]),
      fontName("customCodeFont", "codeFont", "Font name"),
      range("codeScale", "Size", "×"),
    ]),
    reset,
  );
  element.append(head, form);

  return {
    element,
    closeButton,
    render(settings) {
      current = settings;
      for (const render of renderers) {
        render();
      }
    },
    focusFirst() {
      form.querySelector<HTMLElement>("select, input")?.focus();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

// One row of a group's card. Its kind decides the layout: a select or a font name sits at the row's
// right end, a slider takes the full width under its label, a margin is one of four small columns.
function field(
  label: string,
  control: HTMLElement,
  kind: "select" | "text" | "range" | "number",
): HTMLElement {
  const row = document.createElement("label");
  row.className = `settings-field is-${kind}`;
  const text = document.createElement("span");
  text.className = "settings-label";
  text.textContent = label;
  row.append(text, control);
  return row;
}

// A titled group of rows: the title above, the rows on a rounded card, as Settings groups its own.
function group(legend: string, children: HTMLElement[]): HTMLElement {
  const fieldset = document.createElement("fieldset");
  const title = document.createElement("legend");
  title.textContent = legend;
  const card = document.createElement("div");
  card.className = "settings-card";
  card.append(...children);
  fieldset.append(title, card);
  return fieldset;
}
