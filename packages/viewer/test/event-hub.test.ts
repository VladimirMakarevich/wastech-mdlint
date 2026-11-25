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

// The id of event `number` in this hub's run.
function at(number: number): string {
  return `${hub.sequence.split(".")[0]!}.${number}`;
}

describe("event stream", () => {
  it("numbers every event within its run and serves the id of the last one", () => {
    hub = new EventHub();
    expect(hub.sequence).toMatch(/^[0-9a-f]{8}.0$/);
    const page = connect("/events");
    hub.broadcast("change", { paths: ["a.md"], structural: false });
    hub.broadcast("diagnostics", {});
    expect(hub.sequence).toBe(at(2));
    expect(page.text()).toContain(
      `id: ${at(1)}
event: change
data: {"paths":["a.md"],"structural":false}

`,
    );
    expect(page.text()).toContain(`id: ${at(2)}
event: diagnostics
data: {}

`);
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
      connect(`/events?seen=${at(0)}`, { "last-event-id": at(2) }).events(),
    ).toEqual(["git"]);
  });

  it("tells a page to reload when what it missed is no longer kept", () => {
    hub = new EventHub();
    for (let index = 0; index < 100; index += 1) {
      hub.broadcast("diagnostics", {});
    }
    expect(connect(`/events?seen=${at(1)}`).events()).toEqual(["missed"]);
    expect(connect(`/events?seen=${at(500)}`).events()).toEqual(["missed"]);
    // Still kept: the last few are sent again as they were.
    expect(connect(`/events?seen=${at(98)}`).events()).toEqual([
      "diagnostics",
      "diagnostics",
    ]);
  });

  // A page whose stream was closed while the server restarted holds a position from the earlier run.
  // The new run counts from zero again, so by number alone that position can look up to date (the
  // new run has sent exactly as many events) or like an earlier point of the new run, whose events
  // would be sent as if they followed the old ones. Either way the page would keep showing what the
  // old server served - its files, its config - until the reader navigated.
  it("tells a page served by an earlier run to reload, whatever number it holds", () => {
    hub = new EventHub();
    hub.broadcast("diagnostics", {});
    hub.broadcast("change", { paths: ["a.md"], structural: false });
    const earlier = { one: at(1), two: at(2) };
    hub.close();

    hub = new EventHub();
    hub.broadcast("diagnostics", {});
    hub.broadcast("git", {});
    hub.broadcast("diagnostics", {});
    expect(hub.sequence).not.toBe(earlier.two);
    // As many events as the page saw, and fewer: neither may read as a position in this run.
    expect(connect(`/events?seen=${earlier.two}`).events()).toEqual(["missed"]);
    expect(connect(`/events?seen=${earlier.one}`).events()).toEqual(["missed"]);
    expect(
      connect("/events", { "last-event-id": earlier.one }).events(),
    ).toEqual(["missed"]);
  });

  it("ignores a position that is not one", () => {
    hub = new EventHub();
    hub.broadcast("diagnostics", {});
    for (const seen of ["-1", "abc", "1", `${at(1)}x`, "ABCDEF12.1"]) {
      expect(connect(`/events?seen=${seen}`).events(), seen).toEqual([]);
    }
    expect(connect("/events").events()).toEqual([]);
  });
});
