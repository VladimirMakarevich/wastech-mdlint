// A one-of-few choice drawn as a segmented control: a row of buttons in a gray track, the chosen one
// lifted onto a thumb. Semantically a radio group, because that is what it is to a screen reader and
// to the keyboard — one tab stop on the checked segment, the arrow keys moving the choice — whereas a
// row of plain toggle buttons would read as several independent switches.

/** -1 or 1 for an arrow key that moves a radio group's choice back or forward, 0 for any other key. */
export function arrowStep(event: KeyboardEvent): -1 | 0 | 1 {
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      return 1;
    case "ArrowLeft":
    case "ArrowUp":
      return -1;
    default:
      return 0;
  }
}

export type Segmented<T> = {
  element: HTMLElement;
  /** Show `value` as the chosen segment, or none when it is not one of the choices. */
  render(value: T | undefined): void;
};

/**
 * A segmented control named `name` over `options`, each a value and its caption. A click or an arrow
 * key chooses, shows the choice at once and reports it to `onChoose`; `render` shows a value that
 * changed elsewhere, such as a reset.
 */
export function segmentedControl<T>(
  name: string,
  options: readonly (readonly [T, string])[],
  onChoose: (value: T) => void,
  className = "segmented is-compact",
): Segmented<T> {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", name);
  let current: T | undefined;
  const buttons = options.map(([value, caption]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment";
    button.setAttribute("role", "radio");
    button.textContent = caption;
    button.addEventListener("click", () => {
      choose(value);
    });
    return button;
  });
  element.append(...buttons);

  const render = (value: T | undefined): void => {
    current = value;
    const index = options.findIndex(([option]) => option === value);
    buttons.forEach((button, at) => {
      button.setAttribute("aria-checked", String(at === index));
      // With nothing chosen the first segment is the group's tab stop, or the keyboard could not
      // reach the group at all.
      button.tabIndex = at === Math.max(index, 0) ? 0 : -1;
    });
  };
  const choose = (value: T): void => {
    if (value === current) {
      return;
    }
    render(value);
    onChoose(value);
  };
  element.addEventListener("keydown", (event) => {
    const step = arrowStep(event);
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = options.findIndex(([option]) => option === current);
    const next = (Math.max(index, 0) + step + options.length) % options.length;
    choose(options[next]![0]);
    buttons[next]!.focus();
  });
  return { element, render };
}
