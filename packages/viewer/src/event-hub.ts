import { randomBytes } from "node:crypto";
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
 * Every event is numbered, and every page is served with the id of the last one sent before it
 * (`sequence`). The page draws its tree's marks, the Changes count and its findings from the server's
 * state at that moment and asks for nothing more, so an event sent between serving it and its stream
 * connecting would otherwise be lost, and the page would keep showing the state before it. The page
 * connects with that id, and the events it missed are sent to it first; when they are no longer
 * kept — a burst longer than `KEPT_EVENTS`, or a server that restarted meanwhile — it is told so
 * with `missed`, and reloads.
 *
 * An id is this run's tag and the event's number (`3f9c01ab.12`). A number alone cannot tell a
 * restarted server from the one that served the page: the new one counts from zero again, and once
 * it has sent as many events as the page saw — its startup findings alone can be one — the page's
 * number reads as up to date, or as an earlier point of the new run, whose events would then be sent
 * as if they followed the old ones. A page that closed its stream while hidden has no lost
 * connection to tell it the server went away, so the tag is what does.
 */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly keepAlive: NodeJS.Timeout;
  private latest = 0;
  // Random rather than a start time, so two runs started within one clock tick still differ.
  private readonly run = randomBytes(4).toString("hex");
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

  /** The id of the last event sent, which a page is served with. */
  get sequence(): string {
    return this.id(this.latest);
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
    if (seen !== undefined && seen.run !== this.run) {
      response.write(this.missed());
    } else if (seen !== undefined && seen.number !== this.latest) {
      response.write(this.since(seen.number));
    }
    this.clients.add(response);
    request.on("close", () => this.clients.delete(response));
  }

  broadcast(name: string, data: unknown): void {
    this.latest += 1;
    // The id is what a browser sends back as `Last-Event-ID` when it reconnects on its own.
    const message = `id: ${this.id(this.latest)}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
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

  private id(number: number): string {
    return `${this.run}.${number}`;
  }

  private missed(): string {
    return `id: ${this.id(this.latest)}\nevent: missed\ndata: {}\n\n`;
  }

  // The events of this run after `seen`, or `missed` when they are not all kept.
  private since(seen: number): string {
    const first = this.kept[0]?.id ?? this.latest + 1;
    if (seen > this.latest || seen + 1 < first) {
      return this.missed();
    }
    return this.kept
      .filter((event) => event.id > seen)
      .map((event) => event.message)
      .join("");
  }
}

// The last event a connecting page has seen: the id it was served with, or the id of the last event
// it received when it reopens its stream or the browser reconnects it by itself. Anything else —
// malformed, or a bare number no run of this server sends — is no position to resume from.
function seenBy(
  request: IncomingMessage,
): { run: string; number: number } | undefined {
  const header = request.headers["last-event-id"];
  const query = new URL(
    request.url ?? "/",
    "http://localhost",
  ).searchParams.get("seen");
  const value = typeof header === "string" ? header : query;
  const match =
    value === null ? null : /^([0-9a-f]{8})\.(\d{1,15})$/.exec(value);
  if (match === null) {
    return undefined;
  }
  return { run: match[1]!, number: Number(match[2]) };
}
