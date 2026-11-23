// A small dropdown of actions under a button: the copy-path choices and the fix-prompt choices. It is
// placed with fixed positioning on <body> rather than inside the button's container, because some of
// those containers scroll or clip (the dashboard's table scrolls sideways) and would cut it off.

export type MenuItem = {
  label: string;
  // A second, quieter line: the path or text the action would copy.
  detail?: string;
  // Set when the action is unavailable; the item is shown disabled with this as its explanation.
  unavailable?: string;
  // Resolves to whether the action worked, which the item then says for a moment.
  run(): Promise<boolean>;
};

export type MenuOptions = {
  // What a successful item says before the menu closes.
  doneLabel?: string;
};

let openMenu: { close(returnFocus: boolean): void } | undefined;

/**
 * Open a menu under `trigger` on click. `items` is called on every opening, so the choices reflect
 * the page as it is then; it may be asynchronous, and the menu says so while it waits.
 */
export function attachMenu(
  trigger: HTMLButtonElement,
  items: () => MenuItem[] | Promise<MenuItem[]>,
  options: MenuOptions = {},
): void {
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (event) => {
    // A trigger inside a <summary> would otherwise fold its <details>.
    event.preventDefault();
    event.stopPropagation();
    const wasThis =
      openMenu !== undefined &&
      trigger.getAttribute("aria-expanded") === "true";
    openMenu?.close(false);
    if (!wasThis) {
      void show(trigger, items, options);
    }
  });
}

async function show(
  trigger: HTMLButtonElement,
  items: () => MenuItem[] | Promise<MenuItem[]>,
  options: MenuOptions,
): Promise<void> {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const waiting = document.createElement("p");
  waiting.className = "menu-note";
  waiting.textContent = "Loading…";
  menu.append(waiting);
  document.body.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  place(menu, trigger);

  let closed = false;
  const close = (returnFocus: boolean): void => {
    if (closed) {
      return;
    }
    closed = true;
    menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
    window.removeEventListener("resize", dismiss);
    window.removeEventListener("scroll", dismiss, true);
    if (openMenu === handle) {
      openMenu = undefined;
    }
    if (returnFocus) {
      trigger.focus();
    }
  };
  const handle = { close };
  openMenu = handle;

  const outside = (event: Event): void => {
    const target = event.target as Node | null;
    if (
      target !== null &&
      !menu.contains(target) &&
      !trigger.contains(target)
    ) {
      close(false);
    }
  };
  const dismiss = (event: Event): void => {
    // Scrolling inside the menu itself is not leaving it.
    if (!(event.target instanceof Node && menu.contains(event.target))) {
      close(false);
    }
  };
  const buttons = (): HTMLButtonElement[] => [
    ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  const keys = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const list = buttons();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", keys, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);

  let entries: MenuItem[];
  try {
    entries = await items();
  } catch {
    entries = [];
  }
  if (closed) {
    return;
  }
  menu.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "menu-note";
    empty.textContent =
      "Nothing to copy right now. Reload the page and try again.";
    menu.append(empty);
  }
  for (const entry of entries) {
    menu.append(item(entry, options, close));
  }
  place(menu, trigger);
  buttons()[0]?.focus();
}

function item(
  entry: MenuItem,
  options: MenuOptions,
  close: (returnFocus: boolean) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  button.setAttribute("role", "menuitem");
  const label = document.createElement("span");
  label.className = "menu-label";
  label.textContent = entry.label;
  button.append(label);
  const detailText = entry.unavailable ?? entry.detail;
  if (detailText !== undefined) {
    const detail = document.createElement("span");
    detail.className = "menu-detail";
    detail.textContent = detailText;
    button.append(detail);
  }
  if (entry.unavailable !== undefined) {
    button.disabled = true;
    button.title = entry.unavailable;
  }
  button.addEventListener("click", () => {
    void entry.run().then((worked) => {
      label.textContent = worked
        ? (options.doneLabel ?? "Copied")
        : "Could not copy";
      window.setTimeout(() => close(true), worked ? 600 : 1500);
    });
  });
  return button;
}

// Under the trigger, its right edges aligned when the menu would otherwise run off the window, and
// above it when there is no room below.
function place(menu: HTMLElement, trigger: HTMLElement): void {
  const anchor = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left =
    anchor.left + width > window.innerWidth - 8
      ? Math.max(8, anchor.right - width)
      : anchor.left;
  const below = anchor.bottom + 4;
  const top =
    below + height > window.innerHeight - 8 && anchor.top - 4 - height > 8
      ? anchor.top - 4 - height
      : below;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}
