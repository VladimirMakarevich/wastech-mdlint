import type { IncomingMessage, ServerResponse } from "node:http";

import { assetHeaders } from "./security.js";

// How many of the latest events are kept to send again to a page that connects late. A page connects
// a few hundred milliseconds after it was served, and in that time a save sends three events at most
// (`change`, `diagnostics`, `git`); the room beyond that covers a burst of saves.
const KEPT_EVENTS = 64;

/**
 * The open pages' event streams: what tells a page that its file changed, that the findings are in,
 * that the review moved or that a mark was saved elsewhere. One stream per open page, written to by
 * every part of the server that changes what a page shows.
 *
 * Every event is numbered, and every page is served with the number of the last one sent before it
 * (`sequence`). The page draws its tree's marks, the Changes count and its findings from the server's
 * state at that moment and asks for nothing more, so an event sent between serving it and its stream
 * connecting would otherwise be lost, and the page would keep showing the state before it. The page
 * connects with its number, and the events it missed are sent to it first; when they are no longer
 * kept — a burst longer than `KEPT_EVENTS`, or a server that restarted meanwhile and counts from
 * zero again — it is told so with `missed`, and reloads.
 */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly keepAlive: NodeJS.Timeout;
  private latest = 0;
  private readonly kept: { id: number; message: string }[] = [];

  constructor() {
    // Idle connections are closed by some proxies and by browsers after a while; a comment line every
    // so often keeps the stream open without the client seeing an event.
    this.keepAlive = setInterval(() => {
      for (const client of this.clients) {
        client.write(": keep-alive\n\n");
      }
    }, 25_000);
    this.keepAlive.unref();
  }

  /** How many pages are listening, so work only they would ask for can be started ahead of them. */
  get size(): number {
    return this.clients.size;
  }

  /** The number of the last event sent, which a page is served with. */
  get sequence(): number {
    return this.latest;
  }

  open(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    // Reconnect quickly after a restart, so the page notices the new server within a second.
    response.write("retry: 1000\n\n");
    const seen = seenBy(request);
    if (seen !== undefined && seen !== this.latest) {
      response.write(this.since(seen));
    }
    this.clients.add(response);
    request.on("close", () => this.clients.delete(response));
  }

  broadcast(name: string, data: unknown): void {
    this.latest += 1;
    // The id is what a browser sends back as `Last-Event-ID` when it reconnects on its own.
    const message = `id: ${this.latest}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    this.kept.push({ id: this.latest, message });
    if (this.kept.length > KEPT_EVENTS) {
      this.kept.shift();
    }
    for (const client of this.clients) {
      client.write(message);
    }
  }

  close(): void {
    clearInterval(this.keepAlive);
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  // The events after `seen`, or `missed` when they are not all kept. A number past the latest one can
  // only come from a page an earlier run of the server sent.
  private since(seen: number): string {
    const first = this.kept[0]?.id ?? this.latest + 1;
    if (seen > this.latest || seen + 1 < first) {
      return `id: ${this.latest}\nevent: missed\ndata: {}\n\n`;
    }
    return this.kept
      .filter((event) => event.id > seen)
      .map((event) => event.message)
      .join("");
  }
}

// The last event a connecting page has seen: the number it was served with on its first connection,
// or the id of the last event it received when the browser reconnects the stream by itself.
function seenBy(request: IncomingMessage): number | undefined {
  const header = request.headers["last-event-id"];
  const query = new URL(
    request.url ?? "/",
    "http://localhost",
  ).searchParams.get("seen");
  const value = typeof header === "string" ? header : query;
  if (value === null || !/^\d{1,15}$/.test(value)) {
    return undefined;
  }
  return Number(value);
}
