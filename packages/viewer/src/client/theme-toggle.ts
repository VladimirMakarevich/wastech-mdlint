// The header's theme switch: a segmented control of three choices rather than a light/dark flip,
// because "follow the system" is a choice of its own: a reader who picked dark once should be able to
// hand control back to the operating system without clearing site data.

import { arrowStep } from "./segmented.js";

type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

// Shared with `theme.ts`, which applies the stored choice before the page paints.
const STORAGE_KEY = "wastech-mdlint-viewer:theme";
const ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];
const CHANGE_EVENT = "wastech-mdlint-viewer:theme-change";
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function currentChoice(): ThemeChoice {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}

/** The theme the page is showing now, whichever way it was chosen. */
export function effectiveTheme(): Theme {
  const choice = currentChoice();
  if (choice !== "system") {
    return choice;
  }
  return systemDark.matches ? "dark" : "light";
}

/**
 * Call `listener` whenever the theme the page shows changes: from the switch, or from the operating
 * system while the choice is "Auto". Parts of the page that cannot follow CSS alone — Mermaid bakes
 * its colors into each SVG — redraw on it.
 */
export function onThemeChange(listener: (theme: Theme) => void): void {
  document.addEventListener(CHANGE_EVENT, () => listener(effectiveTheme()));
  systemDark.addEventListener("change", () => {
    if (currentChoice() === "system") {
      listener(effectiveTheme());
    }
  });
}

export function initThemeToggle(): void {
  const group = document.querySelector<HTMLElement>(".theme-switch");
  if (group === null) {
    return;
  }
  // Rendered hidden by the server: without this script the control could do nothing.
  group.hidden = false;
  const segments = [
    ...group.querySelectorAll<HTMLButtonElement>("button[data-choice]"),
  ];
  // The chosen segment's look is the stylesheet's, from the choice on <html>, so it is right before
  // this script runs. What is left here is what CSS cannot set: which radio is checked for assistive
  // technology, and that only the checked one is a tab stop, as in any radio group.
  const render = (choice: ThemeChoice): void => {
    for (const segment of segments) {
      const checked = segment.dataset.choice === choice;
      segment.setAttribute("aria-checked", String(checked));
      segment.tabIndex = checked ? 0 : -1;
    }
  };
  const choose = (choice: ThemeChoice, focus: boolean): void => {
    if (choice === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = choice;
    }
    try {
      if (choice === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, choice);
      }
    } catch {
      // Not remembered across pages, but applied to this one.
    }
    render(choice);
    if (focus) {
      segments.find((segment) => segment.dataset.choice === choice)?.focus();
    }
    document.dispatchEvent(new Event(CHANGE_EVENT));
  };
  render(currentChoice());
  for (const segment of segments) {
    segment.addEventListener("click", () => {
      const choice = segment.dataset.choice as ThemeChoice;
      if (choice !== currentChoice()) {
        choose(choice, false);
      }
    });
  }
  // The arrow keys move the choice, the way they move it in a group of radio buttons.
  group.addEventListener("keydown", (event) => {
    const step = arrowStep(event);
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = ORDER.indexOf(currentChoice());
    choose(ORDER[(index + step + ORDER.length) % ORDER.length]!, true);
  });
}
