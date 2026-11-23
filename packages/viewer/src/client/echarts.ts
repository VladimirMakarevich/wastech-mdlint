import type { Theme } from "./theme-toggle.js";

// ECharts, loaded on demand by the two parts of the page that draw with it: the charts in a
// document and the link graph. It is over a megabyte, so a page without either never fetches it.

// The few calls the viewer makes, typed here rather than through the package's own declarations,
// which describe every option of every chart type and would make this small project compile the
// whole of them.
export type ECharts = {
  setOption(option: object, opts?: { notMerge?: boolean }): void;
  setTheme(theme: string): void;
  resize(): void;
  on(
    event: "click",
    handler: (params: { dataType?: string; dataIndex: number }) => void,
  ): void;
  on(event: "finished", handler: () => void): void;
  on(event: "graphroam", handler: (params: { zoom?: number }) => void): void;
  dispatchAction(payload: object): void;
  getZr(): { on(event: "mouseup", handler: () => void): void };
};

type EChartsModule = {
  init(element: HTMLElement, theme?: string): ECharts;
};

let echarts: Promise<EChartsModule> | undefined;

export function loadECharts(): Promise<EChartsModule> {
  // A variable, not a literal, so TypeScript does not try to resolve a URL as a module.
  const url = "/vendor/echarts/echarts.esm.min.mjs";
  echarts ??= import(url) as Promise<EChartsModule>;
  return echarts;
}

/**
 * The ECharts theme for the page's theme. ECharts registers `dark` itself, and `default` is the name
 * `setTheme` takes to switch back; neither needs a theme file from the viewer.
 */
export function echartsTheme(theme: Theme): string {
  return theme === "dark" ? "dark" : "default";
}
