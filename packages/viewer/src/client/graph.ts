import { loadECharts, type ECharts } from "./echarts.js";
import {
  forceSeries,
  isOwnLink,
  LABEL_FONT_SIZE,
  layoutFor,
  type GraphKind,
  type GraphNode,
  type GraphView,
  type Layout,
} from "./graph-layout.js";
import { onServerEvent } from "./live-reload.js";
import { onThemeChange } from "./theme-toggle.js";

// The link graph, drawn in two places from the same code: the graph page, where the server renders
// the folder picker and a list of the documents in view, and a small graph beside each document of
// that document and its direct neighbors. Both fetch their view as JSON and draw it as a
// force-directed picture in which a click on a document opens it.

type ItemParams = { dataType?: string; dataIndex: number; name?: string };

type LabelLayoutParams = { dataType?: string; dataIndex: number };

// A name on every node of a graph this size is unreadable, so until the reader zooms in only the
// most linked-to documents are named.
const LABELED_NODES = 30;

export function initGraph(): void {
  const canvas = document.querySelector<HTMLElement>(".graph-canvas");
  if (canvas === null) {
    return;
  }
  const form = document.querySelector<HTMLFormElement>(".graph-controls");
  if (form !== null) {
    // Picking a folder is the whole interaction, so it submits at once; the button is only for a page
    // without this script.
    for (const field of form.querySelectorAll("select, input[type=checkbox]")) {
      field.addEventListener("change", () => {
        form.requestSubmit();
      });
    }
    form.querySelector("button")?.setAttribute("hidden", "");
  }
  const params = new URLSearchParams({ folder: canvas.dataset.folder ?? "" });
  if (canvas.dataset.focus !== undefined) {
    params.set("focus", canvas.dataset.focus);
  }
  if (canvas.dataset.changes === "1") {
    params.set("changes", "1");
  }
  void draw(canvas, `/api/graph?${params.toString()}`, "page");
}

export function initLocalGraph(): void {
  const canvas = document.querySelector<HTMLElement>(".local-graph-canvas");
  const path = canvas?.dataset.path;
  if (canvas === null || path === undefined) {
    return;
  }
  // The layout is sized from the box, and a box with no size cannot hold one: the server renders it
  // hidden, and on a narrow screen the whole side column is hidden by CSS. So it is drawn the first
  // time it has a size — at once on a wide screen, when the window widens on a narrow one, and never
  // on a phone, which then also never downloads ECharts for it.
  canvas.hidden = false;
  // How to zoom is not what a reader expects of a box in a side column, so it says so; without this
  // script there is no graph to zoom and the line stays hidden.
  const hint =
    canvas.parentElement?.querySelector<HTMLElement>(".local-graph-hint");
  if (hint !== null && hint !== undefined) {
    hint.hidden = false;
  }
  const sized = new ResizeObserver(() => {
    if (canvas.clientWidth === 0) {
      return;
    }
    sized.disconnect();
    const params = new URLSearchParams({ path });
    // Set on a changed document's page while it shows its changes.
    if (canvas.dataset.changes === "1") {
      params.set("changes", "1");
    }
    void draw(canvas, `/api/neighbors?${params.toString()}`, "local");
  });
  sized.observe(canvas);
}

async function draw(
  canvas: HTMLElement,
  url: string,
  kind: GraphKind,
): Promise<void> {
  const text = await fetchText(url);
  if (text === undefined) {
    return;
  }
  const view = JSON.parse(text) as GraphView;
  view.nodes = paintOrder(view);
  const echarts = await loadECharts();
  canvas.replaceChildren();
  const layout = layoutFor(view, boxOf(canvas), kind);
  const chart = echarts.init(canvas);
  new DrawnGraph({ canvas, chart, view, kind, layout }).start();
  // Saving a document can add or drop links without changing which documents exist, and that reloads
  // no page. The view is fetched again and the page reloaded only when it differs, because a reload
  // restarts the layout, and most saves change no link.
  onServerEvent("change", () => {
    void fetchText(url).then((next) => {
      if (next !== undefined && next !== text) {
        location.reload();
      }
    });
  });
}

type DrawnGraphInit = {
  canvas: HTMLElement;
  chart: ECharts;
  view: GraphView;
  kind: GraphKind;
  layout: Layout;
};

// One drawn graph and the state its handlers share: the layout it was last given, the zoom the reader
// has reached, and how long the layout is still left to settle.
class DrawnGraph {
  private readonly canvas: HTMLElement;
  private readonly chart: ECharts;
  private readonly view: GraphView;
  private readonly kind: GraphKind;
  private layout: Layout;
  // The zoom the reader has reached, kept here because ECharts hands its label callback no current
  // zoom: the node box it passes was measured when the labels were created and never again.
  private zoom: number;
  // ECharts settles a force layout over several seconds, but checks names for overlap only on the
  // first frame and on a zoom, so names that drift onto each other as documents move would stay
  // drawn on top of each other. Each check renders a frame and so raises `finished` again; the
  // deadline is what ends the loop once the layout has had time to settle, and it starts over
  // whenever the layout is set moving again: by a resize, a theme switch or a dragged document.
  private settleUntil = performance.now() + LAYOUT_SETTLE_MS;
  private lastCheck = 0;
  private laidOutFor = { width: 0, height: 0 };
  private resizeTimer: number | undefined;

  constructor(init: DrawnGraphInit) {
    this.canvas = init.canvas;
    this.chart = init.chart;
    this.view = init.view;
    this.kind = init.kind;
    this.layout = init.layout;
    this.zoom = init.layout.zoom ?? 1;
  }

  start(): void {
    this.chart.setOption(this.option(this.layout));
    this.chart.on("click", ({ dataType, dataIndex }) => {
      const node = dataType === "node" ? this.view.nodes[dataIndex] : undefined;
      if (node !== undefined) {
        location.href = node.href;
      }
    });
    this.watchResize();
    // The reader's zoom arrives here after ECharts has already laid the labels out at the old one, so
    // they are laid out once more at the new one. The factor is clamped as ECharts clamps it; a pan
    // carries no factor, and the factor of one is this code's own relayout.
    this.chart.on("graphroam", ({ zoom: factor }) => {
      if (factor === undefined || factor === 1) {
        return;
      }
      this.zoom = Math.min(
        this.layout.maxZoom,
        Math.max(this.layout.minZoom, this.zoom * factor),
      );
      this.relayoutLabels();
    });
    if (this.kind === "local") {
      this.zoomWithModifier();
    }
    this.keepLabelsApart();
    // Every theme-dependent color of the graph comes from the page's tokens, so a theme switch only
    // passes them in again. ECharts' own `setTheme` would rebuild the series and lay the graph out
    // from scratch, scattering every document. The new option leaves the zoom out, so the reader's
    // zoom stays, and restarts the layout cool, from where each document is.
    onThemeChange(() => {
      this.settleUntil = performance.now() + LAYOUT_SETTLE_MS;
      this.chart.setOption(
        this.option({
          ...this.layout,
          zoom: undefined,
          friction: SETTLED_FRICTION,
        }),
      );
    });
  }

  private option(layout: Layout): object {
    return graphOption(this.view, layout, readColors(), () => this.zoom);
  }

  // A zoom by a factor of one makes ECharts lay its labels out again and changes nothing else.
  private relayoutLabels(): void {
    this.chart.dispatchAction({
      type: "graphRoam",
      seriesIndex: 0,
      zoom: 1,
      originX: 0,
      originY: 0,
    });
  }

  // The layout is sized for its box: its forces fill it and the focused document is pinned in its
  // middle. When the box changes for good — the window resized, a side column dragged wider — the
  // graph is laid out again for the new one, from where every document is and at the reader's zoom.
  // A drag resizes the box every frame, so that waits until the size has held for a moment; the
  // canvas itself follows every frame.
  private watchResize(): void {
    this.laidOutFor = boxOf(this.canvas);
    new ResizeObserver(() => {
      this.chart.resize();
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.relayoutForBox();
      }, RELAYOUT_DELAY_MS);
    }).observe(this.canvas);
  }

  private relayoutForBox(): void {
    const { width, height } = boxOf(this.canvas);
    if (
      Math.abs(width - this.laidOutFor.width) < RELAYOUT_MIN_CHANGE &&
      Math.abs(height - this.laidOutFor.height) < RELAYOUT_MIN_CHANGE
    ) {
      return;
    }
    this.laidOutFor = { width, height };
    this.layout = {
      ...layoutFor(this.view, boxOf(this.canvas), this.kind),
      zoom: undefined,
      minZoom: this.layout.minZoom,
      maxZoom: this.layout.maxZoom,
    };
    this.settleUntil = performance.now() + LAYOUT_SETTLE_MS;
    this.chart.setOption(this.option(this.layout));
  }

  // In the side column the plain wheel scrolls the page, as it does everywhere else in the rail: a
  // graph that took it would stop the page whenever the pointer crossed the box. So the local graph
  // zooms with Ctrl or ⌘ held, which is also what a trackpad pinch sends. ECharts' wheel zoom cannot
  // be tied to a key, so this zooms through the same action ECharts' wheel dispatches, which applies
  // the zoom limits and reaches the `graphroam` handler like any other zoom.
  private zoomWithModifier(): void {
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        // Held Ctrl and a wheel otherwise zoom the whole page.
        event.preventDefault();
        const box = this.canvas.getBoundingClientRect();
        this.chart.dispatchAction({
          type: "graphRoam",
          seriesIndex: 0,
          zoom: wheelZoom(event),
          originX: event.clientX - box.left,
          originY: event.clientY - box.top,
        });
      },
      { passive: false },
    );
  }

  private keepLabelsApart(): void {
    this.chart.on("finished", () => {
      const now = performance.now();
      if (
        now > this.settleUntil ||
        now - this.lastCheck < LABEL_CHECK_INTERVAL_MS
      ) {
        return;
      }
      this.lastCheck = now;
      this.relayoutLabels();
    });
    this.chart.getZr().on("mouseup", () => {
      this.settleUntil = performance.now() + LAYOUT_SETTLE_MS;
    });
  }
}

// ECharts paints nodes in data order, so with a document focused its neighborhood goes last and no
// gray document is drawn over it. The click and the tooltip index into this same order.
function paintOrder(view: GraphView): GraphNode[] {
  if (view.focus === null) {
    return view.nodes;
  }
  const lit = new Set([view.focus.path, ...view.focus.neighbors]);
  return [
    ...view.nodes.filter((node) => !lit.has(node.path)),
    ...view.nodes.filter((node) => lit.has(node.path)),
  ];
}

// A notch of a mouse wheel arrives as about a hundred pixels, or as three lines in Firefox; a
// trackpad pinch as many events of a few pixels each. Both zoom by the same amount per pixel, and a
// notch by no more than the step ECharts' own wheel zoom takes on the graph page.
function wheelZoom(event: WheelEvent): number {
  const pixels =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 33
      : event.deltaY;
  return Math.min(1.4, Math.max(1 / 1.4, Math.exp(-pixels / 300)));
}

function boxOf(canvas: HTMLElement): { width: number; height: number } {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : undefined;
  } catch {
    // The server is restarting; the page reloads once it is back.
    return undefined;
  }
}

// ECharts' force layout runs about five hundred steps of sixteen milliseconds before it stops.
const LAYOUT_SETTLE_MS = 12_000;
const LABEL_CHECK_INTERVAL_MS = 250;
// A box that changes by less than this keeps its layout: a scrollbar coming and going is not worth
// setting every document moving.
const RELAYOUT_MIN_CHANGE = 8;
const RELAYOUT_DELAY_MS = 200;

// Links are thin and faint so the documents read first; with a document focused, the links that do
// not touch it fade a little further and its own are drawn in the accent color.
const LINK_OPACITY = 0.3;
const FADED_LINK_OPACITY = 0.15;
const LIT_LINK = { width: 1.2, opacity: 0.85 };
// In the local graph every link is the focused document's own or one between its neighbors, so at
// the page graph's weight the lit links alone fill the small box with solid accent color and the
// names between them stop reading. There they are hairlines, and the links between neighbors,
// which only add context, recede further.
const LOCAL_LINK_OPACITY = 0.18;
const LOCAL_LIT_LINK = { width: 0.8, opacity: 0.5 };

// Every color of the graph that differs between the themes: text, links, the documents outside a
// focused neighborhood, lit links, and the tooltip's box. Taken from the page's tokens rather than an
// ECharts theme, so the graph sits in the page's own palette; only the folder colors are ECharts'
// palette, which reads on both backgrounds.
type GraphColors = {
  text: string;
  link: string;
  muted: string;
  accent: string;
  surface: string;
  // The branch's changes, in the colors the tree's letters and the diffs use for them.
  added: string;
  removed: string;
  changed: string;
};

function readColors(): GraphColors {
  // A token holds `light-dark(…)`, which reads back unresolved from the property itself; the color
  // of an element that uses it comes back resolved for the scheme the page shows now.
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const read = (token: string): string => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  try {
    return {
      text: read("--fg"),
      link: read("--fg-muted"),
      muted: read("--border"),
      accent: read("--accent"),
      surface: read("--bg-subtle"),
      added: read("--diff-added"),
      removed: read("--diff-removed"),
      changed: read("--warning"),
    };
  } finally {
    probe.remove();
  }
}

// A layout restarted at ECharts' usual strength sets the documents that had not quite come to rest
// wandering again, by up to a hundred pixels on six hundred documents; restarted this cool, they stay
// within a pixel or two. The cost is that a document dragged afterwards pulls its neighbors along only
// weakly, since ECharts warms a drag up from the same starting value.
const SETTLED_FRICTION = 0.02;

// The page graph names a document once the zoom has opened the gaps between documents wide enough to
// read a name in: its label grows from nothing at the first of these on-screen spacings to full size
// at the second, so names come in gradually as the reader zooms rather than all at once.
const LABEL_SPACING_FROM = 26;
const LABEL_SPACING_TO = 40;

const CHANGE_NAMES: Record<NonNullable<GraphNode["change"]>, string> = {
  A: "Added in this branch",
  M: "Modified in this branch",
  D: "Deleted in this branch",
  R: "Renamed in this branch",
  affected: "Reached by this branch's changes",
};

// A changed document keeps its folder's fill and gets a ring in its change's color, so the folders
// still read; an affected one gets a dashed ring, being touched by the change rather than part of it.
function changeStyle(node: GraphNode, colors: GraphColors): object | undefined {
  switch (node.change) {
    case undefined:
      return undefined;
    case "affected":
      return {
        borderColor: colors.changed,
        borderWidth: 1.5,
        borderType: "dashed",
      };
    case "A":
      return { borderColor: colors.added, borderWidth: 2.5 };
    case "R":
      return { borderColor: colors.accent, borderWidth: 2.5 };
    default:
      return { borderColor: colors.changed, borderWidth: 2.5 };
  }
}

// What every part of one graph option reads: the view, its layout and colors, and what the focus
// lights.
type OptionContext = {
  view: GraphView;
  layout: Layout;
  colors: GraphColors;
  local: boolean;
  lit: Set<string> | undefined;
  laidOut: ReturnType<typeof forceSeries>;
};

function graphOption(
  view: GraphView,
  layout: Layout,
  colors: GraphColors,
  zoomNow: () => number,
): object {
  // Sorted, so a folder keeps its color whichever document is focused.
  const groups = [...new Set(view.nodes.map((node) => node.group))].sort();
  const focus = view.focus;
  const local = layout.kind === "local";
  const context: OptionContext = {
    view,
    layout,
    colors,
    local,
    lit: focus === null ? undefined : new Set([focus.path, ...focus.neighbors]),
    laidOut: forceSeries(view, layout),
  };
  const linkOpacity = linkOpacityFor(local, focus !== null);

  return {
    // ECharts draws its labels on the canvas in a font of its own, which the stylesheet cannot reach;
    // handed the page's, they follow the site font the reader chose like the rest of the page.
    textStyle: { fontFamily: getComputedStyle(document.body).fontFamily },
    // Text drawn on the canvas, never markup: titles and paths are repository content.
    tooltip: {
      renderMode: "richText",
      backgroundColor: colors.surface,
      borderColor: colors.muted,
      textStyle: { color: colors.text },
      formatter: (params: ItemParams) => tooltipText(view, params),
    },
    legend: legendOption(layout, groups, colors),
    series: [
      {
        type: "graph",
        layout: "force",
        ...context.laidOut,
        // The local graph pans by dragging; it zooms only by the wheel handler in `DrawnGraph`.
        roam: layout.kind === "page" ? true : "move",
        // Anywhere in the box, not only over the view's own rectangle, which ECharts scales with
        // the zoom: a graph that opens zoomed out to fit would otherwise answer the wheel and a drag
        // only in a patch around its middle, and the box's edges would ignore them.
        roamTrigger: "global",
        draggable: true,
        ...(layout.zoom === undefined
          ? {}
          : {
              zoom: layout.zoom,
              scaleLimit: { min: layout.minZoom, max: layout.maxZoom },
            }),
        // Nodes grow and shrink with the zoom exactly as the gaps between them do, so a graph that
        // starts zoomed out shows small documents with room around them rather than full-size ones
        // on top of each other.
        nodeScaleRatio: 1,
        categories: groups.map((name) => ({ name })),
        data: nodeData(context, groups),
        links: linkData(context),
        lineStyle: {
          color: colors.link,
          width: local ? 0.5 : 0.7,
          opacity: linkOpacity,
        },
        label: {
          position: "right",
          fontSize: layout.fontSize,
          color: colors.text,
          formatter: ({ name }: ItemParams) => name?.split("/").pop() ?? "",
          // In the narrow local graph a long name would run out of its box; it ends in an
          // ellipsis, and the tooltip has it in full.
          ...(layout.kind === "local"
            ? { width: 84, overflow: "truncate" }
            : {}),
        },
        labelLayout: labelLayoutFor(context, zoomNow),
        // Hovering a document lights its links and names its neighbors, and leaves everything else as
        // it was. ECharts' default fades all the rest to a tenth of its opacity, which on a graph of
        // hundreds of documents flashes the whole picture dark and back at every move of the pointer;
        // `blur` set to the resting look switches that fade off.
        emphasis: {
          focus: "adjacency",
          label: { show: true, fontSize: layout.fontSize },
          itemStyle: { borderColor: colors.accent, borderWidth: 1.5 },
          lineStyle: {
            color: colors.accent,
            width: local ? 1.1 : 1.5,
            opacity: 1,
          },
        },
        blur: {
          itemStyle: { opacity: 1 },
          lineStyle: { opacity: linkOpacity },
          label: { opacity: 1 },
        },
      },
    ],
  };
}

function linkOpacityFor(local: boolean, focused: boolean): number {
  if (local) {
    return LOCAL_LINK_OPACITY;
  }
  return focused ? FADED_LINK_OPACITY : LINK_OPACITY;
}

function tooltipText(
  view: GraphView,
  { dataType, dataIndex }: ItemParams,
): string {
  if (dataType === "node") {
    const node = view.nodes[dataIndex];
    return node === undefined
      ? ""
      : `${node.title}\n${node.path}\n${node.inDegree} in · ${node.outDegree} out${
          node.change === undefined ? "" : `\n${CHANGE_NAMES[node.change]}`
        }`;
  }
  const edge = view.edges[dataIndex];
  return edge === undefined
    ? ""
    : `${edge.from}\n→ ${edge.to}${
        edge.change === undefined
          ? ""
          : `\n${edge.change === "added" ? "Linked" : "Unlinked"} in this branch`
      }`;
}

function legendOption(
  layout: Layout,
  groups: readonly string[],
  colors: GraphColors,
): object {
  if (layout.kind !== "page") {
    return { show: false };
  }
  return {
    type: "scroll",
    top: 0,
    data: groups,
    textStyle: { color: colors.text },
    inactiveColor: colors.muted,
    pageTextStyle: { color: colors.link },
    pageIconColor: colors.text,
    pageIconInactiveColor: colors.muted,
  };
}

function nodeData(context: OptionContext, groups: readonly string[]): object[] {
  const { view, colors, lit, laidOut } = context;
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  return view.nodes.map((node, index) => {
    const isFocus = node.path === view.focus?.path;
    const dimmed = lit !== undefined && !lit.has(node.path);
    return {
      ...laidOut.data[index],
      name: node.path,
      category: groupIndex.get(node.group),
      itemStyle: nodeItemStyle(node, { isFocus, dimmed }, colors),
      label: {
        show: !dimmed,
        fontWeight: isFocus ? "bold" : undefined,
      },
    };
  });
}

// Outside the focused neighborhood a document turns neutral gray rather than transparent: see-through
// color washes out to pastel on a light page and the graph's shape is lost, while gray keeps every
// document visible and lets the lit ones lead.
function nodeItemStyle(
  node: GraphNode,
  state: { isFocus: boolean; dimmed: boolean },
  colors: GraphColors,
): object | undefined {
  if (state.dimmed) {
    return { color: colors.muted };
  }
  if (state.isFocus) {
    return { borderColor: colors.accent, borderWidth: 2 };
  }
  return changeStyle(node, colors);
}

// Arrowheads only on a focused document's own links. A filled head is far heavier than a hairline,
// and the dozens that meet at a much-linked document pile up into a dark blot; the direction of any
// link is in its tooltip.
function linkData(context: OptionContext): object[] {
  const { view, colors, local, laidOut } = context;
  const litLink = local ? LOCAL_LIT_LINK : LIT_LINK;
  return view.edges.map((edge, index) => ({
    ...laidOut.links[index],
    ...(edge.change === undefined
      ? {}
      : {
          lineStyle: {
            color: edge.change === "added" ? colors.added : colors.removed,
            type: edge.change === "removed" ? "dashed" : "solid",
            width: local ? 0.9 : 1.2,
            opacity: 0.9,
          },
        }),
    ...(isOwnLink(edge, view.focus) && edge.change === undefined
      ? {
          symbol: ["none", "arrow"],
          symbolSize: local ? 4 : 6,
          lineStyle: { color: colors.accent, ...litLink },
          blur: { lineStyle: { opacity: litLink.opacity } },
        }
      : {}),
  }));
}

// ECharts runs this for every label whenever it lays labels out, a zoom included, which is what lets
// names come in with the zoom without a new option — and a new option would restart the layout.
function labelLayoutFor(
  context: OptionContext,
  zoomNow: () => number,
): (params: LabelLayoutParams) => object {
  const { view, layout } = context;
  const named = namedNodes(context);
  return ({ dataType, dataIndex }: LabelLayoutParams) => {
    const node = dataType === "node" ? view.nodes[dataIndex] : undefined;
    if (node === undefined || named.has(node.path)) {
      return { hideOverlap: true };
    }
    const onScreenSpacing = zoomNow() * layout.spacing;
    const shown = Math.min(
      1,
      Math.max(
        0,
        (onScreenSpacing - LABEL_SPACING_FROM) /
          (LABEL_SPACING_TO - LABEL_SPACING_FROM),
      ),
    );
    return { hideOverlap: true, fontSize: LABEL_FONT_SIZE * shown };
  };
}

// Named whatever the zoom: everything in the local graph, the neighborhood of a focused document, and
// otherwise the most linked-to documents.
function namedNodes({ view, local, lit }: OptionContext): Set<string> {
  if (local) {
    return new Set(view.nodes.map((node) => node.path));
  }
  return (
    lit ??
    new Set(
      [...view.nodes]
        .sort((left, right) => right.inDegree - left.inDegree)
        .slice(0, LABELED_NODES)
        .map((node) => node.path),
    )
  );
}
