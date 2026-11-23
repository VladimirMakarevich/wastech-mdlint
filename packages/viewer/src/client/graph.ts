import { loadECharts } from "./echarts.js";
import { onServerEvent } from "./live-reload.js";
import { onThemeChange } from "./theme-toggle.js";

// The link graph, drawn in two places from the same code: the graph page, where the server renders
// the folder picker and a list of the documents in view, and a small graph beside each document of
// that document and its direct neighbors. Both fetch their view as JSON and draw it as a
// force-directed picture in which a click on a document opens it.

type GraphNode = {
  path: string;
  title: string;
  href: string;
  group: string;
  inDegree: number;
  outDegree: number;
};

type GraphView = {
  folder: string;
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
  focus: { path: string; neighbors: string[] } | null;
};

// The graph page has a legend, zooms and pans, and names documents as the reader zooms in. The local
// graph is too small for a legend, names every document at once, and leaves the mouse wheel to
// scroll the page it sits in.
type GraphKind = "page" | "local";

type ItemParams = { dataType?: string; dataIndex: number; name?: string };

type LabelLayoutParams = { dataType?: string; dataIndex: number };

// A name on every node of a graph this size is unreadable, so until the reader zooms in only the
// most linked-to documents are named.
const LABELED_NODES = 30;
const LABEL_FONT_SIZE = 11;

export function initGraph(): void {
  const canvas = document.querySelector<HTMLElement>(".graph-canvas");
  if (canvas === null) {
    return;
  }
  const form = document.querySelector<HTMLFormElement>(".graph-controls");
  if (form !== null) {
    // Picking a folder is the whole interaction, so it submits at once; the button is only for a page
    // without this script.
    form
      .querySelector("select")
      ?.addEventListener("change", () => form.requestSubmit());
    form.querySelector("button")?.setAttribute("hidden", "");
  }
  const params = new URLSearchParams({ folder: canvas.dataset.folder ?? "" });
  if (canvas.dataset.focus !== undefined) {
    params.set("focus", canvas.dataset.focus);
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
  const sized = new ResizeObserver(() => {
    if (canvas.clientWidth === 0) {
      return;
    }
    sized.disconnect();
    void draw(
      canvas,
      `/api/neighbors?${new URLSearchParams({ path }).toString()}`,
      "local",
    );
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
  let layout = layoutFor(view, canvas, kind);
  const chart = echarts.init(canvas);
  // The zoom the reader has reached, kept here because ECharts hands its label callback no current
  // zoom: the node box it passes was measured when the labels were created and never again.
  let zoom = layout.zoom ?? 1;
  chart.setOption(graphOption(view, layout, readColors(), () => zoom));
  // A zoom by a factor of one makes ECharts lay its labels out again and changes nothing else.
  const relayoutLabels = (): void =>
    chart.dispatchAction({
      type: "graphRoam",
      seriesIndex: 0,
      zoom: 1,
      originX: 0,
      originY: 0,
    });
  chart.on("click", ({ dataType, dataIndex }) => {
    const node = dataType === "node" ? view.nodes[dataIndex] : undefined;
    if (node !== undefined) {
      location.href = node.href;
    }
  });
  // The layout is sized for its box: its forces fill it and the focused document is pinned in its
  // middle. When the box changes for good — the window resized, a side column dragged wider — the
  // graph is laid out again for the new one, from where every document is and at the reader's zoom.
  // A drag resizes the box every frame, so that waits until the size has held for a moment; the
  // canvas itself follows every frame.
  let laidOutFor = { width: canvas.clientWidth, height: canvas.clientHeight };
  let resizeTimer: number | undefined;
  new ResizeObserver(() => {
    chart.resize();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (
        Math.abs(width - laidOutFor.width) < RELAYOUT_MIN_CHANGE &&
        Math.abs(height - laidOutFor.height) < RELAYOUT_MIN_CHANGE
      ) {
        return;
      }
      laidOutFor = { width, height };
      layout = {
        ...layoutFor(view, canvas, kind),
        zoom: undefined,
        minZoom: layout.minZoom,
        maxZoom: layout.maxZoom,
      };
      settleUntil = performance.now() + LAYOUT_SETTLE_MS;
      chart.setOption(graphOption(view, layout, readColors(), () => zoom));
    }, RELAYOUT_DELAY_MS);
  }).observe(canvas);

  // The reader's zoom arrives here after ECharts has already laid the labels out at the old one, so
  // they are laid out once more at the new one. The factor is clamped as ECharts clamps it; a pan
  // carries no factor, and the factor of one is this code's own relayout.
  chart.on("graphroam", ({ zoom: factor }) => {
    if (factor === undefined || factor === 1) {
      return;
    }
    zoom = Math.min(layout.maxZoom, Math.max(layout.minZoom, zoom * factor));
    relayoutLabels();
  });

  // ECharts settles a force layout over several seconds, but checks names for overlap only on the
  // first frame and on a zoom, so names that drift onto each other as documents move would stay
  // drawn on top of each other. Each check renders a frame and so raises `finished` again; the
  // deadline is what ends the loop once the layout has had time to settle, and it starts over
  // whenever the layout is set moving again: by a theme switch or by a dragged document.
  let settleUntil = performance.now() + LAYOUT_SETTLE_MS;
  let lastCheck = 0;
  chart.on("finished", () => {
    const now = performance.now();
    if (now > settleUntil || now - lastCheck < LABEL_CHECK_INTERVAL_MS) {
      return;
    }
    lastCheck = now;
    relayoutLabels();
  });
  chart.getZr().on("mouseup", () => {
    settleUntil = performance.now() + LAYOUT_SETTLE_MS;
  });

  // Every theme-dependent color of the graph comes from the page's tokens, so a theme switch only
  // passes them in again. ECharts' own `setTheme` would rebuild the series and lay the graph out from
  // scratch, scattering every document. The new option leaves the zoom out, so the reader's zoom
  // stays, and restarts the layout cool, from where each document is.
  onThemeChange(() => {
    settleUntil = performance.now() + LAYOUT_SETTLE_MS;
    chart.setOption(
      graphOption(
        view,
        { ...layout, zoom: undefined, friction: SETTLED_FRICTION },
        readColors(),
        () => zoom,
      ),
    );
  });
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

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : undefined;
  } catch {
    // The server is restarting; the page reloads once it is back.
    return undefined;
  }
}

// Room above the page graph for the legend.
const LEGEND_HEIGHT = 40;

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

// Nodes are laid out this many average node widths apart. Measured on the six hundred documents of a
// real repository: at the spacing that merely fits the box, nine documents in ten touched a
// neighbor; at four widths, with links one to two spacings long, one in twenty-five does.
const SPACING_IN_NODE_WIDTHS = 4;

type Layout = {
  kind: GraphKind;
  // The local graph sits in the narrow side column, so its documents and names are drawn smaller.
  nodeScale: number;
  fontSize: number;
  top: number;
  width: number;
  height: number;
  // The distance, in layout pixels, the layout keeps between documents.
  spacing: number;
  force: { gravity: number; repulsion: number; edgeLength: number[] };
  // Set on the first option only: a later one that carried it would undo the reader's zoom.
  zoom?: number;
  // Out to half the starting view, in to six times the layout's own scale.
  minZoom: number;
  maxZoom: number;
  friction?: number;
};

// Fixed forces suit one size of graph only: tuned for six hundred documents, a ten-document folder
// huddles in the middle; tuned for ten, six hundred pile on one another. Measured on ECharts' layout,
// n nodes under gravity g and repulsion r settle into a square about 2.7·√(n·r/g) pixels wide, so r is
// solved for the square the layout needs: the box when the documents fit in it at their spacing, or
// a larger square that the graph then starts zoomed out of, so the whole graph shows and nothing
// overlaps. Nodes scale with the zoom, so the gaps between them stay as wide as the layout made them.
function layoutFor(
  view: GraphView,
  canvas: HTMLElement,
  kind: GraphKind,
): Layout {
  const top = kind === "page" ? LEGEND_HEIGHT : 0;
  const nodeScale = kind === "page" ? 1 : 0.75;
  const box = 0.85 * Math.min(canvas.clientWidth, canvas.clientHeight - top);
  const count = Math.max(view.nodes.length, 1);
  const meanSize =
    (view.nodes.reduce((sum, node) => sum + nodeSize(node), 0) / count) *
    nodeScale;
  const spacing = SPACING_IN_NODE_WIDTHS * meanSize;
  const side = Math.max(box, spacing * Math.sqrt(count));
  const gravity = 0.2;
  return {
    kind,
    nodeScale,
    fontSize: kind === "page" ? LABEL_FONT_SIZE : 10,
    top,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    spacing,
    force: {
      gravity,
      repulsion: gravity * (side / (2.7 * Math.sqrt(count))) ** 2,
      // Most of a local graph is links from the document in its middle, so their length is what
      // spreads the neighbors over the box rather than leaving them in a knot around it.
      edgeLength:
        kind === "page" ? [spacing, 2 * spacing] : [box * 0.3, box * 0.45],
    },
    zoom: box / side,
    minZoom: box / side / 2,
    maxZoom: 6,
  };
}

// The page graph names a document once the zoom has opened the gaps between documents wide enough to
// read a name in: its label grows from nothing at the first of these on-screen spacings to full size
// at the second, so names come in gradually as the reader zooms rather than all at once.
const LABEL_SPACING_FROM = 26;
const LABEL_SPACING_TO = 40;

function graphOption(
  view: GraphView,
  layout: Layout,
  colors: GraphColors,
  zoomNow: () => number,
): object {
  // Sorted, so a folder keeps its color whichever document is focused.
  const groups = [...new Set(view.nodes.map((node) => node.group))].sort();
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const focus = view.focus;
  const lit =
    focus === null ? undefined : new Set([focus.path, ...focus.neighbors]);
  // Named whatever the zoom: everything in the local graph, the neighborhood of a focused document,
  // and otherwise the most linked-to documents.
  const named =
    layout.kind === "local"
      ? new Set(view.nodes.map((node) => node.path))
      : (lit ??
        new Set(
          [...view.nodes]
            .sort((left, right) => right.inDegree - left.inDegree)
            .slice(0, LABELED_NODES)
            .map((node) => node.path),
        ));
  const linkOpacity =
    focus === null || layout.kind === "local"
      ? LINK_OPACITY
      : FADED_LINK_OPACITY;
  const symbolSize = (node: GraphNode): number =>
    (node.path === focus?.path ? 26 : nodeSize(node)) * layout.nodeScale;

  return {
    // Text drawn on the canvas, never markup: titles and paths are repository content.
    tooltip: {
      renderMode: "richText",
      backgroundColor: colors.surface,
      borderColor: colors.muted,
      textStyle: { color: colors.text },
      formatter: ({ dataType, dataIndex }: ItemParams) => {
        if (dataType === "node") {
          const node = view.nodes[dataIndex];
          return node === undefined
            ? ""
            : `${node.title}\n${node.path}\n${node.inDegree} in · ${node.outDegree} out`;
        }
        const edge = view.edges[dataIndex];
        return edge === undefined ? "" : `${edge.from}\n→ ${edge.to}`;
      },
    },
    legend:
      layout.kind === "page"
        ? {
            type: "scroll",
            top: 0,
            data: groups,
            textStyle: { color: colors.text },
            inactiveColor: colors.muted,
            pageTextStyle: { color: colors.link },
            pageIconColor: colors.text,
            pageIconInactiveColor: colors.muted,
          }
        : { show: false },
    series: [
      {
        type: "graph",
        layout: "force",
        top: layout.top,
        roam: layout.kind === "page",
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
        data: view.nodes.map((node) => {
          const isFocus = node.path === focus?.path;
          const dimmed = lit !== undefined && !lit.has(node.path);
          return {
            id: node.path,
            name: node.path,
            category: groupIndex.get(node.group),
            // The focused document is pinned in the middle, so its neighbors gather where the reader
            // is looking; left to the layout it lands anywhere, often at an edge.
            ...(isFocus
              ? {
                  fixed: true,
                  x: layout.width / 2,
                  y: layout.top + (layout.height - layout.top) / 2,
                }
              : {}),
            symbolSize: symbolSize(node),
            // Outside the focused neighborhood a document turns neutral gray rather than
            // transparent: see-through color washes out to pastel on a light page and the graph's
            // shape is lost, while gray keeps every document visible and lets the lit ones lead.
            itemStyle: dimmed
              ? { color: colors.muted }
              : isFocus
                ? { borderColor: colors.accent, borderWidth: 2 }
                : undefined,
            label: {
              show: !dimmed,
              fontWeight: isFocus ? "bold" : undefined,
            },
          };
        }),
        // Arrowheads only on a focused document's own links. A filled head is far heavier than a
        // hairline, and the dozens that meet at a much-linked document pile up into a dark blot; the
        // direction of any link is in its tooltip.
        links: view.edges.map((edge) =>
          focus !== null && (edge.from === focus.path || edge.to === focus.path)
            ? {
                source: edge.from,
                target: edge.to,
                symbol: ["none", "arrow"],
                symbolSize: 6,
                lineStyle: { color: colors.accent, ...LIT_LINK },
                blur: { lineStyle: { opacity: LIT_LINK.opacity } },
              }
            : { source: edge.from, target: edge.to },
        ),
        lineStyle: { color: colors.link, width: 0.7, opacity: linkOpacity },
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
        // ECharts runs this for every label whenever it lays labels out, a zoom included, which is
        // what lets names come in with the zoom without a new option — and a new option would
        // restart the layout.
        labelLayout: ({ dataType, dataIndex }: LabelLayoutParams) => {
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
        },
        // Hovering a document lights its links and names its neighbors, and leaves everything else as
        // it was. ECharts' default fades all the rest to a tenth of its opacity, which on a graph of
        // hundreds of documents flashes the whole picture dark and back at every move of the pointer;
        // `blur` set to the resting look switches that fade off.
        emphasis: {
          focus: "adjacency",
          label: { show: true, fontSize: layout.fontSize },
          itemStyle: { borderColor: colors.accent, borderWidth: 1.5 },
          lineStyle: { color: colors.accent, width: 1.5, opacity: 1 },
        },
        blur: {
          itemStyle: { opacity: 1 },
          lineStyle: { opacity: linkOpacity },
          label: { opacity: 1 },
        },
        force: { ...layout.force, friction: layout.friction },
      },
    ],
  };
}

// By area rather than radius, so a document with four times the inbound links looks twice as wide
// rather than four times; a few hubs would otherwise cover the rest.
function nodeSize(node: GraphNode): number {
  return Math.min(24, 5 + 2.2 * Math.sqrt(node.inDegree));
}
