// A chart in a document is drawn from an option its author wrote as JSON, so the option is as
// untrusted as the Markdown around it. JSON already rules out code: it holds no functions, and the
// page parses it with `JSON.parse` and never evaluates it. What plain data can still do is reach the
// few places where ECharts writes markup into the page or opens a URL, and this module closes each:
//
// - Tooltips are HTML by default, and ECharts sets the formatter template as `innerHTML`. It escapes
//   the values it fills into `{a}`/`{b}`/`{c}`, but not the template, so `<img onerror=…>` written
//   there would become an element. Every tooltip is switched to `richText`, which draws it on the
//   canvas as text. A tooltip config can sit at the top level, in `baseOption`, a timeline step, a
//   media query, a series or a single data item, and the component reads `renderMode` from whichever
//   wins the merge, so every object under a `tooltip` key is switched, wherever it sits.
// - The toolbox's data view writes its `title` and `lang` strings into the page as HTML. They are
//   dropped, so it falls back to ECharts' own labels.
// - `link` and `sublink` (on a title, a treemap or a sunburst node) are opened with `window.open`
//   when clicked. Only an http(s) URL is kept: a `javascript:` URL would run in the viewer's origin
//   if the content security policy ever let it, and no other scheme belongs in a chart.
//
// This module has no DOM or ECharts dependency, so the tests run it in Node.

export type ChartOption = Record<string, unknown>;

// Tooltip templates in the ECharts examples break lines with `<br/>`, which richText would print
// literally; it breaks lines on `\n`.
const LINE_BREAK = /<br\s*\/?>/gi;

/** A parsed chart option made safe to hand to ECharts, or an error saying why it cannot be one. */
export function safeChartOption(value: unknown): ChartOption {
  if (!isRecord(value)) {
    throw new Error("the option must be a JSON object");
  }
  visit(value, undefined);
  // The dark theme paints a background of its own; transparent keeps the chart on the page's colors
  // in both themes, unless the author chose one.
  value.backgroundColor ??= "transparent";
  return value;
}

// Array items take their parent's key, so `tooltip: [{…}]` and `series: [{…}]` are seen as
// tooltips and series.
function visit(value: unknown, key: string | undefined): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, key);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (key === "tooltip") {
    value.renderMode = "richText";
    if (typeof value.formatter === "string") {
      value.formatter = value.formatter.replace(LINE_BREAK, "\n");
    }
  } else if (key === "dataView") {
    delete value.title;
    delete value.lang;
  }
  if (typeof value.link === "string" && !isWebUrl(value.link)) {
    delete value.link;
  }
  if (typeof value.sublink === "string" && !isWebUrl(value.sublink)) {
    delete value.sublink;
  }
  for (const [childKey, child] of Object.entries(value)) {
    visit(child, childKey);
  }
}

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is ChartOption {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
