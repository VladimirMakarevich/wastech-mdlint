// Turns the header's search form into a live list of matches. The form also works without this
// script — it submits to `/search`, which renders the same results as a page — so this only adds
// typing-as-you-go, keyboard selection and the Ctrl+K shortcut.

type SearchHit = {
  path: string;
  title: string;
  href: string;
  snippet: string;
  terms: string[];
};

// Fewer characters than this match most of the corpus and say nothing useful.
const MIN_QUERY_LENGTH = 2;

export function initSearch(): void {
  const form = document.querySelector<HTMLFormElement>("form.search");
  const input = form?.querySelector<HTMLInputElement>('input[name="q"]');
  if (
    form === null ||
    form === undefined ||
    input === null ||
    input === undefined
  ) {
    return;
  }

  const list = document.createElement("ul");
  list.className = "search-results";
  // With a `.`, which no heading slug contains, so a document's heading "Search results" cannot take
  // the id the input's `aria-controls` names; the hits below follow the same rule.
  list.id = "viewer.search-results";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  form.append(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  let hits: SearchHit[] = [];
  let active = -1;
  let timer: number | undefined;
  // Responses can arrive out of order; only the newest query's answer is shown.
  let latestRequest = 0;

  function close(): void {
    list.hidden = true;
    input!.setAttribute("aria-expanded", "false");
    input!.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function select(index: number): void {
    active = index;
    for (const [position, item] of [...list.children].entries()) {
      item.setAttribute("aria-selected", String(position === index));
    }
    if (index >= 0) {
      input!.setAttribute(
        "aria-activedescendant",
        `viewer.search-hit-${index}`,
      );
      list.children[index]?.scrollIntoView({ block: "nearest" });
    } else {
      input!.removeAttribute("aria-activedescendant");
    }
  }

  function render(query: string): void {
    list.replaceChildren(
      ...(hits.length === 0
        ? [emptyItem(`No documents match “${query}”.`)]
        : hits.map((hit, index) => hitItem(hit, index))),
    );
    list.hidden = false;
    input!.setAttribute("aria-expanded", "true");
    select(-1);
  }

  async function run(): Promise<void> {
    const query = input!.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      // Outdates any answer still on its way: it is for the longer query the reader has just
      // shortened, and would reopen the list with results for text the box no longer holds.
      latestRequest += 1;
      hits = [];
      close();
      return;
    }
    const request = ++latestRequest;
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      const data = (await response.json()) as { results: SearchHit[] };
      if (request !== latestRequest) {
        return;
      }
      hits = data.results;
      render(query);
    } catch {
      // The server went away (it is restarting, or was stopped); the form still submits normally.
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 120);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !list.hidden && hits.length > 0) {
      event.preventDefault();
      select((active + 1) % hits.length);
    } else if (event.key === "ArrowUp" && !list.hidden && hits.length > 0) {
      event.preventDefault();
      select(active <= 0 ? hits.length - 1 : active - 1);
    } else if (event.key === "Enter" && active >= 0 && !list.hidden) {
      // With nothing selected, Enter submits the form and opens the full results page instead.
      event.preventDefault();
      location.href = hits[active]!.href;
    } else if (event.key === "Escape") {
      close();
      input.blur();
    }
  });

  input.addEventListener("focus", () => {
    if (hits.length > 0 && input.value.trim().length >= MIN_QUERY_LENGTH) {
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target as Node)) {
      close();
    }
  });

  // Ctrl+K (Cmd+K on macOS) from anywhere, and `/` when the reader is not already typing — the two
  // shortcuts documentation sites have taught people to reach for.
  document.addEventListener("keydown", (event) => {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
    if (
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
      (event.key === "/" && !typing)
    ) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function hitItem(hit: SearchHit, index: number): HTMLLIElement {
  const item = document.createElement("li");
  item.id = `viewer.search-hit-${index}`;
  item.setAttribute("role", "option");
  const link = document.createElement("a");
  link.href = hit.href;
  const title = document.createElement("span");
  title.className = "search-hit-title";
  title.append(...highlighted(hit.title, hit.terms));
  const path = document.createElement("span");
  path.className = "search-hit-path";
  path.textContent = hit.path;
  const snippet = document.createElement("span");
  snippet.className = "search-hit-snippet";
  snippet.append(...highlighted(hit.snippet, hit.terms));
  link.append(title, path, snippet);
  item.append(link);
  return item;
}

function emptyItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "search-empty";
  item.textContent = text;
  return item;
}

// Built from text nodes and <mark> elements, never from HTML strings: titles and snippets are
// repository text, as untrusted as the documents they come from.
function highlighted(text: string, terms: readonly string[]): Node[] {
  const escaped = terms
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return [document.createTextNode(text)];
  }
  const pattern = new RegExp(`(${escaped.join("|")})`, "giu");
  return text.split(pattern).map((part, index) => {
    if (index % 2 === 0) {
      return document.createTextNode(part);
    }
    const mark = document.createElement("mark");
    mark.textContent = part;
    return mark;
  });
}
