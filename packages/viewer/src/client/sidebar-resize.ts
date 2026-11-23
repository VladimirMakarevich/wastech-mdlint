// The handle on the document tree's right edge. Dragging it, or the arrow keys while it has focus,
// sets the tree's width; a double click puts the default back. The width lives in one custom
// property on <html> that the layout grid reads, and is remembered for this address: `theme.ts`
// restores it before the first paint, so a widened tree does not jump back on every page.

// Shared with `theme.ts`.
const STORAGE_KEY = "wastech-mdlint-viewer:sidebar-width";
const MIN_WIDTH = 200;
const KEY_STEP = 16;

// Half the window at most, so the article always keeps room to be read.
function maxWidth(): number {
  return Math.min(640, Math.round(window.innerWidth / 2));
}

export function initSidebarResize(): void {
  const handle = document.querySelector<HTMLElement>(".sidebar-resizer");
  const frame = handle?.parentElement;
  if (handle === null || frame === null || frame === undefined) {
    return;
  }
  // Rendered hidden by the server: without this script the handle could do nothing.
  handle.hidden = false;
  const root = document.documentElement;
  const width = (): number => Math.round(frame.getBoundingClientRect().width);

  const apply = (next: number): void => {
    const clamped = Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, next)));
    root.style.setProperty("--sidebar-width", `${clamped}px`);
    describe(clamped);
  };
  const remember = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width()));
    } catch {
      // Not remembered across pages, but applied to this one.
    }
  };
  // A separator that can be focused is a control, and assistive technology reads its value.
  const describe = (current: number): void => {
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.setAttribute("aria-valuemax", String(maxWidth()));
    handle.setAttribute("aria-valuenow", String(current));
  };
  describe(width());

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    // Keeps the drag from selecting the tree's text.
    event.preventDefault();
    // Captured, so the drag follows the pointer past the handle's few pixels and over the article.
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width();
    document.body.classList.add("is-resizing-sidebar");
    const move = (moved: PointerEvent): void =>
      apply(startWidth + moved.clientX - startX);
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("is-resizing-sidebar");
      remember();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    apply(width() + (event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP));
    remember();
  });

  handle.addEventListener("dblclick", () => {
    root.style.removeProperty("--sidebar-width");
    describe(width());
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored to forget.
    }
  });
}
