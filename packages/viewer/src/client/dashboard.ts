import { onServerEvent } from "./live-reload.js";
import { initPromptButtons } from "./prompts.js";

// Filters and sorts the dashboard as the reader types, without reloading. It does not filter on its
// own: on every change it asks the server for the same page the form would open and swaps in that
// page's results, so the selection and its rows are computed and laid out in one place, and the
// address it leaves behind opens exactly what is on screen — with or without this script.

// Long enough to let a number be typed without a request per digit, short enough to feel immediate.
const DELAY_MS = 150;

export function initDashboard(): void {
  const form = document.querySelector<HTMLFormElement>(
    "form.dashboard-filters",
  );
  const results = document.querySelector<HTMLElement>(".dashboard-results");
  const summary = document.querySelector<HTMLElement>(".dashboard-summary");
  if (form === null || results === null || summary === null) {
    return;
  }
  initPromptButtons(results);
  // Every change applies itself, so the button the form needs without script would do nothing.
  const apply = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (apply !== null) {
    apply.hidden = true;
  }

  let timer: number | undefined;
  // Only the newest request may change the page: an older answer arriving late would show filters
  // the reader has already moved past.
  let controller: AbortController | undefined;

  async function show(address: string): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    let html: string;
    try {
      html = await (await fetch(address, { signal: current.signal })).text();
    } catch {
      // Superseded by a newer request, or the server is restarting; live reload handles the latter.
      return;
    }
    const next = new DOMParser().parseFromString(html, "text/html");
    const nextResults = next.querySelector(".dashboard-results");
    const nextSummary = next.querySelector(".dashboard-summary");
    if (nextResults === null || nextSummary === null) {
      return;
    }
    results!.replaceChildren(...nextResults.childNodes);
    initPromptButtons(results!);
    summary!.textContent = nextSummary.textContent;
    // The sort travels in hidden fields, and the server is what decides them, as it does for a
    // header link it renders; taking them from its answer keeps the next filter change on that sort.
    for (const field of form!.querySelectorAll('input[type="hidden"]')) {
      field.remove();
    }
    for (const field of next.querySelectorAll(
      'form.dashboard-filters input[type="hidden"]',
    )) {
      form!.append(document.importNode(field, true));
    }
    history.replaceState(null, "", address);
  }

  function formAddress(): string {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form!)) {
      // An empty field is "not set"; leaving it out keeps the address as short as the server's own.
      if (typeof value === "string" && value !== "") {
        params.append(key, value);
      }
    }
    const search = params.toString();
    return search === "" ? "/dashboard" : `/dashboard?${search}`;
  }

  function schedule(address: () => string): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void show(address()), DELAY_MS);
  }

  form.addEventListener("input", () => {
    schedule(formAddress);
  });
  form.addEventListener("change", () => {
    schedule(formAddress);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    void show(formAddress());
  });
  results.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a.dashboard-sort",
    );
    if (link === null || event.button !== 0 || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    window.clearTimeout(timer);
    void show(link.getAttribute("href")!);
  });

  // Findings arrive after a save, and an edit changes sizes; either way the rows on screen are stale.
  // A change that adds or removes documents reloads the whole page instead, through live reload.
  const refresh = () => {
    schedule(() => location.pathname + location.search);
  };
  onServerEvent("diagnostics", refresh);
  onServerEvent("change", refresh);
}
