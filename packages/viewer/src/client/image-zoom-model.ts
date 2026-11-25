// The arithmetic of the enlarged-image view, kept apart from the DOM so it can be tested without a
// browser. A view places the image's natural-size box on the stage: scaled by `scale` from its top-left
// corner, then moved to (`x`, `y`) in stage pixels - exactly the CSS `translate(x, y) scale(scale)`
// with a top-left transform origin, so what is computed here is what is drawn.

export type Size = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

/** The image's natural size and the stage it is drawn on: every computation here needs both. */
export type Frame = {
  image: Size;
  stage: Size;
};

export type ZoomView = {
  scale: number;
  x: number;
  y: number;
};

// Room left around a fitted image, so its edge never touches the stage's and the reader can still see
// it is a picture laid over the page rather than the page itself.
const FIT_MARGIN = 24;

// A small image - an icon, a badge - is enlarged to fit, but no further than this: blown up to fill a
// screen it shows nothing but its pixels.
const MAX_FIT_UPSCALE = 4;

// How far the reader can zoom in, relative to whichever is larger of the natural size and the fitted
// size: far enough to read a screenshot's smallest text, not so far that the image turns into tiles.
const MAX_ZOOM = 8;

// Each zoom button press or key, and the cap on one wheel event.
export const ZOOM_STEP = 1.25;

/** The scale at which the whole image fits the stage, inside its margin. */
export function fitScale({ image, stage }: Frame): number {
  if (image.width <= 0 || image.height <= 0) {
    return 1;
  }
  const width = Math.max(1, stage.width - 2 * FIT_MARGIN);
  const height = Math.max(1, stage.height - 2 * FIT_MARGIN);
  return Math.min(MAX_FIT_UPSCALE, width / image.width, height / image.height);
}

/** The range a scale is held to: down to the fitted size or natural size, whichever is smaller. */
export function scaleLimits(frame: Frame): { min: number; max: number } {
  const fit = fitScale(frame);
  return { min: Math.min(fit, 1), max: MAX_ZOOM * Math.max(fit, 1) };
}

/** The view that shows the whole image, centered. */
export function fittedView(frame: Frame): ZoomView {
  return clampView({ scale: fitScale(frame), x: 0, y: 0 }, frame);
}

/**
 * Keep the image where the reader can see it. Along an axis where the scaled image is narrower than
 * the stage it is centered, since there is nothing to pan to; along one where it is wider, it may move
 * only until its edge meets the stage's, so a drag can never lose the image off screen.
 */
export function clampView(view: ZoomView, frame: Frame): ZoomView {
  const { min, max } = scaleLimits(frame);
  const scale = Math.min(max, Math.max(min, view.scale));
  return {
    scale,
    x: clampAxis(view.x, frame.image.width * scale, frame.stage.width),
    y: clampAxis(view.y, frame.image.height * scale, frame.stage.height),
  };
}

function clampAxis(offset: number, extent: number, room: number): number {
  if (extent <= room) {
    return (room - extent) / 2;
  }
  return Math.min(0, Math.max(room - extent, offset));
}

/**
 * Zoom by `factor` about `point`, a stage position: the image pixel under it stays under it, so the
 * wheel or a click enlarges what the pointer is on rather than the image's corner.
 */
export function zoomAt(
  view: ZoomView,
  factor: number,
  point: Point,
  frame: Frame,
): ZoomView {
  const { min, max } = scaleLimits(frame);
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView(
    {
      scale,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    },
    frame,
  );
}

/** Move the image by a drag's distance, held to where it can still be seen. */
export function panBy(view: ZoomView, delta: Point, frame: Frame): ZoomView {
  return clampView(
    { scale: view.scale, x: view.x + delta.x, y: view.y + delta.y },
    frame,
  );
}

/** Whether the view is the fitted one, within rounding: a click then zooms in, otherwise back out. */
export function isFitted(view: ZoomView, frame: Frame): boolean {
  return Math.abs(view.scale / fitScale(frame) - 1) < 0.01;
}

/**
 * What a click on the image does. From the fitted view it zooms in about the click: to the natural size
 * when that is at least half again as large as the fitted one, since that is where every pixel of a
 * screenshot is readable; otherwise - an image shrunk only a little, or one that already fit at full
 * size - to twice the fitted size, so the click always visibly enlarges. From any other view it
 * returns to the fitted one.
 */
export function toggleZoom(
  view: ZoomView,
  point: Point,
  frame: Frame,
): ZoomView {
  if (!isFitted(view, frame)) {
    return fittedView(frame);
  }
  const fit = fitScale(frame);
  const target = 1 / fit >= 1.5 ? 1 : fit * 2;
  return zoomAt(view, target / view.scale, point, frame);
}

/**
 * The view after the stage changes size. A fitted image stays fitted to the new stage; a zoomed one
 * keeps its scale and is held inside the new stage. Whether it was fitted is judged against the stage
 * it was drawn on, not the new one, whose fitted scale it no longer has.
 */
export function resizeView(
  view: ZoomView,
  before: Frame,
  after: Frame,
): ZoomView {
  return isFitted(view, before) ? fittedView(after) : clampView(view, after);
}

// How far one arrow key press moves a zoomed image, in stage pixels.
export const PAN_STEP = 64;

export type KeyAction =
  | { kind: "zoom"; factor: number }
  | { kind: "fit" }
  | { kind: "pan"; delta: Point };

/**
 * What a key pressed in the enlarged view does: `+`/`=` and `-`/`_` zoom, `0` fits, and the arrows move
 * a zoomed image, so a reader without a pointer can reach every part of it. An arrow shows more of the
 * image on its side, which moves the image the other way. A key held with Ctrl, Alt or the Command key
 * does nothing here: with those the browser zooms the whole page, which the reader may still want.
 */
export function keyAction(
  key: string,
  modified: boolean,
): KeyAction | undefined {
  if (modified) {
    return undefined;
  }
  switch (key) {
    case "+":
    case "=":
      return { kind: "zoom", factor: ZOOM_STEP };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / ZOOM_STEP };
    case "0":
      return { kind: "fit" };
    case "ArrowLeft":
      return { kind: "pan", delta: { x: PAN_STEP, y: 0 } };
    case "ArrowRight":
      return { kind: "pan", delta: { x: -PAN_STEP, y: 0 } };
    case "ArrowUp":
      return { kind: "pan", delta: { x: 0, y: PAN_STEP } };
    case "ArrowDown":
      return { kind: "pan", delta: { x: 0, y: -PAN_STEP } };
    default:
      return undefined;
  }
}

/**
 * The zoom factor of one wheel event. A notch of a mouse wheel arrives as about a hundred pixels, or as
 * three lines in Firefox; a trackpad pinch as many events of a few pixels each. Both zoom by the same
 * amount per pixel, and a notch by no more than one zoom step.
 */
export function wheelFactor(deltaY: number, inLines: boolean): number {
  const pixels = inLines ? deltaY * 33 : deltaY;
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp(-pixels / 300)));
}

/** The zoom level as the toolbar shows it: the share of the image's natural size, in whole percent. */
export function zoomLabel(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}
