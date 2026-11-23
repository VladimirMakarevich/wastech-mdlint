// The handles on the inner edges of the two side columns: the document tree on the left and the rail
// of links, outline and backlinks on the right. Dragging a handle, or the arrow keys while it has
// focus, moves that edge; a double click puts the column's default width back. Each width lives in
// one custom property on <html> that the layout grid reads, and is remembered for this address:
// `theme.ts` restores it before the first paint, so a widened column does not jump back on every
// page.

type Column = {
  variable: string;
  // Shared with `theme.ts`.
  storageKey: string;
  // Which side of the column its handle sits on. Dragging a handle away from its column widens the
  // column: rightward on the tree's right edge, leftward on the rail's left edge.
  edge: "end" | "start";
};

const COLUMNS: Record<string, Column> = {
  sidebar: {
    variable: "--sidebar-width",
    storageKey: "wastech-mdlint-viewer:sidebar-width",
    edge: "end",
  },
  rail: {
    variable: "--rail-width",
    storageKey: "wastech-mdlint-viewer:rail-width",
    edge: "start",
  },
};

const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const KEY_STEP = 16;
// However wide the reader makes both columns, the article between them keeps this much room.
const MIN_ARTICLE_WIDTH = 360;

export function initColumnResize(): void {
  const handles = [
    ...document.querySelectorAll<HTMLElement>(".column-resizer"),
  ];
  for (const handle of handles) {
    const column = COLUMNS[handle.dataset.column ?? ""];
    const frame = handle.parentElement;
    if (column !== undefined && frame !== null) {
      attach(handle, frame, column, handles);
    }
  }
}

function attach(
  handle: HTMLElement,
  frame: HTMLElement,
  column: Column,
  handles: readonly HTMLElement[],
): void {
  // Rendered hidden by the server: without this script the handle could do nothing.
  handle.hidden = false;
  const root = document.documentElement;
  const outward = column.edge === "end" ? 1 : -1;
  const width = (): number => Math.round(frame.getBoundingClientRect().width);
  const maxWidth = (): number => {
    const others = handles
      .filter((other) => other !== handle)
      .reduce(
        (sum, other) =>
          sum + (other.parentElement?.getBoundingClientRect().width ?? 0),
        0,
      );
    return Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, window.innerWidth - others - MIN_ARTICLE_WIDTH),
    );
  };

  // A separator that can be focused is a control, and assistive technology reads its value.
  const describe = (current: number): void => {
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.setAttribute("aria-valuemax", String(maxWidth()));
    handle.setAttribute("aria-valuenow", String(current));
  };
  const apply = (next: number): void => {
    const clamped = Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, next)));
    root.style.setProperty(column.variable, `${clamped}px`);
    describe(clamped);
  };
  const remember = (): void => {
    try {
      localStorage.setItem(column.storageKey, String(width()));
    } catch {
      // Not remembered across pages, but applied to this one.
    }
  };
  describe(width());

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    // Keeps the drag from selecting the column's text.
    event.preventDefault();
    // Captured, so the drag follows the pointer past the handle's few pixels and over the article.
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width();
    document.body.classList.add("is-resizing-column");
    // Keeps this handle's line and grip shown while the pointer runs ahead of it, and the other
    // handle's hidden.
    handle.classList.add("is-dragging");
    const move = (moved: PointerEvent): void =>
      apply(startWidth + outward * (moved.clientX - startX));
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("is-resizing-column");
      handle.classList.remove("is-dragging");
      remember();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });

  // The arrow keys move the edge the way they point, as a drag would.
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP;
    apply(width() + outward * step);
    remember();
  });

  handle.addEventListener("dblclick", () => {
    root.style.removeProperty(column.variable);
    describe(width());
    try {
      localStorage.removeItem(column.storageKey);
    } catch {
      // Nothing stored to forget.
    }
  });
}
