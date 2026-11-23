import { safeChartOption } from "./chart-option.js";
import { echartsTheme, loadECharts, type ECharts } from "./echarts.js";
import { effectiveTheme, onThemeChange } from "./theme-toggle.js";

// The `echarts` blocks of a document, drawn from the JSON the server leaves in each
// `.echarts-chart`. A block the server already found invalid carries `data-state="invalid"` and its
// reason, and is left alone. The source stays in the page after drawing (hidden by CSS), so a chart
// that fails here still shows what its author wrote.

export function initCharts(): void {
  const blocks = document.querySelectorAll<HTMLElement>(
    ".echarts-chart:not([data-state])",
  );
  if (blocks.length === 0) {
    return;
  }
  const charts: ECharts[] = [];
  for (const block of blocks) {
    void draw(block).then((chart) => chart !== undefined && charts.push(chart));
  }
  // ECharts writes its colors into the canvas, so CSS cannot recolor a chart; the theme is switched
  // in place, which keeps the chart's state (a zoomed axis, a hidden series) as the reader left it.
  onThemeChange((theme) => {
    for (const chart of charts) {
      chart.setTheme(echartsTheme(theme));
    }
  });
}

async function draw(block: HTMLElement): Promise<ECharts | undefined> {
  const source = block.querySelector(".echarts-source")?.textContent ?? "";
  let canvas: HTMLElement | undefined;
  try {
    const option = safeChartOption(JSON.parse(source));
    const echarts = await loadECharts();
    canvas = document.createElement("div");
    canvas.className = "echarts-canvas";
    block.append(canvas);
    const chart = echarts.init(canvas, echartsTheme(effectiveTheme()));
    chart.setOption(option);
    // Also what draws a chart inside a closed <details>: it starts at zero size and gets its real
    // one when the section opens.
    new ResizeObserver(() => chart.resize()).observe(canvas);
    block.dataset.state = "rendered";
    return chart;
  } catch (error) {
    // The source stays on the page; the message says why it is not a picture.
    canvas?.remove();
    block.dataset.state = "failed";
    const message = document.createElement("p");
    message.className = "echarts-error";
    message.textContent = `Chart could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
    block.prepend(message);
    return undefined;
  }
}
