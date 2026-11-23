// The header's theme switch. Three states rather than a light/dark flip, because "follow the system"
// is a choice of its own: a reader who picked dark once should be able to hand control back to the
// operating system without clearing site data.

type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

// Shared with `theme.ts`, which applies the stored choice before the page paints.
const STORAGE_KEY = "wastech-mdlint-viewer:theme";
const ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];
const LABELS: Record<ThemeChoice, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};
const ICONS: Record<ThemeChoice, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};
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
  const button = document.querySelector<HTMLButtonElement>(".theme-toggle");
  if (button === null) {
    return;
  }
  // Rendered hidden by the server: without this script the button could do nothing.
  button.hidden = false;
  render(button, currentChoice());
  button.addEventListener("click", () => {
    const next = ORDER[(ORDER.indexOf(currentChoice()) + 1) % ORDER.length]!;
    if (next === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }
    try {
      if (next === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // Not remembered across pages, but applied to this one.
    }
    render(button, next);
    document.dispatchEvent(new Event(CHANGE_EVENT));
  });
}

function render(button: HTMLButtonElement, choice: ThemeChoice): void {
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
  button.textContent = `${ICONS[choice]} ${LABELS[choice]}`;
  button.title = `Theme: ${LABELS[choice]}. Click for ${LABELS[next]}.`;
  button.setAttribute(
    "aria-label",
    `Theme: ${LABELS[choice]}. Switch to ${LABELS[next]}`,
  );
}
