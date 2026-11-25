import type { IncomingMessage, ServerResponse } from "node:http";

import { assetHeaders } from "./security.js";

/**
 * The rules by which a browser fetches a document's page ahead of the click: a link to a document
 * the pointer rests on for a moment (or presses) is fetched then, and the click is answered from
 * that copy, so moving between documents no longer waits for the server to render the next one.
 * Served as a file the pages name in a `Speculation-Rules` header rather than inline, which the
 * Content-Security-Policy, allowing scripts from this origin only, would refuse.
 *
 * Only fetching, never rendering ahead: a page rendered in the background would run its scripts -
 * restoring the tree from a scroll position saved before the click, opening an event stream of its
 * own - before the reader ever saw it. A fetched page is only text until it is opened, and when it
 * is opened later than it was fetched, its event stream sends it what happened in between.
 *
 * Left out: links within the page (`#…`), and the header's Blame switch, which makes git blame
 * every line - work for a click that may never come.
 *
 * The header's sections are fetched the same way: the Changes page and the dashboard are the
 * longest waits in the viewer, a fifth of a second of the server's and more, and a reader rests on
 * a section a moment before choosing it. Only the header's links to them, not every link to the
 * dashboard: the dashboard's own column headers link to it re-sorted, and pointing across them
 * would have the server build the whole table again and again for nothing.
 */
const SPECULATION_RULES = JSON.stringify({
  prefetch: [
    {
      where: {
        and: [
          { href_matches: "/doc/*" },
          { not: { selector_matches: 'a[href^="#"]' } },
          { not: { selector_matches: ".blame-toggle" } },
        ],
      },
      eagerness: "moderate",
    },
    {
      where: { selector_matches: ".section-nav a" },
      eagerness: "moderate",
    },
  ],
});

/** Where the pages' `Speculation-Rules` header points. */
export const SPECULATION_RULES_PATH = "/speculation-rules.json";

export function sendSpeculationRules(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(200, {
    ...assetHeaders(),
    "Content-Type": "application/speculationrules+json",
  });
  response.end(request.method === "HEAD" ? undefined : SPECULATION_RULES);
}
