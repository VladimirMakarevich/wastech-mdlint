import { readdir, readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventHub } from "../src/event-hub.js";
import {
  SERVER_EVENTS,
  StreamPosition,
} from "../src/client/live-reload-model.js";

// Event ids as the server writes them: its run's tag, then the event's number.
const RUN = "0a1b2c3d";
const id = (number: number): string => `${RUN}.${number}`;

describe("StreamPosition", () => {
  it("connects from the id the page was served with", () => {
    expect(new StreamPosition(id(12)).url).toBe(`/events?seen=${id(12)}`);
  });

  // The server ignores a `seen` that is not one of its ids, so sending one would only look like a
  // resume.
  it.each([
    undefined,
    "",
    "abc",
    "12",
    "-1",
    `${RUN}.`,
    `${RUN}.1e3`,
    "0A1B2C3D.1",
  ])("connects from now on when served %j", (served) => {
    expect(new StreamPosition(served).url).toBe("/events");
  });

  // The page and the server agree on the id's form only by both following it; reading the id a real
  // hub serves keeps a change on one side from going unnoticed until a restart is missed.
  it("accepts the id the server serves a page with", () => {
    const hub = new EventHub();
    hub.broadcast("diagnostics", {});
    expect(new StreamPosition(hub.sequence).url).toBe(
      `/events?seen=${hub.sequence}`,
    );
    hub.close();
  });

  it("resumes from the last event received, not the id it was served with", () => {
    const position = new StreamPosition(id(3));
    position.receive(id(4));
    position.receive(id(9));
    expect(position.url).toBe(`/events?seen=${id(9)}`);
  });

  it("keeps its place through an event without an id", () => {
    const position = new StreamPosition(id(3));
    position.receive("");
    position.receive("not-an-id");
    expect(position.url).toBe(`/events?seen=${id(3)}`);
  });

  it("starts counting from the first event when served without an id", () => {
    const position = new StreamPosition(undefined);
    position.receive(id(5));
    expect(position.url).toBe(`/events?seen=${id(5)}`);
  });
});

describe("SERVER_EVENTS", () => {
  // A name the stream does not listen for is a name whose ids it never learns: on resuming, the
  // server would send those events again, and enough of them would read as more missed than it keeps
  // and reload the page for nothing. The names are read from the server's own source, so an event
  // added there fails here until the page listens for it.
  it("lists every event the server sends", async () => {
    const dir = new URL("../src/", import.meta.url);
    const names = new Set<string>();
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const source = await readFile(new URL(file, dir), "utf8");
      for (const match of source.matchAll(/\.broadcast\(\s*"([a-z-]+)"/g)) {
        names.add(match[1]!);
      }
      for (const match of source.matchAll(/event: ([a-z-]+)\\n/g)) {
        names.add(match[1]!);
      }
    }
    expect(names.size).toBeGreaterThan(1);
    expect([...SERVER_EVENTS].sort()).toEqual([...names].sort());
  });
});

// --- The stream as a page holds it --------------------------------------------------------------

type Listener = (event: { data: string; lastEventId: string }) => void;

class FakeEventSource {
  static opened: FakeEventSource[] = [];
  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(name: string, data = "{}", id = ""): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data, lastEventId: id });
    }
  }
}

function fakePage(visibility: "visible" | "hidden") {
  const documentListeners = new Map<string, (() => void)[]>();
  const windowListeners = new Map<string, (() => void)[]>();
  const add =
    (into: Map<string, (() => void)[]>) =>
    (name: string, listener: () => void) => {
      into.set(name, [...(into.get(name) ?? []), listener]);
    };
  const page = {
    visibilityState: visibility,
    querySelector: (selector: string) =>
      selector === 'meta[name="wastech-events"]' ? { content: id(3) } : null,
    addEventListener: add(documentListeners),
    documentElement: { dataset: {} },
  };
  const reload = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", {
    addEventListener: add(windowListeners),
    scrollTo: () => undefined,
    scrollY: 0,
  });
  vi.stubGlobal("location", { pathname: "/doc/a.md", search: "", reload });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("EventSource", FakeEventSource);
  return {
    reload,
    show(): void {
      page.visibilityState = "visible";
      for (const listener of documentListeners.get("visibilitychange") ?? []) {
        listener();
      }
    },
    hide(): void {
      page.visibilityState = "hidden";
      for (const listener of documentListeners.get("visibilitychange") ?? []) {
        listener();
      }
    },
    window(name: string): void {
      for (const listener of windowListeners.get(name) ?? []) {
        listener();
      }
    },
  };
}

async function loadLiveReload(): Promise<
  typeof import("../src/client/live-reload.js")
> {
  vi.resetModules();
  return import("../src/client/live-reload.js");
}

describe("live reload's event stream", () => {
  beforeEach(() => {
    FakeEventSource.opened = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Every open tab's stream holds one of the browser's few HTTP/1.1 connections to the viewer; a
  // hidden tab that kept its stream would leave the shown ones waiting for a connection forever.
  it("closes while the page is hidden and resumes from the last event it received", async () => {
    const page = fakePage("visible");
    const liveReload = await loadLiveReload();
    const findings: string[] = [];
    liveReload.initLiveReload("a.md");
    liveReload.onServerEvent("diagnostics", (data) => findings.push(data));

    const first = FakeEventSource.opened[0]!;
    expect(first.url).toBe(`/events?seen=${id(3)}`);
    first.emit("diagnostics", "one", id(4));
    first.emit("review", "{}", id(5));

    page.hide();
    expect(first.closed).toBe(true);
    expect(FakeEventSource.opened).toHaveLength(1);

    page.show();
    const second = FakeEventSource.opened[1]!;
    expect(second.url).toBe(`/events?seen=${id(5)}`);
    // Every listener the page's modules added is on the new stream too.
    second.emit("diagnostics", "two", id(6));
    expect(findings).toEqual(["one", "two"]);
    // A change the server sends again on resuming still reloads the page that shows it.
    second.emit(
      "change",
      JSON.stringify({ paths: ["a.md"], structural: false }),
      id(7),
    );
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the server says what the page missed is no longer kept", async () => {
    const page = fakePage("visible");
    const liveReload = await loadLiveReload();
    liveReload.initLiveReload(undefined);
    page.hide();
    page.show();
    FakeEventSource.opened[1]!.emit("missed", "{}", id(1));
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  // A stream this page closed fires no error, so reopening it is not the reconnect after a lost
  // connection that reloads the page; a stream that did lose its connection still reloads on open.
  it("reloads on opening only after a lost connection", async () => {
    const page = fakePage("visible");
    const liveReload = await loadLiveReload();
    liveReload.initLiveReload(undefined);
    page.hide();
    page.show();
    FakeEventSource.opened[1]!.emit("open");
    expect(page.reload).not.toHaveBeenCalled();
    FakeEventSource.opened[1]!.emit("error");
    FakeEventSource.opened[1]!.emit("open");
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it("opens no stream for a page opened in the background until it is shown", async () => {
    const page = fakePage("hidden");
    const liveReload = await loadLiveReload();
    liveReload.initLiveReload(undefined);
    expect(FakeEventSource.opened).toHaveLength(0);
    page.show();
    expect(FakeEventSource.opened.map((source) => source.url)).toEqual([
      `/events?seen=${id(3)}`,
    ]);
  });

  it("closes for the back-forward cache and opens again when restored from it", async () => {
    const page = fakePage("visible");
    const liveReload = await loadLiveReload();
    liveReload.initLiveReload(undefined);
    FakeEventSource.opened[0]!.emit("git", "{}", id(8));
    page.window("pagehide");
    expect(FakeEventSource.opened[0]!.closed).toBe(true);
    page.window("pageshow");
    expect(FakeEventSource.opened.map((source) => source.url)).toEqual([
      `/events?seen=${id(3)}`,
      `/events?seen=${id(8)}`,
    ]);
    // Shown again by both events, the page still holds one stream.
    page.show();
    expect(FakeEventSource.opened).toHaveLength(2);
  });
});
