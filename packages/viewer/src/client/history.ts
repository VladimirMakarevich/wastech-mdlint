// The commits that last touched a document: in the line above a changed document's text, and on
// its own above an unchanged one's. Loaded the first time the reader opens it, so no page waits for
// git to walk history; drawn with text nodes only, since a commit subject and an author's name are
// whatever someone typed.

export type Commit = {
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
      // A history that could not be read is asked for again the next time the reader opens it: a
      // network hiccup or a viewer restarting is not an answer to keep.
      void load(details).then((answered) => {
        loaded = answered;
      });
    });
  }
}

/**
 * What `/api/history` answered: the commits, or the note shown in their place and whether it is an
 * answer (no commit yet) rather than a failure to ask about again. A refusal — git gone, the document
 * no longer in the corpus — says why, rather than reading as a document no commit has touched.
 */
export function readHistory(
  ok: boolean,
  answer: { commits?: Commit[]; error?: string },
): { commits: Commit[] } | { note: string; answered: boolean } {
  if (!ok || answer.commits === undefined) {
    return {
      note: answer.error ?? "The history could not be loaded.",
      answered: false,
    };
  }
  return answer.commits.length === 0
    ? { note: "No commit touches this document yet.", answered: true }
    : { commits: answer.commits };
}

// Whether the server answered with the history, so it need not be asked again.
async function load(details: HTMLDetailsElement): Promise<boolean> {
  const list = details.querySelector<HTMLOListElement>(".changes-history-list");
  if (list === null) {
    return true;
  }
  const status = document.createElement("li");
  status.className = "changes-history-note";
  status.textContent = "Loading…";
  list.replaceChildren(status);
  let answer: { commits?: Commit[]; error?: string };
  let ok: boolean;
  try {
    const response = await fetch(
      `/api/history?${new URLSearchParams({ path: details.dataset.path ?? "" }).toString()}`,
    );
    ok = response.ok;
    answer = (await response.json()) as typeof answer;
  } catch {
    status.textContent = "The history could not be loaded.";
    return false;
  }
  const read = readHistory(ok, answer);
  if ("note" in read) {
    status.textContent = read.note;
    return read.answered;
  }
  const { commits } = read;
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
  return true;
}
