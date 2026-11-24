// The reader's review marks: the "Viewed" checkbox on each card of the Changes page and above a
// changed document, the button that starts the review over, and the keys that move through what is
// left. The server renders every status, so a page reads right without this script; the script only
// sends a mark and shows the answer — never a mark it was not told was saved.

type ReviewStatus = "unreviewed" | "reviewed" | "changed";

type Saved = {
  status: "saved";
  documents: {
    path: string;
    review: { status: ReviewStatus; hash: string };
    sections?: { key: string; status: ReviewStatus }[];
  }[];
  section?: { key: string; status: ReviewStatus };
  left: number;
  total: number;
};

type Refused = { status: string; error: string };

type ChangedDocument = {
  path: string;
  status: "A" | "M" | "D" | "R";
  anchor: string;
  review: { status: ReviewStatus } | null;
};

const CHIP_TEXT: Record<Exclude<ReviewStatus, "unreviewed">, string> = {
  reviewed: "Reviewed",
  changed: "Changed since review",
};

export function initReview(documentPath: string | undefined): void {
  // Carried only by the pages that may send a mark, and only where marks are on.
  const token = document.querySelector<HTMLMetaElement>(
    'meta[name="wastech-change-token"]',
  )?.content;
  const toggles = [
    ...document.querySelectorAll<HTMLLabelElement>(".review-toggle"),
  ];
  if (token === undefined || toggles.length === 0) {
    return;
  }
  for (const toggle of toggles) {
    toggle.hidden = false;
    const input = toggle.querySelector("input");
    input?.addEventListener("change", () => {
      void mark(toggle, input, token);
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".section-mark",
  )) {
    button.hidden = false;
    button.addEventListener("click", () => {
      void markSection(button, token);
    });
  }
  const reset = document.querySelector<HTMLButtonElement>(".review-reset");
  if (reset !== null) {
    reset.hidden = false;
    reset.addEventListener("click", () => {
      void resetReview(reset, toggles, token);
    });
  }
  document.addEventListener("keydown", (event) => {
    onKey(event, toggles, documentPath);
  });
}

async function mark(
  toggle: HTMLLabelElement,
  input: HTMLInputElement,
  token: string,
): Promise<void> {
  const reviewed = input.checked;
  input.disabled = true;
  const answer = await post(token, "/api/review/mark", {
    path: toggle.dataset.path,
    hash: toggle.dataset.hash,
    reviewed,
    worktree: toggle.dataset.worktree === "1",
  });
  input.disabled = false;
  if (answer.status !== "saved") {
    // The mark is not shown as set until the server says it was written.
    input.checked = !reviewed;
    say(toggle, (answer as Refused).error);
    return;
  }
  const saved = answer as Saved;
  const status = saved.documents[0]?.review.status ?? "unreviewed";
  input.checked = status === "reviewed";
  say(toggle, "");
  showStatus(toggle, status);
  showSections(saved.documents[0]?.sections ?? []);
  showSectionProgress(toggle, saved.documents[0]?.sections ?? []);
  showCount(saved);
}

/**
 * The card's "2 of 5 sections", restated from the sections the server answered with: marking a
 * document as a whole marks or clears its sections with it, so the count the page was served with
 * no longer holds. Shown under the same rule as the server's: only while some are viewed and some
 * are not.
 */
function showSectionProgress(
  toggle: HTMLLabelElement,
  sections: readonly { status: ReviewStatus }[],
): void {
  const card = toggle.closest<HTMLElement>(".change-card");
  if (card === null) {
    return;
  }
  card.querySelector(":scope > header .review-sections")?.remove();
  const reviewed = sections.filter(
    (section) => section.status === "reviewed",
  ).length;
  if (reviewed === 0 || reviewed === sections.length) {
    return;
  }
  const progress = document.createElement("span");
  progress.className = "review-sections";
  progress.title = "Sections viewed from the document's outline";
  progress.textContent = `${String(reviewed)} of ${String(sections.length)} sections`;
  card.querySelector(":scope > header .change-stats")?.before(progress);
}

/**
 * Mark one section from the outline, and show what the server answered: the section, and the
 * document, which is reviewed once every one of its sections is.
 */
async function markSection(
  button: HTMLButtonElement,
  token: string,
): Promise<void> {
  const reviewed = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;
  const answer = await post(token, "/api/review/section", {
    path: button.dataset.path,
    section: button.dataset.section,
    hash: button.dataset.hash,
    reviewed,
  });
  button.disabled = false;
  const toggle = document.querySelector<HTMLLabelElement>(
    ".changes-banner .review-toggle",
  );
  if (answer.status !== "saved") {
    if (toggle !== null) {
      say(toggle, (answer as Refused).error);
    }
    return;
  }
  const saved = answer as Saved;
  if (saved.section !== undefined) {
    showSections([saved.section]);
  }
  const status = saved.documents[0]?.review.status;
  if (toggle !== null && status !== undefined) {
    const input = toggle.querySelector("input");
    if (input !== null) {
      input.checked = status === "reviewed";
    }
    say(toggle, "");
    showStatus(toggle, status);
  }
  showCount(saved);
}

const SECTION_TITLES: Record<ReviewStatus, string> = {
  reviewed: "Viewed",
  changed: "Changed since you viewed it",
  unreviewed: "Not viewed yet",
};

function showSections(
  sections: readonly { key: string; status: ReviewStatus }[],
): void {
  for (const section of sections) {
    const button = document.querySelector<HTMLButtonElement>(
      `.section-mark[data-section="${CSS.escape(section.key)}"]`,
    );
    if (button === null) {
      continue;
    }
    button.setAttribute(
      "aria-pressed",
      section.status === "reviewed" ? "true" : "false",
    );
    button.title = SECTION_TITLES[section.status];
    const item = button.closest<HTMLElement>("li");
    if (item !== null) {
      item.dataset.review = section.status;
    }
  }
}

function showCount(saved: Saved): void {
  const count = document.querySelector(".changes-review-count");
  if (count !== null) {
    count.textContent = `${String(saved.total - saved.left)} of ${String(saved.total)} ${
      saved.total === 1 ? "document" : "documents"
    } reviewed`;
  }
}

// Marks the card or banner the checkbox belongs to, and the card's row in the list above the cards.
function showStatus(toggle: HTMLLabelElement, status: ReviewStatus): void {
  const card = toggle.closest<HTMLElement>(".change-card");
  const holder = card ?? toggle.closest<HTMLElement>(".changes-banner");
  if (holder === null) {
    return;
  }
  holder.dataset.review = status;
  placeChip(holder, status, toggle);
  if (card === null) {
    return;
  }
  if (status === "reviewed") {
    // Folded as the server folds a reviewed card, so what is left stands out.
    const diff = card.querySelector<HTMLDetailsElement>("details.change-diff");
    if (diff !== null) {
      diff.open = false;
    }
  }
  const row = document
    .querySelector(`.changes-files a[href="#${CSS.escape(card.id)}"]`)
    ?.closest<HTMLElement>("li");
  if (row !== null && row !== undefined) {
    row.dataset.review = status;
    placeChip(row, status, null);
  }
}

function placeChip(
  holder: HTMLElement,
  status: ReviewStatus,
  toggle: HTMLLabelElement | null,
): void {
  holder.querySelector(":scope .review-chip")?.remove();
  if (status === "unreviewed") {
    return;
  }
  const chip = document.createElement("span");
  chip.className = `review-chip review-chip-${status}`;
  chip.textContent = CHIP_TEXT[status];
  // Where the server puts it: before the line counts on a card, after the text on the banner,
  // at the end of a row of the list.
  const stats = holder.querySelector(":scope > header .change-stats");
  const text = holder.querySelector(":scope > .changes-banner-text");
  if (stats !== null) {
    stats.before(chip);
  } else if (text !== null) {
    text.after(chip);
  } else if (toggle !== null) {
    toggle.before(chip);
  } else {
    holder.append(chip);
  }
}

async function resetReview(
  button: HTMLButtonElement,
  toggles: readonly HTMLLabelElement[],
  token: string,
): Promise<void> {
  if (
    !window.confirm(
      "Forget every review mark of the documents listed here, including the versions reviewed before?",
    )
  ) {
    return;
  }
  button.disabled = true;
  const answer = await post(token, "/api/review/reset", {
    worktree: toggles[0]?.dataset.worktree === "1",
    documents: toggles.map((toggle) => ({
      path: toggle.dataset.path,
      hash: toggle.dataset.hash,
    })),
  });
  button.disabled = false;
  if (answer.status !== "saved") {
    say(button, (answer as Refused).error);
    return;
  }
  location.reload();
}

async function post(
  token: string,
  url: string,
  body: unknown,
): Promise<{ status: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wastech-Viewer-Token": token,
      },
      body: JSON.stringify(body),
    });
    return (await response.json()) as { status: string };
  } catch {
    return {
      status: "failed",
      error: "The viewer did not answer; the mark was not saved.",
    } as Refused;
  }
}

// One line under the control that failed, read out by assistive technology; empty once it works.
function say(near: HTMLElement, message: string): void {
  const holder =
    near.closest<HTMLElement>(
      ".change-card, .changes-banner, .changes-review",
    ) ?? near.parentElement;
  if (holder === null) {
    return;
  }
  let line = holder.querySelector<HTMLElement>(":scope > .review-message");
  if (line === null) {
    if (message === "") {
      return;
    }
    line = document.createElement("p");
    line.className = "review-message";
    line.setAttribute("role", "status");
    holder.append(line);
  }
  line.textContent = message;
  line.hidden = message === "";
}

/**
 * `v` marks the card being read, or the open document; `n` and `p` go to the next and previous
 * document not yet reviewed, in the order the Changes page lists them. Only bare keys, and never
 * while the reader is typing: the search box and the config editor take letters as text.
 */
function onKey(
  event: KeyboardEvent,
  toggles: readonly HTMLLabelElement[],
  documentPath: string | undefined,
): void {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTyping(event.target)
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== "v" && key !== "n" && key !== "p") {
    return;
  }
  event.preventDefault();
  const cards = [
    ...document.querySelectorAll<HTMLElement>(".change-card"),
  ].filter((card) => card.querySelector(".review-toggle") !== null);
  if (cards.length === 0) {
    // A document's page: its own banner, and the list the Changes page would show.
    if (key === "v") {
      toggles[0]?.querySelector("input")?.click();
    } else if (documentPath !== undefined && toggles[0] !== undefined) {
      void goToDocument(toggles[0], documentPath, key === "n" ? 1 : -1);
    }
    return;
  }
  const current = currentCard(cards);
  if (key === "v") {
    current?.querySelector<HTMLInputElement>(".review-toggle input")?.click();
    return;
  }
  const step = key === "n" ? 1 : -1;
  const start = current === undefined ? -1 : cards.indexOf(current);
  for (
    let index = start + step;
    index >= 0 && index < cards.length;
    index += step
  ) {
    const card = cards[index]!;
    if (card.dataset.review !== "reviewed") {
      card.scrollIntoView({ block: "start" });
      history.replaceState(null, "", `#${card.id}`);
      card
        .querySelector<HTMLInputElement>(".review-toggle input")
        ?.focus({ preventScroll: true });
      return;
    }
  }
  const toggle = current?.querySelector<HTMLLabelElement>(".review-toggle");
  if (toggle !== null && toggle !== undefined) {
    say(
      toggle,
      step === 1
        ? "Nothing left to review below this one."
        : "Nothing left to review above this one.",
    );
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return target.type !== "checkbox" && target.type !== "radio";
  }
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

// The card holding the focus, else the first card still in view below the header.
function currentCard(cards: readonly HTMLElement[]): HTMLElement | undefined {
  const focused = document.activeElement?.closest<HTMLElement>(".change-card");
  if (focused !== null && focused !== undefined && cards.includes(focused)) {
    return focused;
  }
  const header = document.querySelector(".topbar")?.getBoundingClientRect();
  const top = (header?.bottom ?? 0) + 8;
  return cards.find((card) => card.getBoundingClientRect().bottom > top);
}

async function goToDocument(
  toggle: HTMLLabelElement,
  documentPath: string,
  step: 1 | -1,
): Promise<void> {
  let documents: ChangedDocument[];
  try {
    const data = (await (await fetch("/api/changes")).json()) as {
      documents?: ChangedDocument[];
    };
    documents = data.documents ?? [];
  } catch {
    return;
  }
  const start = documents.findIndex((entry) => entry.path === documentPath);
  for (
    let index = start + step;
    index >= 0 && index < documents.length;
    index += step
  ) {
    const entry = documents[index]!;
    if (entry.review !== null && entry.review.status !== "reviewed") {
      // A deleted document has no page; its card on the Changes page is where it is reviewed. The
      // page's own way of showing changes goes along, so stepping through keeps the same view.
      location.href =
        entry.status === "D"
          ? `/changes#${entry.anchor}`
          : `/doc/${entry.path.split("/").map(encodeURIComponent).join("/")}${location.search}`;
      return;
    }
  }
  say(
    toggle,
    step === 1
      ? "Nothing left to review after this document."
      : "Nothing left to review before this document.",
  );
}
