import {
  type Frame,
  type Point,
  type Size,
  type ZoomView,
  clampView,
  fittedView,
  isFitted,
  panBy,
  toggleZoom,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
  zoomLabel,
} from "./image-zoom-model.js";

// Click an image in a document to see it enlarged over the page: fitted to the window first, then
// zoomed with the wheel, a pinch, a click or the toolbar, and moved by dragging. Escape, the close
// button or a click beside the image puts the page back as it was.
//
// An image inside a link is left alone: the author made it a link - a badge, a thumbnail pointing at
// something - and the click belongs to that link. So is an image that failed to load, which has
// nothing to enlarge.
//
// The view is one `<dialog>` built on first use and shown modal: the browser then keeps focus inside
// it, closes it on Escape and returns focus to the image it was opened from, and nothing here has to
// re-implement those.

// A pointer that moves this far between press and release was dragging the image, not clicking it.
const DRAG_THRESHOLD = 4;

type Viewer = {
  dialog: HTMLDialogElement;
  stage: HTMLElement;
  image: HTMLImageElement;
  caption: HTMLElement;
  level: HTMLElement;
  original: HTMLAnchorElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  fit: HTMLButtonElement;
  close: HTMLButtonElement;
};

// The open view, with the image's natural size and the stage size it was last computed for. Set by
// `show`, cleared when the dialog closes; the handlers wired once read it.
type OpenView = {
  frame: Frame;
  view: ZoomView;
};
let current: OpenView | undefined;

export function initImageZoom(): void {
  const images = [
    ...document.querySelectorAll<HTMLImageElement>(".markdown-body img"),
  ].filter((image) => image.closest("a") === null);
  if (images.length === 0) {
    return;
  }
  let viewer: Viewer | undefined;
  const open = (source: HTMLImageElement): void => {
    const size = naturalSize(source);
    if (size === undefined) {
      return;
    }
    viewer ??= buildViewer();
    show(viewer, source, size);
  };
  for (const image of images) {
    image.classList.add("zoomable");
    // Reachable from the keyboard as well as by the pointer, and announced as what it now does.
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-haspopup", "dialog");
    image.setAttribute(
      "aria-label",
      image.alt === "" ? "Enlarge image" : `Enlarge image: ${image.alt}`,
    );
    image.addEventListener("click", () => {
      open(image);
    });
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(image);
      }
    });
  }
}

// The image's own pixel size. An SVG with no width or height of its own reports none, and then the size
// it is drawn at in the document stands in; an image that never loaded has neither.
function naturalSize(image: HTMLImageElement): Size | undefined {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image.clientWidth > 0 && image.clientHeight > 0) {
    return { width: image.clientWidth, height: image.clientHeight };
  }
  return undefined;
}

function buildViewer(): Viewer {
  const dialog = document.createElement("dialog");
  dialog.className = "image-zoom";
  dialog.setAttribute("aria-label", "Enlarged image");

  const stage = element("div", "image-zoom-stage");
  const image = document.createElement("img");
  image.className = "image-zoom-image";
  image.draggable = false;
  stage.append(image);

  const caption = element("span", "image-zoom-caption");
  const level = element("span", "image-zoom-level");
  level.setAttribute("aria-live", "polite");
  const original = document.createElement("a");
  original.className = "image-zoom-original";
  original.textContent = "Open original";
  original.target = "_blank";
  original.rel = "noopener noreferrer";
  const viewer: Viewer = {
    dialog,
    stage,
    image,
    caption,
    level,
    original,
    zoomOut: button("−", "Zoom out"),
    zoomIn: button("+", "Zoom in"),
    fit: button("Fit", "Fit to window"),
    close: button("✕", "Close"),
  };
  const bar = element("div", "image-zoom-bar");
  bar.append(
    caption,
    viewer.zoomOut,
    level,
    viewer.zoomIn,
    viewer.fit,
    original,
    viewer.close,
  );
  dialog.append(stage, bar);
  document.body.append(dialog);

  wireControls(viewer);
  wireWheel(viewer);
  wirePointer(viewer);
  wireLifecycle(viewer);
  return viewer;
}

function element(tag: "div" | "span", className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(text: string, label: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.title = label;
  node.setAttribute("aria-label", label);
  return node;
}

function show(viewer: Viewer, source: HTMLImageElement, size: Size): void {
  // The address the document's image actually loaded - the browser has it cached, so the enlarged copy
  // appears at once instead of being fetched again.
  const address = source.currentSrc === "" ? source.src : source.currentSrc;
  viewer.image.src = address;
  viewer.image.alt = source.alt;
  viewer.image.style.width = `${String(size.width)}px`;
  viewer.image.style.height = `${String(size.height)}px`;
  viewer.caption.textContent = source.alt;
  viewer.caption.hidden = source.alt === "";
  // Only a file this server or another web address serves can be opened in a tab of its own; a
  // `data:` image is refused there by every current browser.
  const openable = /^https?:/i.test(address);
  viewer.original.hidden = !openable;
  if (openable) {
    viewer.original.href = address;
  } else {
    viewer.original.removeAttribute("href");
  }
  // Shown first, so the stage has the size it is measured at.
  viewer.dialog.showModal();
  const frame = { image: size, stage: stageSize(viewer) };
  current = { frame, view: fittedView(frame) };
  draw(viewer, false);
}

function stageSize(viewer: Viewer): Size {
  return {
    width: viewer.stage.clientWidth,
    height: viewer.stage.clientHeight,
  };
}

function draw(viewer: Viewer, smooth: boolean): void {
  if (current === undefined) {
    return;
  }
  const { scale, x, y } = current.view;
  viewer.image.classList.toggle("is-smooth", smooth);
  viewer.image.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
  viewer.level.textContent = zoomLabel(scale);
  viewer.stage.classList.toggle(
    "is-zoomed",
    !isFitted(current.view, current.frame),
  );
}

// Compute the next view against the stage as it is now. `next` also receives the frame the current
// view was computed for, which is how a resize tells a fitted view from a zoomed one.
function update(
  viewer: Viewer,
  smooth: boolean,
  next: (view: ZoomView, frame: Frame, before: Frame) => ZoomView,
): void {
  if (current === undefined) {
    return;
  }
  const frame = { image: current.frame.image, stage: stageSize(viewer) };
  current = { frame, view: next(current.view, frame, current.frame) };
  draw(viewer, smooth);
}

function zoomBy(
  viewer: Viewer,
  factor: number,
  point: Point,
  smooth: boolean,
): void {
  update(viewer, smooth, (view, frame) => zoomAt(view, factor, point, frame));
}

function fit(viewer: Viewer): void {
  update(viewer, true, (_view, frame) => fittedView(frame));
}

function stagePoint(viewer: Viewer, event: MouseEvent): Point {
  const box = viewer.stage.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function stageCenter(viewer: Viewer): Point {
  const stage = stageSize(viewer);
  return { x: stage.width / 2, y: stage.height / 2 };
}

// The toolbar, and the keys that do what its buttons do.
function wireControls(viewer: Viewer): void {
  const zoomIn = (): void => {
    zoomBy(viewer, ZOOM_STEP, stageCenter(viewer), true);
  };
  const zoomOut = (): void => {
    zoomBy(viewer, 1 / ZOOM_STEP, stageCenter(viewer), true);
  };
  const fitView = (): void => {
    fit(viewer);
  };
  viewer.zoomIn.addEventListener("click", zoomIn);
  viewer.zoomOut.addEventListener("click", zoomOut);
  viewer.fit.addEventListener("click", fitView);
  viewer.close.addEventListener("click", () => {
    viewer.dialog.close();
  });
  const keys = new Map<string, () => void>([
    ["+", zoomIn],
    ["=", zoomIn],
    ["-", zoomOut],
    ["_", zoomOut],
    ["0", fitView],
  ]);
  viewer.dialog.addEventListener("keydown", (event) => {
    // Ctrl or ⌘ with these keys zooms the whole page, which the reader may still want.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const action = keys.get(event.key);
    if (action !== undefined) {
      event.preventDefault();
      action();
    }
  });
}

function wireWheel(viewer: Viewer): void {
  // Not passive, so the page behind neither scrolls nor - for a pinch, which arrives as a wheel event
  // with Ctrl held - zooms as a whole.
  viewer.stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = wheelFactor(
        event.deltaY,
        event.deltaMode === WheelEvent.DOM_DELTA_LINE,
      );
      zoomBy(viewer, factor, stagePoint(viewer, event), false);
    },
    { passive: false },
  );
}

type Press = {
  id: number;
  start: Point;
  last: Point;
  onImage: boolean;
  moved: boolean;
};

// One press both drags and clicks, told apart by how far the pointer went: a drag moves the image, a
// click on the image zooms it, and a click beside the image closes the view, as clicking outside a
// picture laid over a page is expected to.
function wirePointer(viewer: Viewer): void {
  const { stage, image } = viewer;
  let press: Press | undefined;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const point = stagePoint(viewer, event);
    press = {
      id: event.pointerId,
      start: point,
      last: point,
      onImage: event.target === image,
      moved: false,
    };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (press?.id !== event.pointerId) {
      return;
    }
    const point = stagePoint(viewer, event);
    const travelled = Math.hypot(
      point.x - press.start.x,
      point.y - press.start.y,
    );
    if (!press.moved && travelled < DRAG_THRESHOLD) {
      return;
    }
    press.moved = true;
    stage.classList.add("is-dragging");
    const delta = { x: point.x - press.last.x, y: point.y - press.last.y };
    press.last = point;
    update(viewer, false, (view, frame) => panBy(view, delta, frame));
  });
  const release = (event: PointerEvent, cancelled: boolean): void => {
    if (press?.id !== event.pointerId) {
      return;
    }
    const { moved, onImage } = press;
    press = undefined;
    stage.classList.remove("is-dragging");
    if (cancelled || moved) {
      return;
    }
    if (!onImage) {
      viewer.dialog.close();
      return;
    }
    const point = stagePoint(viewer, event);
    update(viewer, true, (view, frame) => toggleZoom(view, point, frame));
  };
  stage.addEventListener("pointerup", (event) => {
    release(event, false);
  });
  stage.addEventListener("pointercancel", (event) => {
    release(event, true);
  });
}

function wireLifecycle(viewer: Viewer): void {
  // A window that changes size keeps a fitted image fitted, and holds a zoomed one inside the new
  // stage. Whether it was fitted is judged against the stage it was drawn on, not the new one, whose
  // fitted scale it no longer has.
  window.addEventListener("resize", () => {
    if (!viewer.dialog.open) {
      return;
    }
    update(viewer, false, (view, frame, before) =>
      isFitted(view, before) ? fittedView(frame) : clampView(view, frame),
    );
  });
  viewer.dialog.addEventListener("close", () => {
    current = undefined;
    // Dropped, so a large image's decoded pixels are not held for as long as the page stays open.
    viewer.image.removeAttribute("src");
  });
}
