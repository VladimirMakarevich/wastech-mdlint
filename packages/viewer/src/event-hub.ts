import type { IncomingMessage, ServerResponse } from "node:http";

import { assetHeaders } from "./security.js";

/**
 * The open pages' event streams: what tells a page that its file changed, that the findings are in,
 * that the review moved or that a mark was saved elsewhere. One stream per open page, written to by
 * every part of the server that changes what a page shows.
 */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly keepAlive: NodeJS.Timeout;

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

  open(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    // Reconnect quickly after a restart, so the page notices the new server within a second.
    response.write("retry: 1000\n\n");
    this.clients.add(response);
    request.on("close", () => this.clients.delete(response));
  }

  broadcast(name: string, data: unknown): void {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
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
}
