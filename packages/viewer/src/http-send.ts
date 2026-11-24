import type { IncomingMessage, ServerResponse } from "node:http";

import { pageHeaders } from "./security.js";

// How every route answers. Each carries the same security headers, so no page, payload or refusal is
// ever sent without the CSP and the framing and sniffing protections a page needs.

export function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  headOnly = false,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(headOnly ? undefined : html);
}

export function sendJson(
  response: ServerResponse,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

export function sendText(
  response: ServerResponse,
  status: number,
  text: string,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

/**
 * The request body as text, or `undefined` once it passes `limit` bytes. The rest is drained rather
 * than kept, so the refusal can still be sent on the same connection.
 */
export function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (Number(request.headers["content-length"] ?? "0") > limit) {
      request.resume();
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
      }
    });
    request.on("end", () =>
      resolve(
        size > limit ? undefined : Buffer.concat(chunks).toString("utf8"),
      ),
    );
    request.on("error", reject);
  });
}
