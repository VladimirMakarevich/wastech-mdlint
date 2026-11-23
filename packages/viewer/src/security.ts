import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// A local server that reads the repository is a target for any web page the user has open: the page
// cannot read our responses across origins, but it can make the browser send requests, and with DNS
// rebinding it can make our origin look like its own. The checks below are the standing answer to
// both, and each one is cheap enough that none is left to the others.

export const DEFAULT_HOST = "127.0.0.1";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_NAMES.has(host.toLowerCase());
}

/**
 * Whether a request's `Host` header names this server.
 *
 * DNS rebinding works by pointing an attacker-controlled name at 127.0.0.1 after the page has loaded,
 * so the browser treats our responses as same-origin with the attacker's page. The request still
 * carries the attacker's name in `Host`, which is what this rejects. IP literals are accepted for any
 * address because a rebinding attack needs a *name* to re-point, and a server bound with `--host` to
 * a LAN address is reached by its IP; `localhost` and the configured host are the only names.
 */
export function isAllowedHostHeader(
  hostHeader: string | undefined,
  bound: { host: string; port: number },
): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  // `URL` drops a port equal to the scheme default, so 80 has to be compared as the empty string.
  const expectedPort = bound.port === 80 ? "" : String(bound.port);
  if (parsed.port !== expectedPort) {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  const bareHostname = hostname.replace(/^\[|\]$/g, "");
  return (
    hostname === "localhost" ||
    isIP(bareHostname) !== 0 ||
    hostname === bound.host.toLowerCase()
  );
}

/**
 * Whether a request was made by another site's page rather than by navigating to us.
 *
 * Navigations are allowed from anywhere: following a link to a document is the point of the tool,
 * and the response goes to the user, not to the linking page. Everything else from another origin —
 * a `fetch`, an `EventSource`, an `<img>` or `<script>` tag — is refused. `same-site` counts as
 * foreign too, because every other port on localhost is the same site, and another dev server the
 * user runs is exactly the kind of page that should not reach this one.
 */
export function isForeignRequest(headers: {
  origin?: string;
  host?: string;
  "sec-fetch-site"?: string;
  "sec-fetch-mode"?: string;
}): boolean {
  // An opaque origin arrives as the string "null", which never equals ours, so a sandboxed frame or
  // a `file:` page is refused by the same comparison.
  if (
    headers.origin !== undefined &&
    headers.origin !== `http://${headers.host ?? ""}`
  ) {
    return true;
  }
  const site = headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") {
    return headers["sec-fetch-mode"] !== "navigate";
  }
  return false;
}

// Shared by every response. `Cross-Origin-Resource-Policy: same-origin` is what stops another page
// from embedding our scripts or images with a no-cors tag, the request shape `isForeignRequest`
// cannot see when a browser omits the fetch-metadata headers.
const COMMON_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

/**
 * Headers for a rendered page.
 *
 * Scripts only from this origin, never inline: the rendered Markdown is sanitized, and this is the
 * second line if sanitizing ever misses something. Styles do allow `'unsafe-inline'`, because both
 * Shiki (a `style` attribute per token) and Mermaid (a `<style>` inside each SVG) emit them, and the
 * sanitizer already strips every `style` an author wrote. `no-store` because the page reflects the
 * file on disk right now, and a cached copy after an edit is the wrong answer.
 */
export function pageHeaders(): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      // The header's search form submits to this server; nothing may post anywhere else.
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Cache-Control": "no-store",
  };
}

/**
 * Headers for a repository file served as-is (an image a document embeds).
 *
 * `sandbox` matters for SVG: opened directly, an SVG is a document that can run script in our
 * origin, and an SVG in a repository is just as untrusted as the Markdown around it.
 */
export function rawFileHeaders(): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "no-store",
  };
}

/** Headers for the viewer's own scripts and styles, which change only with the package. */
export function assetHeaders(): Record<string, string> {
  return { ...COMMON_HEADERS, "Cache-Control": "no-cache" };
}

// The header the config page's script sends its per-process token in. A custom header is also what
// makes a cross-origin `fetch` carrying it a preflighted request, which this server never approves.
export const TOKEN_HEADER = "x-wastech-viewer-token";

/**
 * Why a request that changes or computes from the config is refused, or `undefined` to let it in.
 *
 * Checked on top of the `Host` and cross-site checks every request passes, because these are the
 * only requests with a body the server acts on. A browser always sends `Origin` on a POST, so a
 * missing one is a request no page of ours made. Fetch metadata, when present, must say
 * same-origin. The body must be declared JSON: an HTML form cannot send that type, and a page that
 * sets it on a cross-origin `fetch` triggers a preflight. Last, the token: it is random per process
 * and appears only in the config page, so a request that carries it was made by a page this server
 * rendered.
 */
export function changeRequestProblem(
  headers: {
    origin?: string;
    host?: string;
    "sec-fetch-site"?: string;
    "content-type"?: string;
    [TOKEN_HEADER]?: string;
  },
  token: string,
): { status: 403 | 415; message: string } | undefined {
  if (
    headers.origin === undefined ||
    headers.origin !== `http://${headers.host ?? ""}`
  ) {
    return {
      status: 403,
      message: "Forbidden: a change must come from the viewer's own page.",
    };
  }
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") {
    return {
      status: 403,
      message: "Forbidden: a change must come from the viewer's own page.",
    };
  }
  const mediaType = (headers["content-type"] ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      status: 415,
      message: "The request body must be sent as application/json.",
    };
  }
  const sent = Buffer.from(headers[TOKEN_HEADER] ?? "", "utf8");
  const expected = Buffer.from(token, "utf8");
  // Compared in constant time, so the response time says nothing about how much of a guess matched.
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    return {
      status: 403,
      message:
        "Forbidden: the page that sent this change is out of date. Reload it and try again.",
    };
  }
  return undefined;
}
