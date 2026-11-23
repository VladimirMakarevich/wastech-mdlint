import type { Theme } from "./theme-toggle.js";

// ECharts, loaded on demand by the charts in a document. It is over a megabyte, so a page without
// one never fetches it.

// The few calls the viewer makes, typed here rather than through the package's own declarations,
// which describe every option of every chart type and would make this small project compile the
// whole of them.
export type ECharts = {
  setOption(option: object, opts?: { notMerge?: boolean }): void;
  setTheme(theme: string): void;
  resize(): void;
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
