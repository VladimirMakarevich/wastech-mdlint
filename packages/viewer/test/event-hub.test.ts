import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { EventHub } from "../src/event-hub.js";

// A page draws its tree's marks and its findings from the server's state at the moment it is served
// and asks for nothing more as it opens, so an event sent between serving it and its stream
// connecting must still reach it. These pin how the stream catches a late page up.

let hub: EventHub;

afterEach(() => {
  hub.close();
});

// One page's stream: what the hub wrote to it. A stand-in for the request and response a real
// connection would carry, enough for `open`.
function connect(
  url: string,
  headers: Record<string, string> = {},
): { text(): string; events(): string[] } {
  let written = "";
  const request = {
    url,
    headers,
    on: () => request,
  } as unknown as IncomingMessage;
  const response = {
    writeHead: () => response,
    write: (chunk: string) => {
      written += chunk;
      return true;
    },
    end: () => response,
  } as unknown as ServerResponse;
  hub.open(request, response);
  return {
    text: () => written,
    events: () => [...written.matchAll(/^event: (\S+)$/gm)].map((m) => m[1]!),
  };
}

describe("event stream", () => {
  it("numbers every event and serves the number of the last one", () => {
    hub = new EventHub();
    expect(hub.sequence).toBe(0);
    const page = connect("/events");
    hub.broadcast("change", { paths: ["a.md"], structural: false });
    hub.broadcast("diagnostics", {});
    expect(hub.sequence).toBe(2);
    expect(page.text()).toContain(
      'id: 1\nevent: change\ndata: {"paths":["a.md"],"structural":false}\n\n',
    );
    expect(page.text()).toContain("id: 2\nevent: diagnostics\ndata: {}\n\n");
  });

  it("sends a page what happened since it was served, and nothing it already includes", () => {
    hub = new EventHub();
    hub.broadcast("change", { paths: ["a.md"], structural: false });
    const served = hub.sequence;
    hub.broadcast("diagnostics", {});
    hub.broadcast("git", {});
    expect(connect(`/events?seen=${served}`).events()).toEqual([
      "diagnostics",
      "git",
    ]);
    expect(connect(`/events?seen=${hub.sequence}`).events()).toEqual([]);
    // A stream the browser reconnects by itself names the last event it got.
    expect(
      connect("/events?seen=0", { "last-event-id": "2" }).events(),
    ).toEqual(["git"]);
  });

  it("tells a page to reload when what it missed is no longer kept", () => {
    hub = new EventHub();
    for (let index = 0; index < 100; index += 1) {
      hub.broadcast("diagnostics", {});
    }
    expect(connect("/events?seen=1").events()).toEqual(["missed"]);
    // Served by an earlier run of the server, which counted further than this one has.
    expect(connect("/events?seen=500").events()).toEqual(["missed"]);
    // Still kept: the last few are sent again as they were.
    expect(connect("/events?seen=98").events()).toEqual([
      "diagnostics",
      "diagnostics",
    ]);
  });

  it("ignores a number that is not one", () => {
    hub = new EventHub();
    hub.broadcast("diagnostics", {});
    expect(connect("/events?seen=-1").events()).toEqual([]);
    expect(connect("/events?seen=abc").events()).toEqual([]);
    expect(connect("/events").events()).toEqual([]);
  });
});
