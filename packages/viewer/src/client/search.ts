// Turns the header's search form into a live list of matches. The form also works without this
// script - it submits to `/search`, which renders the same results as a page - so this only adds
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
  if (form === null || input === null || input === undefined) {
    return;
  }
  const box = new LiveSearch(input, resultList(form, input));

  input.addEventListener("input", () => {
    box.schedule();
  });
  input.addEventListener("keydown", (event) => {
    box.onKey(event);
  });
  input.addEventListener("focus", () => {
    box.reopen();
  });
  document.addEventListener("click", (event) => {
    if (!form.contains(event.target as Node)) {
      box.close();
    }
  });
  bindShortcuts(input);
}

function resultList(
  form: HTMLFormElement,
  input: HTMLInputElement,
): HTMLUListElement {
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
  return list;
}

// Ctrl+K (Cmd+K on macOS) from anywhere, and `/` when the reader is not already typing - the two
// shortcuts documentation sites have taught people to reach for.
function bindShortcuts(input: HTMLInputElement): void {
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

// The state of one search box: the hits on show, which of them the keyboard has selected, and which
// request is the newest.
class LiveSearch {
  private hits: SearchHit[] = [];
  private active = -1;
  private timer: number | undefined;
  // Responses can arrive out of order; only the newest query's answer is shown.
  private latestRequest = 0;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLUListElement,
  ) {}

  schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), 120);
  }

  close(): void {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
    this.active = -1;
  }

  reopen(): void {
    if (
      this.hits.length > 0 &&
      this.input.value.trim().length >= MIN_QUERY_LENGTH
    ) {
      this.list.hidden = false;
      this.input.setAttribute("aria-expanded", "true");
    }
  }

  onKey(event: KeyboardEvent): void {
    const listed = !this.list.hidden && this.hits.length > 0;
    if (event.key === "ArrowDown" && listed) {
      event.preventDefault();
      this.select((this.active + 1) % this.hits.length);
    } else if (event.key === "ArrowUp" && listed) {
      event.preventDefault();
      this.select(this.active <= 0 ? this.hits.length - 1 : this.active - 1);
    } else if (event.key === "Enter" && this.active >= 0 && !this.list.hidden) {
      // With nothing selected, Enter submits the form and opens the full results page instead.
      event.preventDefault();
      location.href = this.hits[this.active]!.href;
    } else if (event.key === "Escape") {
      this.close();
      this.input.blur();
    }
  }

  private select(index: number): void {
    this.active = index;
    for (const [position, item] of [...this.list.children].entries()) {
      item.setAttribute("aria-selected", String(position === index));
    }
    if (index >= 0) {
      this.input.setAttribute(
        "aria-activedescendant",
        `viewer.search-hit-${index}`,
      );
      this.list.children[index]?.scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private render(query: string): void {
    this.list.replaceChildren(
      ...(this.hits.length === 0
        ? [emptyItem(`No documents match “${query}”.`)]
        : this.hits.map((hit, index) => hitItem(hit, index))),
    );
    this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
    this.select(-1);
  }

  private async run(): Promise<void> {
    const query = this.input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      // Outdates any answer still on its way: it is for the longer query the reader has just
      // shortened, and would reopen the list with results for text the box no longer holds.
      this.latestRequest += 1;
      this.hits = [];
      this.close();
      return;
    }
    const request = ++this.latestRequest;
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      const data = (await response.json()) as { results: SearchHit[] };
      if (request !== this.latestRequest) {
        return;
      }
      this.hits = data.results;
      this.render(query);
    } catch {
      // The server went away (it is restarting, or was stopped); the form still submits normally.
    }
  }
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
