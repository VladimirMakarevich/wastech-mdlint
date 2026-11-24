import { SERVER_EVENTS, StreamPosition } from "./live-reload-model.js";

// One event stream per page, shared: the reload logic here and the diagnostics panel both listen on
// it, and a second `EventSource` would hold a second connection open for the same events.
//
// And open only while the page is shown. The server speaks HTTP/1.1, for which a browser opens about
// six connections to one host across all of its tabs; a stream holds one for as long as it is open,
// so six viewer tabs left open would hold them all, and every other request to the viewer — a page,
// a fetch, a save — would wait behind them forever. A hidden page closes its stream and opens a new
// one when it is shown again, from the last event it received, so the server first sends it what
// happened meanwhile and the page catches up as if it had listened all along.

type ChangeEvent = { paths: string[]; structural: boolean };

// Every listener the page's modules added, so a stream opened again gets all of them back.
const listeners: { name: string; handle: (event: Event) => void }[] = [];
let position: StreamPosition | undefined;
let events: EventSource | undefined;

// The page is served with the id of the last event its state includes, and connects with it, so
// the server first sends whatever happened between serving the page and this connection. The
// listeners are all added in the module scripts' first turn, before any of it can arrive.
function listen(name: string, handle: (event: Event) => void): void {
  listeners.push({ name, handle });
  events?.addEventListener(name, handle);
  if (position !== undefined) {
    return;
  }
  position = new StreamPosition(
    document.querySelector<HTMLMetaElement>('meta[name="wastech-events"]')
      ?.content,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      connect();
    } else {
      disconnect();
    }
  });
  // A page kept in the back-forward cache is hidden without being unloaded, and one restored from it
  // is shown again without loading; an open stream would also keep some browsers from caching it.
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", connect);
  connect();
}

// A page opened in a background tab connects only once it is first shown, so a burst of tabs opened
// at once holds no connection until each is read.
function connect(): void {
  if (
    events !== undefined ||
    position === undefined ||
    document.visibilityState !== "visible"
  ) {
    return;
  }
  const from = position;
  const source = new EventSource(from.url);
  for (const name of SERVER_EVENTS) {
    source.addEventListener(name, (event) => {
      from.receive((event as MessageEvent<string>).lastEventId);
    });
  }
  for (const { name, handle } of listeners) {
    source.addEventListener(name, handle);
  }
  events = source;
}

// Closing a stream fires no `error`, so the reload that reconnecting after a lost connection triggers
// does not follow a stream this page closed itself.
function disconnect(): void {
  events?.close();
  events = undefined;
}

/** Listen for a named server event. */
export function onServerEvent(
  name: string,
  listener: (data: string) => void,
): void {
  listen(name, (event) => {
    listener((event as MessageEvent<string>).data);
  });
}

const scrollKey = `wastech-mdlint-viewer:scroll:${location.pathname}`;

/**
 * Reload when what this page shows changes on disk, keeping the scroll position.
 *
 * `documentPath` is set on a document page only; every page reloads on a structural change, because
 * every page shows the document tree.
 */
export function initLiveReload(documentPath: string | undefined): void {
  restoreScroll();
  let disconnected = false;
  listen("error", () => {
    disconnected = true;
  });
  // Reconnecting after a lost connection means the server restarted, possibly with different files
  // or a different config, so whatever this page shows may be stale. A server that restarted while
  // this page's stream was closed shows instead as `missed`: the id the page reopens with carries
  // the earlier run's tag, which the new server does not have.
  listen("open", () => {
    if (disconnected) {
      reloadKeepingScroll();
    }
  });
  // More happened since the page was served than the server keeps to send again, or the server that
  // served it has restarted: what the page shows cannot be brought up to date piece by piece.
  onServerEvent("missed", () => {
    reloadKeepingScroll();
  });
  onServerEvent("change", (data) => {
    const change = JSON.parse(data) as ChangeEvent;
    if (
      change.structural ||
      (documentPath !== undefined && change.paths.includes(documentPath))
    ) {
      reloadKeepingScroll();
    }
  });
  // A commit, a checkout or a fetch moved what the branch is compared with. Only the pages that show
  // that comparison reload: the Changes page, a changed document's line and marks, and the graph or
  // dashboard asked to show the branch. The header count and the tree refresh on their own.
  onServerEvent("git", () => {
    const params = new URLSearchParams(location.search);
    if (
      location.pathname === "/changes" ||
      document.querySelector(".changes-banner") !== null ||
      params.get("changes") === "1" ||
      params.get("changed") === "1"
    ) {
      reloadKeepingScroll();
    }
  });
}

// Storage can be unavailable (private windows, blocked site data), and losing the scroll position
// is the only consequence, so every access is allowed to fail quietly.
function restoreScroll(): void {
  try {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved !== null) {
      sessionStorage.removeItem(scrollKey);
      window.scrollTo(0, Number(saved));
    }
  } catch {
    // Nothing to restore.
  }
}

function reloadKeepingScroll(): void {
  // A page already leaving for another — a click taken, the next page on its way — is not reloaded:
  // the reload would replace that navigation, and the reader would land back on the page they left.
  // The page they are going to is served fresh anyway.
  if (document.documentElement.dataset.navigating !== undefined) {
    return;
  }
  try {
    sessionStorage.setItem(scrollKey, String(window.scrollY));
  } catch {
    // Reload anyway; the page opens at the top.
  }
  location.reload();
}
