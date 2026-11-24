// The commits that last touched a document: in the line above a changed document's text, and on
// its own above an unchanged one's. Loaded the first time the reader opens it, so no page waits for
// git to walk history; drawn with text nodes only, since a commit subject and an author's name are
// whatever someone typed.

type Commit = {
  short: string;
  date: string;
  subject: string;
  author?: string;
};

export function initHistory(): void {
  for (const details of document.querySelectorAll<HTMLDetailsElement>(
    ".changes-history",
  )) {
    details.hidden = false;
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) {
        return;
      }
      loaded = true;
      void load(details);
    });
  }
}

async function load(details: HTMLDetailsElement): Promise<void> {
  const list = details.querySelector<HTMLOListElement>(".changes-history-list");
  if (list === null) {
    return;
  }
  const status = document.createElement("li");
  status.className = "changes-history-note";
  status.textContent = "Loading…";
  list.replaceChildren(status);
  let commits: Commit[];
  try {
    const response = await fetch(
      `/api/history?${new URLSearchParams({ path: details.dataset.path ?? "" }).toString()}`,
    );
    commits = ((await response.json()) as { commits?: Commit[] }).commits ?? [];
  } catch {
    status.textContent = "The history could not be loaded.";
    return;
  }
  if (commits.length === 0) {
    status.textContent = "No commit touches this document yet.";
    return;
  }
  list.replaceChildren(
    ...commits.map((commit) => {
      const item = document.createElement("li");
      const hash = document.createElement("code");
      hash.textContent = commit.short;
      const when = document.createElement("span");
      when.className = "changes-history-date";
      when.textContent = commit.date;
      const subject = document.createElement("span");
      subject.className = "changes-history-subject";
      subject.textContent = commit.subject;
      item.append(hash, " ", when, " ");
      if (commit.author !== undefined) {
        const author = document.createElement("span");
        author.className = "changes-history-author";
        author.textContent = commit.author;
        item.append(author, " ");
      }
      item.append(subject);
      return item;
    }),
  );
}
