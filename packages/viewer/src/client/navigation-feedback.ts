// What a page shows between a click that leaves it and the next page appearing. Moving between pages
// is a full page load, and until the next one can be drawn the old one stays on screen unchanged - on
// the Changes page or the dashboard for a quarter to half a second - with nothing to say the click
// was taken.
//
// So the click answers at once with where it leads: the header's section the next page belongs to
// is chosen, and the file it opens is marked in the tree, as the next page will show them. When the
// server keeps it waiting past a moment, a thin bar under the header grows and the pointer says the
// page is busy. Nothing covers or replaces the page: an indicator shown for the tenth of a second a
// document takes would itself be a blink, and a page the reader may still be looking at stays as it
// is.

// How long the server may take before the bar shows. This page is gone the moment the next one's
// answer arrives, its bar with it, and the frame left on screen until the next page is drawn is its
// last; so the bar is for a server that keeps the reader waiting - a review computed afresh, a large
// repository - and never for the moment a document, or a section fetched as the pointer rested on
// it, takes.
const SLOW_AFTER_MS = 200;
// A navigation the browser drops without a word - stopped with Esc, or answered with a file to
// save - leaves this page standing; after this long it stops saying it is leaving.
const GIVE_UP_AFTER_MS = 15_000;

// The Navigation API's `navigate` event, which this TypeScript's DOM types do not describe yet: only
// what is read here. Where the browser has it, it reports every way of leaving the page - a link, a
// form, a script setting `location` - with where it leads.
type NavigateEvent = Event & {
  destination: { url: string; sameDocument: boolean };
  hashChange: boolean;
  downloadRequest: string | null;
};

export function initNavigationFeedback(): void {
  let slow: number | undefined;
  let giveUp: number | undefined;
  // Where the page is going, so the same departure reported twice - a link this script followed,
  // and the navigation that following it starts - is shown once.
  let pending: string | undefined;
  const reset = (): void => {
    window.clearTimeout(slow);
    window.clearTimeout(giveUp);
    pending = undefined;
    delete document.documentElement.dataset.navigating;
    for (const marked of document.querySelectorAll("[data-pending]")) {
      marked.removeAttribute("data-pending");
    }
  };
  const show = (url: URL): void => {
    if (!isPage(url) || url.href === pending) {
      return;
    }
    reset();
    pending = url.href;
    markDestination(url);
    document.documentElement.dataset.navigating = "pending";
    slow = window.setTimeout(() => {
      document.documentElement.dataset.navigating = "slow";
    }, SLOW_AFTER_MS);
    giveUp = window.setTimeout(reset, GIVE_UP_AFTER_MS);
  };
  // A page the back button brings back from the browser's cache is shown as it was left, pending.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      reset();
    }
  });
  // A link is followed only once the page has drawn where it leads. Followed at once, the next page
  // - often fetched already as the pointer rested on the link - took this page's place before the
  // browser drew another frame of it, and the frame left on screen until the next page appeared was
  // the one from before the click. Listened for on the window, after every other listener, so a link
  // a script handles itself, such as the dashboard's column headers, is left to it.
  window.addEventListener("click", (event) => {
    const url = destinationOf(event);
    if (url === undefined || !isPage(url)) {
      return;
    }
    event.preventDefault();
    show(url);
    afterNextPaint(() => {
      location.assign(url.href);
    });
  });
  // Every other way of leaving - a form, a script setting `location` - where the browser reports it.
  const navigation = (window as Window & { navigation?: EventTarget })
    .navigation;
  navigation?.addEventListener("navigate", (event) => {
    const navigate = event as NavigateEvent;
    if (
      !navigate.destination.sameDocument &&
      !navigate.hashChange &&
      navigate.downloadRequest === null
    ) {
      show(new URL(navigate.destination.url));
    }
  });
}

// Runs `then` once the browser has drawn a frame with what was just changed: a timer set from an
// animation frame fires after that frame is painted. A tab that draws no frames runs it shortly.
function afterNextPaint(then: () => void): void {
  let done = false;
  const once = (): void => {
    if (!done) {
      done = true;
      then();
    }
  };
  requestAnimationFrame(() => {
    window.setTimeout(once, 0);
  });
  window.setTimeout(once, 100);
}

// Where a click goes when it follows a link away from this page in this tab: not one another script
// took, a click that opens a new tab or window or saves a file, or a jump within the page.
function destinationOf(event: MouseEvent): URL | undefined {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
    "a[href]",
  );
  if (
    link === null ||
    link === undefined ||
    event.defaultPrevented ||
    opensElsewhere(event, link)
  ) {
    return undefined;
  }
  const url = new URL(link.href);
  const samePage =
    url.pathname === location.pathname && url.search === location.search;
  return samePage && url.hash !== "" ? undefined : url;
}

// A click that leaves this tab as it is: with a key that opens a new tab or window, another button,
// a link to a file to save, or one that names another window.
function opensElsewhere(event: MouseEvent, link: HTMLAnchorElement): boolean {
  return (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    link.hasAttribute("download") ||
    (link.target !== "" && link.target !== "_self")
  );
}

// A page of this viewer, as opposed to its data, assets or event stream, and anything elsewhere.
function isPage(url: URL): boolean {
  return (
    url.origin === location.origin &&
    !/^\/(api|assets|vendor)\//.test(url.pathname) &&
    url.pathname !== "/events"
  );
}

// The header's section and the tree's file as the next page will show them: the section it belongs
// to, or none for a document, and the file it opens, or none for anything else. The stylesheet draws
// a marked one as chosen and the page's own as not, while the wait lasts.
function markDestination(url: URL): void {
  for (const container of document.querySelectorAll<HTMLElement>(
    ".section-nav, .sidebar",
  )) {
    container.dataset.pending = "";
    for (const link of container.querySelectorAll<HTMLAnchorElement>(
      "a.segment, .tree a[href]",
    )) {
      if (new URL(link.href).pathname === url.pathname) {
        link.dataset.pending = "";
      }
    }
  }
}
