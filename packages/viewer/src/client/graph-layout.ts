// Where the link graph's documents go: the forces ECharts' force layout is handed and the part of
// each node and link that steers it. Kept apart from the drawing, which needs the page, so the layout
// can be run to rest outside a browser and checked there.

export type GraphNode = {
  path: string;
  title: string;
  href: string;
  group: string;
  inDegree: number;
  outDegree: number;
  // With the branch's changes shown: its letter, or `affected` for an unchanged document it reaches.
  change?: "A" | "M" | "D" | "R" | "affected";
};

export type GraphView = {
  folder: string;
  nodes: GraphNode[];
  edges: { from: string; to: string; change?: "added" | "removed" }[];
  focus: { path: string; neighbors: string[] } | null;
};

// The graph page has a legend, zooms and pans, and names documents as the reader zooms in. The local
// graph is too small for a legend and names every document at once; it pans too, but zooms only
// with Ctrl or ⌘ held, leaving the plain wheel to scroll the page it sits in.
export type GraphKind = "page" | "local";

// The page graph's label size; its labels shrink from it as the reader zooms out.
export const LABEL_FONT_SIZE = 11;

// Room above the page graph for the legend.
const LEGEND_HEIGHT = 40;

// Nodes are laid out this many average node widths apart. Measured on the six hundred documents of a
// real repository, running ECharts' layout to rest: at the spacing that merely fits the box, nine
// documents in ten touched a neighbor; at four widths, with every node repelling alike and links one
// to two spacings long, one in thirty did, mostly the large, much-linked ones. At six widths, with
// the repulsion and link lengths `layoutFor` derives from each document's size, none touch and one
// in thirty comes within half their widths again of another.
const SPACING_IN_NODE_WIDTHS = 6;
// The empty space a link leaves between the edges of the two documents it joins.
const LINK_GAP_IN_SPACINGS = 1;

// The local graph's neighbors sit on a ring this fraction of the box from the pinned document, or on
// a wider one the graph starts zoomed out of when that many neighbors would not fit round it this
// many average node widths apart. Less than the page graph's spacing: a ring has no crowded middle
// to keep documents out of, only room for each neighbor and the line of its name, and at the page
// graph's spacing a document with a dozen neighbors would already open zoomed out, every node small.
const LOCAL_RING = 0.4;
const LOCAL_ARC_IN_NODE_WIDTHS = 3;

export type Layout = {
  kind: GraphKind;
  // The local graph sits in the narrow side column, so its documents and names are drawn smaller.
  nodeScale: number;
  fontSize: number;
  top: number;
  width: number;
  height: number;
  // The distance, in layout pixels, the layout keeps between documents.
  spacing: number;
  // The empty space the page graph's links leave between the documents they join, and the radius of
  // the local graph's ring; `linkLength` turns them into each link's length.
  gap: number;
  ring: number;
  // Both ranges are what ECharts maps each node's and each link's `value` onto; `forceSeries` sets
  // those values from the same drawn sizes `layoutFor` measured.
  force: {
    gravity: number;
    repulsion: [number, number];
    edgeLength: [number, number];
  };
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
//
// One repulsion for every node would give a hub the same room as a leaf, though it is several times
// as wide and every one of its links pulls it toward the crowded middle; that is where documents
// still landed on each other. So each node repels in proportion to its area - scaled so the mean
// stays the repulsion solved for above - and a link is as long as the gap the layout keeps plus the
// radii of the two documents it joins, so two linked hubs end the same gap apart as two leaves.
//
// A local graph is a ring of neighbors around the pinned document instead, every link that shapes it
// the ring's radius long. ECharts moves a node by each other node's repulsion divided by their
// distance, and on a ring of n neighbors those pushes add up to (n + 1)·r / R straight outward -
// one r / R from each other neighbor, two from the pinned document - against gravity's g·R inward.
// So r = g·R² / (n + 1) is the one repulsion that holds the ring at its radius with no help from the
// links, and it then spreads the neighbors evenly round it. Measured on a fourteen-neighbor document:
// with the page graph's repulsion and every link pulling, they settled from 27 to 76 pixels out with
// gaps between them from 6 to 63 degrees; with these, all at the radius and every gap 26 degrees.
export function layoutFor(
  view: GraphView,
  canvas: { width: number; height: number },
  kind: GraphKind,
): Layout {
  const top = kind === "page" ? LEGEND_HEIGHT : 0;
  const nodeScale = kind === "page" ? 1 : 0.75;
  const box = 0.85 * Math.min(canvas.width, canvas.height - top);
  const count = Math.max(view.nodes.length, 1);
  const sizes = view.nodes.map((node) =>
    drawnSize(node, view.focus, nodeScale),
  );
  const meanSize = sizes.reduce((sum, size) => sum + size, 0) / count;
  // An empty view has no sizes; the one keeps the repulsion a number.
  const meanArea = sizes.reduce((sum, size) => sum + size ** 2, 0) / count || 1;
  const [smallest, largest] = extent(sizes);
  const spacing = SPACING_IN_NODE_WIDTHS * meanSize;
  const side = Math.max(box, spacing * Math.sqrt(count));
  const gravity = 0.2;
  const gap = LINK_GAP_IN_SPACINGS * spacing;
  const neighbors = Math.max(count - 1, 1);
  const ring = Math.max(
    LOCAL_RING * box,
    (neighbors * LOCAL_ARC_IN_NODE_WIDTHS * meanSize) / (2 * Math.PI),
  );
  const repulsion =
    kind === "page"
      ? gravity * (side / (2.7 * Math.sqrt(count))) ** 2
      : (gravity * ring ** 2) / (neighbors + 1);
  // On the ring every node must push alike for the balance above to hold; the pinned document's
  // larger area would only push its neighbors out past the radius.
  const [weakest, strongest] =
    kind === "page"
      ? [
          (repulsion * smallest ** 2) / meanArea,
          (repulsion * largest ** 2) / meanArea,
        ]
      : [repulsion, repulsion];
  const zoom = kind === "page" ? box / side : (LOCAL_RING * box) / ring;
  const sizeOf = new Map(
    view.nodes.map((node, index) => [node.path, sizes[index] ?? 0]),
  );
  const [shortestLink, longestLink] = extent(
    view.edges.map((edge) =>
      linkLength(
        { kind, gap, ring },
        sizeOf.get(edge.from) ?? 0,
        sizeOf.get(edge.to) ?? 0,
      ),
    ),
  );
  return {
    kind,
    nodeScale,
    fontSize: kind === "page" ? LABEL_FONT_SIZE : 10,
    top,
    width: canvas.width,
    height: canvas.height,
    spacing,
    gap,
    ring,
    force: {
      gravity,
      repulsion: [weakest, strongest],
      // A link's `value` is its length, and ECharts maps the smallest value in the view onto the
      // range's second end and the largest onto its first, linearly between them - so this range,
      // written longest first, hands every link back exactly the length it asked for.
      edgeLength: [longestLink, shortestLink],
    },
    zoom,
    minZoom: zoom / 2,
    maxZoom: 6,
  };
}

export type ForceNode = {
  id: string;
  symbolSize: number;
  value: number;
  fixed?: true;
  x?: number;
  y?: number;
};

export type ForceLink = {
  source: string;
  target: string;
  value: number;
  ignoreForceLayout?: true;
};

/**
 * Whether a link is the focused document's own: the graph lights those, and the local graph is laid
 * out by them alone.
 */
export function isOwnLink(
  edge: GraphView["edges"][number],
  focus: GraphView["focus"],
): boolean {
  return focus !== null && (edge.from === focus.path || edge.to === focus.path);
}

export type ForceSeries = {
  top: number;
  bottom: number;
  force: Layout["force"] & { friction?: number; layoutAnimation: boolean };
  data: ForceNode[];
  links: ForceLink[];
};

// The most documents a local graph is laid out at once rather than step by step. ECharts runs about
// five hundred steps, each weighing every document against every other: for a few dozen that is a
// few milliseconds before the first frame, while a hub with hundreds of neighbors would hold the page
// up for a noticeable moment, and is drawn settling instead.
const LOCAL_LAID_OUT_AT_ONCE = 120;

/** Whether ECharts lays the graph out before drawing it, rather than drawing it as it settles. */
export function laidOutAtOnce(view: GraphView, kind: GraphKind): boolean {
  return kind === "local" && view.nodes.length <= LOCAL_LAID_OUT_AT_ONCE;
}

/**
 * Everything in the graph series that steers the layout, with nodes and links in the view's order. A
 * node's value is its area, which ECharts maps onto the repulsion range, so a wide document keeps a
 * wide berth; a link's value is the length the layout gives it. In the local graph a link between
 * two neighbors is drawn but does not pull: it would drag the two off the ring toward each other,
 * and a neighborhood whose neighbors link to one another then folds into a knot beside the pinned
 * document.
 */
export function forceSeries(view: GraphView, layout: Layout): ForceSeries {
  const focus = view.focus;
  const size = new Map(
    view.nodes.map((node) => [
      node.path,
      drawnSize(node, focus, layout.nodeScale),
    ]),
  );
  // The focused document is pinned in the middle, so its neighbors gather where the reader is
  // looking; left to the layout it lands anywhere, often at an edge.
  const middle = {
    x: layout.width / 2,
    y: layout.top + (layout.height - layout.top) / 2,
  };
  return {
    // The layout works in the box's own pixels only while the series fills the box below `top`;
    // ECharts' default height is four fifths of it, which left the pinned document a tenth of the
    // box above the middle and the bottom fifth always empty.
    top: layout.top,
    bottom: 0,
    // The local graph is drawn where it comes to rest. Laid out step by step, its neighbors drifted
    // onto their ring for the first seconds of every document page, still moving after the page had
    // settled; the page graph is opened on purpose, and settling is part of reading it.
    force: {
      ...layout.force,
      friction: layout.friction,
      layoutAnimation: !laidOutAtOnce(view, layout.kind),
    },
    data: view.nodes.map((node) => {
      const symbolSize = size.get(node.path) ?? 0;
      return {
        id: node.path,
        symbolSize,
        value: symbolSize ** 2,
        ...(node.path === focus?.path ? { fixed: true, ...middle } : {}),
      };
    }),
    links: view.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      value: linkLength(
        layout,
        size.get(edge.from) ?? 0,
        size.get(edge.to) ?? 0,
      ),
      // A link the branch removed is drawn for the reader but is no link any more, so it must not
      // pull its documents together and make the picture differ from the one without changes.
      ...((layout.kind === "local" && !isOwnLink(edge, focus)) ||
      edge.change === "removed"
        ? { ignoreForceLayout: true }
        : {}),
    })),
  };
}

// By area rather than radius, so a document with four times the inbound links looks twice as wide
// rather than four times; a few hubs would otherwise cover the rest.
function nodeSize(node: GraphNode): number {
  return Math.min(24, 5 + 2.2 * Math.sqrt(node.inDegree));
}

// The width a document is drawn at, which is also what the layout gives room to: the focused one is
// drawn large whatever its links.
function drawnSize(
  node: GraphNode,
  focus: GraphView["focus"],
  nodeScale: number,
): number {
  return (node.path === focus?.path ? 26 : nodeSize(node)) * nodeScale;
}

// How long the layout makes a link between documents drawn at these two sizes. In the local graph
// the links that count are the pinned document's own, each a spoke of the ring; the others do not
// pull at all, so their length is never used.
function linkLength(
  layout: Pick<Layout, "kind" | "gap" | "ring">,
  size: number,
  otherSize: number,
): number {
  return layout.kind === "local"
    ? layout.ring
    : layout.gap + (size + otherSize) / 2;
}

// The smallest and largest of a list, without spreading it into `Math.min`, which runs out of stack
// on a large enough repository's links.
function extent(values: readonly number[]): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return values.length === 0 ? [0, 0] : [low, high];
}
