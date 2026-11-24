// One event stream per page, shared: the reload logic here and the diagnostics panel both listen on
// it, and a second `EventSource` would hold a second connection open for the same events.

type ChangeEvent = { paths: string[]; structural: boolean };

let events: EventSource | undefined;

// The page is served with the number of the last event its state includes, and connects with it, so
// the server first sends whatever happened between serving the page and this connection. The
// listeners are all added in the module scripts' first turn, before any of it can arrive.
function stream(): EventSource {
  const seen = document.querySelector<HTMLMetaElement>(
    'meta[name="wastech-events"]',
  )?.content;
  events ??= new EventSource(
    seen === undefined
      ? "/events"
      : `/events?${new URLSearchParams({ seen }).toString()}`,
  );
  return events;
}

/** Listen for a named server event. */
export function onServerEvent(
  name: string,
  listener: (data: string) => void,
): void {
  stream().addEventListener(name, (event) => {
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
  const source = stream();
  source.addEventListener("error", () => {
    disconnected = true;
  });
  // Reconnecting means the server restarted, possibly with different files or a different config,
  // so whatever this page shows may be stale.
  source.addEventListener("open", () => {
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
