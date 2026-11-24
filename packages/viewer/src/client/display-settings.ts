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

  button.addEventListener("click", () => {
    if (isOpen()) {
      close(true);
    } else {
      open();
    }
  });
  panel.closeButton.addEventListener("click", () => {
    close(true);
  });
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
  const { head, closeButton } = panelHead();

  const form = document.createElement("form");
  form.className = "settings-form";
  // Nothing is submitted: every control applies itself.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  const controls = new PanelControls();
  form.append(...panelSections(controls));
  element.append(head, form);

  return {
    element,
    closeButton,
    render(settings) {
      controls.render(settings);
    },
    focusFirst() {
      form.querySelector<HTMLElement>("select, input")?.focus();
    },
    onChange(listener) {
      controls.listeners.push(listener);
    },
  };
}

function panelHead(): { head: HTMLElement; closeButton: HTMLButtonElement } {
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
  return { head, closeButton };
}

// The panel's groups, in the order they are shown. The text-width slider and the margins are built
// first, as their own variables, because the slider gets a second renderer and the margins a class.
function panelSections(controls: PanelControls): HTMLElement[] {
  const width = controls.range("textWidth", "Text width", "px");
  controls.renderers.push(() => {
    const slider = width.querySelector("input");
    if (slider !== null) {
      // A fixed width means nothing while the article fills the column.
      slider.disabled = controls.current.fullWidth;
    }
  });

  const margins = group("Margins", [
    controls.number("paddingTop", "Top"),
    controls.number("paddingRight", "Right"),
    controls.number("paddingBottom", "Bottom"),
    controls.number("paddingLeft", "Left"),
  ]);
  margins.classList.add("settings-margins");

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "settings-reset";
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => {
    controls.change({ ...DEFAULT_SETTINGS });
  });

  return [
    group("Whole site", [
      controls.select("siteFont", "Font", [
        ["system", "System"],
        ["serif", "Serif"],
        ["wide", "Wide sans"],
        ["mono", "Monospace"],
        ["custom", "Other…"],
      ]),
      controls.fontName("customSiteFont", "siteFont", "Font name"),
      controls.select("siteCodeFont", "Monospace font", [
        ["system", "System monospace"],
        ["custom", "Other…"],
      ]),
      controls.fontName("customSiteCodeFont", "siteCodeFont", "Font name"),
    ]),
    group("Text", [
      controls.select("textFont", "Font", [
        ["system", "Same as the site"],
        ["serif", "Serif"],
        ["wide", "Wide sans"],
        ["mono", "Monospace"],
        ["custom", "Other…"],
      ]),
      controls.fontName("customTextFont", "textFont", "Font name"),
      controls.range("fontSize", "Size", "px"),
      controls.range("lineHeight", "Line height", "×"),
      controls.range("letterSpacing", "Letter spacing", "em"),
      controls.range("blockSpacing", "Space between blocks", "em"),
      controls.segmented("align", "Alignment", [
        ["start", "Left"],
        ["justify", "Justified"],
      ]),
    ]),
    group("Layout", [
      width,
      controls.checkbox("fullWidth", "Fill the column"),
      controls.checkbox("sourceLines", "Source line numbers"),
    ]),
    margins,
    group("Code", [
      controls.select("codeFont", "Font", [
        ["system", "Same as the site"],
        ["custom", "Other…"],
      ]),
      controls.fontName("customCodeFont", "codeFont", "Font name"),
      controls.range("codeScale", "Size", "×"),
    ]),
    reset,
  ];
}

type FontChooser = "siteFont" | "siteCodeFont" | "textFont" | "codeFont";

/**
 * The panel's controls and the settings they show. Each control reads its value out of `current`
 * when drawn and writes it back on input; every change redraws all of them, since one setting can
 * hide or disable another's control.
 */
class PanelControls {
  current: DisplaySettings = { ...DEFAULT_SETTINGS };
  readonly renderers: (() => void)[] = [];
  readonly listeners: ((settings: DisplaySettings) => void)[] = [];

  render(settings: DisplaySettings): void {
    this.current = settings;
    for (const render of this.renderers) {
      render();
    }
  }

  change(patch: Partial<DisplaySettings>): void {
    this.render(parseSettings({ ...this.current, ...patch }));
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }

  select<K extends FontChooser>(
    key: K,
    label: string,
    options: readonly [DisplaySettings[K], string][],
  ): HTMLElement {
    const control = document.createElement("select");
    for (const [value, text] of options) {
      control.append(new Option(text, value));
    }
    control.addEventListener("change", () => {
      this.change({ [key]: control.value });
    });
    this.renderers.push(() => (control.value = this.current[key]));
    return field(label, control, "select");
  }

  // A choice of two or three short words, shown all at once rather than behind a select.
  segmented<K extends "align">(
    key: K,
    label: string,
    options: readonly [DisplaySettings[K], string][],
  ): HTMLElement {
    const control = segmentedControl(label, options, (value) => {
      this.change({ [key]: value });
    });
    this.renderers.push(() => {
      control.render(this.current[key]);
    });
    const row = document.createElement("div");
    row.className = "settings-field is-segmented";
    const text = document.createElement("span");
    text.className = "settings-label";
    text.textContent = label;
    row.append(text, control.element);
    return row;
  }

  fontName(
    key:
      | "customSiteFont"
      | "customSiteCodeFont"
      | "customTextFont"
      | "customCodeFont",
    chooser: FontChooser,
    label: string,
  ): HTMLElement {
    const control = document.createElement("input");
    control.type = "text";
    control.placeholder = "An installed font, e.g. Inter";
    control.spellcheck = false;
    control.autocomplete = "off";
    // Applied as typed, but the typed text is left alone while the field has focus: rewriting it
    // with the cleaned name would move the caret under the reader's fingers.
    control.addEventListener("input", () => {
      this.change({ [key]: control.value });
    });
    const row = field(label, control, "text");
    this.renderers.push(() => {
      row.hidden = this.current[chooser] !== "custom";
      if (document.activeElement !== control) {
        control.value = this.current[key];
      }
    });
    return row;
  }

  range(key: NumericKey, label: string, unit: string): HTMLElement {
    const { min, max, step } = NUMBER_RANGES[key];
    const control = document.createElement("input");
    control.type = "range";
    control.min = String(min);
    control.max = String(max);
    control.step = String(step);
    const output = document.createElement("output");
    control.addEventListener("input", () => {
      this.change({ [key]: Number(control.value) });
    });
    this.renderers.push(() => {
      const value = this.current[key];
      control.value = String(value);
      output.textContent = `${value}${unit}`;
      // How far along the track the value is, for the stylesheet to fill the track up to the thumb.
      control.style.setProperty(
        "--range-pct",
        `${((value - min) / (max - min)) * 100}%`,
      );
    });
    const row = field(label, control, "range");
    row.querySelector(".settings-label")?.append(output);
    return row;
  }

  number(key: NumericKey, label: string): HTMLElement {
    const { min, max, step } = NUMBER_RANGES[key];
    const control = document.createElement("input");
    control.type = "number";
    control.min = String(min);
    control.max = String(max);
    control.step = String(step);
    control.inputMode = "numeric";
    control.addEventListener("change", () => {
      const value = Number(control.value);
      this.change({
        [key]: Number.isFinite(value) ? value : DEFAULT_SETTINGS[key],
      });
    });
    this.renderers.push(() => (control.value = String(this.current[key])));
    return field(label, control, "number");
  }

  checkbox(key: "fullWidth" | "sourceLines", label: string): HTMLElement {
    const control = document.createElement("input");
    control.type = "checkbox";
    control.className = "switch";
    // An on/off setting that applies at once is a switch, not a box to tick and then submit.
    control.setAttribute("role", "switch");
    control.addEventListener("change", () => {
      this.change({ [key]: control.checked });
    });
    this.renderers.push(() => (control.checked = this.current[key]));
    const row = document.createElement("label");
    row.className = "settings-switch switch-row";
    const text = document.createElement("span");
    text.textContent = label;
    row.append(text, control);
    return row;
  }
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
