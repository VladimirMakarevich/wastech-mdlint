import { describe, expect, it } from "vitest";

import {
  clampView,
  fitScale,
  fittedView,
  isFitted,
  keyAction,
  PAN_STEP,
  panBy,
  resizeView,
  scaleLimits,
  toggleZoom,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
  zoomLabel,
} from "../src/client/image-zoom-model.js";

// A stage of 1048 x 848 leaves exactly 1000 x 800 inside the fitted image's margin.
const STAGE = { width: 1048, height: 848 };
const SCREENSHOT = { width: 2000, height: 1000 };
const FRAME = { image: SCREENSHOT, stage: STAGE };

// Where an image pixel lands on the stage under a view: the CSS transform the view is drawn with.
const onStage = (
  view: { scale: number; x: number; y: number },
  pixel: { x: number; y: number },
): { x: number; y: number } => ({
  x: view.x + pixel.x * view.scale,
  y: view.y + pixel.y * view.scale,
});

describe("fitScale", () => {
  it("shrinks a large image until it fits inside the margin", () => {
    expect(fitScale(FRAME)).toBe(0.5);
  });

  it("enlarges a small image to fit, but no more than four times", () => {
    expect(fitScale({ image: { width: 500, height: 400 }, stage: STAGE })).toBe(
      2,
    );
    expect(fitScale({ image: { width: 16, height: 16 }, stage: STAGE })).toBe(
      4,
    );
  });

  it("does not divide by an image with no size", () => {
    expect(fitScale({ image: { width: 0, height: 0 }, stage: STAGE })).toBe(1);
  });
});

describe("fittedView", () => {
  it("centers the fitted image along the axis it does not fill", () => {
    // 2000 x 1000 at 0.5 is 1000 x 500: 24 px of margin across, 174 px above and below.
    expect(fittedView(FRAME)).toEqual({
      scale: 0.5,
      x: 24,
      y: 174,
    });
  });
});

describe("clampView", () => {
  it("never lets a zoomed image be dragged off the stage", () => {
    const view = clampView({ scale: 1, x: 500, y: -5000 }, FRAME);
    // At full size the image is 2000 x 1000: its left edge stops at the stage's left, and its
    // bottom edge at the stage's bottom.
    expect(view).toEqual({ scale: 1, x: 0, y: STAGE.height - 1000 });
  });

  it("holds the scale inside the limits", () => {
    const { min, max } = scaleLimits(FRAME);
    expect(clampView({ scale: 0.01, x: 0, y: 0 }, FRAME).scale).toBe(min);
    expect(clampView({ scale: 1000, x: 0, y: 0 }, FRAME).scale).toBe(max);
  });
});

describe("zoomAt", () => {
  it("keeps the image pixel under the pointer where it was", () => {
    const start = fittedView(FRAME);
    const pointer = { x: 600, y: 400 };
    // The image pixel under the pointer before zooming.
    const pixel = {
      x: (pointer.x - start.x) / start.scale,
      y: (pointer.y - start.y) / start.scale,
    };
    const zoomed = zoomAt(start, 2, pointer, FRAME);
    expect(zoomed.scale).toBe(1);
    const landed = onStage(zoomed, pixel);
    expect(landed.x).toBeCloseTo(pointer.x);
    expect(landed.y).toBeCloseTo(pointer.y);
  });

  it("stops at the largest scale however often it is asked for more", () => {
    let view = fittedView(FRAME);
    for (let step = 0; step < 100; step += 1) {
      view = zoomAt(view, ZOOM_STEP, { x: 500, y: 400 }, FRAME);
    }
    expect(view.scale).toBe(scaleLimits(FRAME).max);
  });
});

describe("panBy", () => {
  it("moves a zoomed image by the drag's distance", () => {
    const view = { scale: 1, x: -400, y: -100 };
    expect(panBy(view, { x: 50, y: -20 }, FRAME)).toEqual({
      scale: 1,
      x: -350,
      y: -120,
    });
  });

  it("does not move an image that fits, since there is nothing to pan to", () => {
    const view = fittedView(FRAME);
    expect(panBy(view, { x: 300, y: 300 }, FRAME)).toEqual(view);
  });
});

describe("toggleZoom", () => {
  it("zooms a shrunk image to its natural size, and back to fit", () => {
    const fitted = fittedView(FRAME);
    const zoomed = toggleZoom(fitted, { x: 524, y: 424 }, FRAME);
    expect(zoomed.scale).toBe(1);
    expect(isFitted(zoomed, FRAME)).toBe(false);
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, FRAME)).toEqual(fitted);
  });

  it("doubles an image that already fit at full size, so a click always enlarges", () => {
    const small = {
      image: { width: 500, height: 400 },
      stage: STAGE,
    };
    const fitted = fittedView(small);
    expect(toggleZoom(fitted, { x: 524, y: 424 }, small).scale).toBe(4);
  });
});

describe("wheelFactor", () => {
  it("zooms in on a wheel turned away from the reader and out on one turned toward them", () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
  });

  it("zooms a notch by no more than one step, whether it arrives in pixels or in lines", () => {
    expect(wheelFactor(-10_000, false)).toBe(ZOOM_STEP);
    expect(wheelFactor(10_000, false)).toBe(1 / ZOOM_STEP);
    expect(wheelFactor(-3, true)).toBe(wheelFactor(-99, false));
  });
});

describe("zoomLabel", () => {
  it("shows the share of the natural size in whole percent", () => {
    expect(zoomLabel(0.5)).toBe("50%");
    expect(zoomLabel(1.234)).toBe("123%");
  });
});

describe("toggleZoom between fit and natural size", () => {
  // At 70% the natural size is about 1.43 times the fitted one, too small a step to read as a zoom,
  // so the click doubles instead; at 60% the natural size is two-thirds larger and the click goes
  // there. Fit 0.5 alone cannot tell the two rules apart, since both give 1.
  it.each([
    [1600, 1],
    [1666, 1],
    [1428, 1.4],
  ])("fits a %d px wide image, then zooms it to %d", (width, scale) => {
    const frame = { image: { width, height: 100 }, stage: STAGE };
    const fitted = fittedView(frame);
    expect(toggleZoom(fitted, { x: 524, y: 424 }, frame).scale).toBeCloseTo(
      scale,
      2,
    );
  });
});

describe("resizeView", () => {
  const smaller = { image: SCREENSHOT, stage: { width: 648, height: 448 } };

  it("keeps a fitted image fitted to the new stage", () => {
    expect(resizeView(fittedView(FRAME), FRAME, smaller)).toEqual(
      fittedView(smaller),
    );
  });

  it("keeps a zoomed image's scale and holds it inside the new stage", () => {
    const zoomed = { scale: 1, x: -1000, y: -200 };
    expect(resizeView(zoomed, FRAME, smaller)).toEqual({
      scale: 1,
      x: -1000,
      y: -200,
    });
    const wider = { image: SCREENSHOT, stage: { width: 1800, height: 900 } };
    // The old offset would leave 800 px of empty stage on the right; it moves only as far as needed.
    expect(resizeView(zoomed, FRAME, wider)).toEqual({
      scale: 1,
      x: -200,
      y: -100,
    });
  });
});

describe("keyAction", () => {
  it("zooms, fits and pans on the viewer's own keys", () => {
    expect(keyAction("+", false)).toEqual({ kind: "zoom", factor: ZOOM_STEP });
    expect(keyAction("=", false)).toEqual({ kind: "zoom", factor: ZOOM_STEP });
    expect(keyAction("-", false)).toEqual({
      kind: "zoom",
      factor: 1 / ZOOM_STEP,
    });
    expect(keyAction("0", false)).toEqual({ kind: "fit" });
    // An arrow shows more of the image on its side, so the image moves the other way.
    expect(keyAction("ArrowRight", false)).toEqual({
      kind: "pan",
      delta: { x: -PAN_STEP, y: 0 },
    });
    expect(keyAction("ArrowUp", false)).toEqual({
      kind: "pan",
      delta: { x: 0, y: PAN_STEP },
    });
  });

  it("leaves a modified key to the browser, which zooms the page with it", () => {
    expect(keyAction("+", true)).toBeUndefined();
    expect(keyAction("0", true)).toBeUndefined();
  });

  it("does nothing for the page's own shortcut keys", () => {
    for (const key of ["n", "p", "v", "/", "k"]) {
      expect(keyAction(key, false)).toBeUndefined();
    }
  });
});
