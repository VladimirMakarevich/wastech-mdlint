import { describe, expect, it } from "vitest";

import { safeChartOption } from "../src/client/chart-option.js";

// The option comes from a document, so every case starts from text through `JSON.parse`, exactly as
// the page gets it: whatever survives here is what ECharts is handed.
function safe(json: string): Record<string, unknown> {
  return safeChartOption(JSON.parse(json));
}

describe("safeChartOption", () => {
  it.each(["[1, 2]", '"bar"', "42", "null", "true"])(
    "refuses %s, which is not an option object",
    (json) => {
      expect(() => safe(json)).toThrow("the option must be a JSON object");
    },
  );

  // ECharts sets an HTML tooltip's formatter template as `innerHTML`; an author asking for HTML
  // explicitly must not get it either.
  it("draws the tooltip as canvas text, even when the option asks for HTML", () => {
    const option = safe(
      '{ "tooltip": { "renderMode": "html", "formatter": "<img src=x onerror=alert(1)>{b}" } }',
    );
    expect(option.tooltip).toEqual({
      renderMode: "richText",
      formatter: "<img src=x onerror=alert(1)>{b}",
    });
  });

  // The tooltip component reads `renderMode` from whichever config wins ECharts' merge, so a config
  // left in any of these places could switch HTML back on.
  it("switches every tooltip config, wherever in the option it sits", () => {
    const option = safe(`{
      "tooltip": [{ "renderMode": "html" }],
      "baseOption": { "tooltip": { "renderMode": "html" } },
      "options": [{ "tooltip": { "renderMode": "html" } }],
      "media": [{ "query": { "maxWidth": 500 }, "option": { "tooltip": {} } }],
      "legend": { "tooltip": { "show": true } },
      "series": [{
        "type": "pie",
        "tooltip": { "renderMode": "html" },
        "data": [{ "value": 1, "tooltip": { "formatter": "{b}" } }]
      }]
    }`);
    const modes: unknown[] = [];
    JSON.stringify(option, (key, value: unknown) => {
      if (key === "renderMode") {
        modes.push(value);
      }
      return value;
    });
    expect(modes).toEqual(Array(7).fill("richText"));
  });

  it("turns the examples' <br/> line breaks into newlines richText understands", () => {
    const option = safe(
      '{ "tooltip": { "formatter": "{a}<br/>{b}<BR>{c}<br />" }, "series": [{ "label": { "formatter": "{b}<br/>" } }] }',
    );
    expect(option.tooltip).toMatchObject({ formatter: "{a}\n{b}\n{c}\n" });
    // A label is drawn on the canvas already and is not a tooltip; it is left as written.
    expect(option.series).toEqual([{ label: { formatter: "{b}<br/>" } }]);
  });

  // The data view writes these two into the page as HTML; the rest of its config is harmless.
  it("drops the data view's HTML labels and keeps the rest of it", () => {
    const option = safe(
      '{ "toolbox": { "feature": { "dataView": { "readOnly": true, "title": "<img src=x>", "lang": ["<b>x</b>", "a", "b"] } } } }',
    );
    expect(option.toolbox).toEqual({
      feature: { dataView: { readOnly: true } },
    });
  });

  it("keeps only http(s) links on titles and chart nodes", () => {
    const option = safe(`{
      "title": [
        { "text": "a", "link": "javascript:alert(1)", "sublink": "https://example.com/sub" },
        { "text": "b", "link": "data:text/html,<script>alert(1)</script>", "sublink": "docs/guide.md" },
        { "text": "c", "link": "http://example.com/" }
      ],
      "series": [{ "type": "treemap", "data": [{ "name": "n", "value": 1, "link": " JavaScript:alert(1)" }] }],
      "axisPointer": { "link": [{ "xAxisIndex": "all" }] }
    }`);
    expect(option.title).toEqual([
      { text: "a", sublink: "https://example.com/sub" },
      { text: "b" },
      { text: "c", link: "http://example.com/" },
    ]);
    expect(option.series).toEqual([
      { type: "treemap", data: [{ name: "n", value: 1 }] },
    ]);
    // `axisPointer.link` is a list of linked axes, not a URL, and stays.
    expect(option.axisPointer).toEqual({ link: [{ xAxisIndex: "all" }] });
  });

  it("puts the chart on the page's background unless the author chose one", () => {
    expect(safe("{}").backgroundColor).toBe("transparent");
    expect(safe('{ "backgroundColor": "#fff" }').backgroundColor).toBe("#fff");
  });
});
