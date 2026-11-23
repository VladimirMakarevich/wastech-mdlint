import * as echarts from "echarts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forceSeries,
  layoutFor,
  type GraphKind,
  type GraphNode,
  type GraphView,
} from "../src/client/graph-layout.js";

// These run ECharts' own force layout to rest on the series `forceSeries` builds, in ECharts' server
// renderer, so what they measure is where the page would put each document: the forces are only
// numbers, and whether they hold a ring round or keep hubs apart shows only once ECharts has run them.
// ECharts scatters every document at a random starting point; a seeded generator makes each run the
// same, so a failure here is a property of the forces and not of one unlucky start.

type Placed = { path: string; x: number; y: number; radius: number };

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(seededRandom(7));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function node(path: string, inDegree: number): GraphNode {
  return {
    path,
    title: path,
    href: `/doc/${path}`,
    group: "docs",
    inDegree,
    outDegree: 0,
  };
}

// Where each document comes to rest, in the canvas's pixels, with the radius it is drawn at there.
function settle(
  view: GraphView,
  box: { width: number; height: number },
  kind: GraphKind,
): Placed[] {
  const layout = layoutFor(view, box, kind);
  const series = forceSeries(view, layout);
  const chart = echarts.init(null as unknown as HTMLElement, undefined, {
    renderer: "svg",
    ssr: true,
    width: box.width,
    height: box.height,
  });
  try {
    chart.setOption({
      series: [
        {
          type: "graph",
          layout: "force",
          ...series,
          zoom: layout.zoom,
          nodeScaleRatio: 1,
          // Run to rest at once rather than a step per timer tick.
          force: { ...series.force, layoutAnimation: false },
        },
      ],
    });
    const model = (
      chart as unknown as {
        getModel(): {
          getSeriesByIndex(index: number): {
            getData(): { getItemLayout(index: number): number[] };
          };
        };
      }
    ).getModel();
    const data = model.getSeriesByIndex(0).getData();
    const zoom = layout.zoom ?? 1;
    return series.data.map((item, index) => {
      const [x, y] = chart.convertToPixel(
        { seriesIndex: 0 },
        data.getItemLayout(index),
      ) as number[];
      return {
        path: item.id,
        x: x ?? Number.NaN,
        y: y ?? Number.NaN,
        radius: (item.symbolSize / 2) * zoom,
      };
    });
  } finally {
    chart.dispose();
  }
}

// Every document drawn over part of another.
function overlapping(placed: Placed[]): Placed[] {
  const found = new Set<Placed>();
  for (const [index, one] of placed.entries()) {
    for (const other of placed.slice(index + 1)) {
      if (
        Math.hypot(one.x - other.x, one.y - other.y) <
        one.radius + other.radius
      ) {
        found.add(one).add(other);
      }
    }
  }
  return [...found];
}

describe("local graph layout", () => {
  // The side column's box, and a document with fourteen neighbors that also link among themselves
  // and back to it: the shape that used to settle bunched to one side of the pinned document.
  const box = { width: 199, height: 238 };
  const neighbors = Array.from(
    { length: 14 },
    (_, index) => `docs/n${String(index).padStart(2, "0")}.md`,
  );
  const view: GraphView = {
    folder: "",
    nodes: [
      node("docs/index.md", 14),
      ...neighbors.map((path, index) => node(path, index % 5)),
    ],
    edges: [
      ...neighbors.map((to) => ({ from: "docs/index.md", to })),
      ...neighbors
        .filter((_, index) => index % 2 === 0)
        .map((from) => ({ from, to: "docs/index.md" })),
      ...neighbors.map((from, index) => ({
        from,
        to: neighbors[(index + 1) % neighbors.length] ?? from,
      })),
    ],
    focus: { path: "docs/index.md", neighbors },
  };

  it("pins the document in the middle of the box", () => {
    const placed = settle(view, box, "local");
    const focus = placed.find((item) => item.path === "docs/index.md");
    expect(focus?.x).toBeCloseTo(box.width / 2, 0);
    expect(focus?.y).toBeCloseTo(box.height / 2, 0);
  });

  it("sets every neighbor on one ring, evenly round it", () => {
    const layout = layoutFor(view, box, "local");
    const placed = settle(view, box, "local");
    const focus = placed.find((item) => item.path === "docs/index.md");
    const around = placed.filter((item) => item !== focus);
    const distances = around.map((item) =>
      Math.hypot(item.x - (focus?.x ?? 0), item.y - (focus?.y ?? 0)),
    );
    const ring = layout.ring * (layout.zoom ?? 1);
    for (const distance of distances) {
      expect(Math.abs(distance - ring)).toBeLessThan(3);
    }
    const angles = around
      .map((item) =>
        Math.atan2(item.y - (focus?.y ?? 0), item.x - (focus?.x ?? 0)),
      )
      .sort((left, right) => left - right);
    const gaps = angles.map(
      (angle, index) =>
        (angles[index + 1] ?? (angles[0] ?? 0) + 2 * Math.PI) - angle,
    );
    const even = (2 * Math.PI) / around.length;
    for (const gap of gaps) {
      expect(gap / even).toBeGreaterThan(0.8);
      expect(gap / even).toBeLessThan(1.2);
    }
  });

  it("keeps every neighbor inside the box", () => {
    const placed = settle(view, box, "local");
    for (const item of placed) {
      expect(item.x - item.radius).toBeGreaterThanOrEqual(0);
      expect(item.x + item.radius).toBeLessThanOrEqual(box.width);
      expect(item.y - item.radius).toBeGreaterThanOrEqual(0);
      expect(item.y + item.radius).toBeLessThanOrEqual(box.height);
    }
  });
});

describe("page graph layout", () => {
  // A graph shaped like a real repository's, half the size of the one these forces were tuned on: a
  // few much-linked documents drawn several times a leaf's width, and many leaves that each link to
  // two or three others, preferring the popular ones. Every link pulls the hubs toward the crowded
  // middle, which is where documents used to land on one another. Built from its own seeded
  // generator, so it is the same graph on every run.
  const random = seededRandom(11);
  const count = 300;
  const paths = Array.from(
    { length: count },
    (_, index) => `docs/d${String(index).padStart(3, "0")}.md`,
  );
  const weight = paths.map((_, index) => 1 / (index + 1));
  const total = weight.reduce((sum, value) => sum + value, 0);
  const pick = (): number => {
    let target = random() * total;
    for (const [index, value] of weight.entries()) {
      target -= value;
      if (target <= 0) {
        return index;
      }
    }
    return count - 1;
  };
  const links = new Set<string>();
  for (const [from] of paths.entries()) {
    for (let made = 0; made < 2 + Math.floor(random() * 3); made++) {
      const to = pick();
      if (to !== from) {
        links.add(`${String(from)} ${String(to)}`);
      }
    }
  }
  const edges = [...links].map((pair) => {
    const [from, to] = pair.split(" ").map(Number);
    return { from: paths[from ?? 0] ?? "", to: paths[to ?? 0] ?? "" };
  });
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const view: GraphView = {
    folder: "",
    nodes: paths.map((path) => node(path, inDegree.get(path) ?? 0)),
    edges,
    focus: null,
  };

  // A force layout promises no exact outcome, so this asks for what the forces are for rather than
  // for perfection: with every document repelling alike and links of one length, one document in
  // eleven of this graph lay over a neighbor, nine hubs among them; with room given by size, a stray
  // pair of leaves at most, and never a hub, which is what the reader sees first. Laying out three
  // hundred documents takes about a second alone and several beside the rest of the suite.
  it(
    "lays almost no document over another, and no hub",
    { timeout: 30_000 },
    () => {
      const placed = settle(view, { width: 900, height: 600 }, "page");
      const hubRadius = Math.max(...placed.map((item) => item.radius));
      const over = overlapping(placed);
      expect(over.length).toBeLessThan(placed.length / 100);
      expect(
        over
          .filter((item) => item.radius > hubRadius / 2)
          .map((item) => item.path),
      ).toEqual([]);
    },
  );
});
