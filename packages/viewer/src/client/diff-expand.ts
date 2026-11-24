// The unchanged lines between a diff's hunks, opened a few at a time. The server puts every one of
// them in the table, hidden, so this only shows rows it was given; without script a diff reads as
// `git diff` prints it, three lines of context around each change.

export function initDiffExpand(): void {
  for (const gap of document.querySelectorAll<HTMLTableSectionElement>(
    "tbody.diff-gap",
  )) {
    const row = gap.querySelector<HTMLTableRowElement>("tr.diff-expand");
    const button = row?.querySelector<HTMLButtonElement>("button");
    if (row === null || button === null || button === undefined) {
      continue;
    }
    row.hidden = false;
    button.addEventListener("click", () => {
      open(gap, row, button);
    });
  }
}

function open(
  gap: HTMLTableSectionElement,
  row: HTMLTableRowElement,
  button: HTMLButtonElement,
): void {
  const step = Number(gap.dataset.step ?? "20");
  const hidden = [
    ...gap.querySelectorAll<HTMLTableRowElement>("tr.diff-line[hidden]"),
  ];
  // Nearest the change first: the bottom of a gap above the first hunk, the top of any other.
  const shown =
    gap.dataset.from === "end" ? hidden.slice(-step) : hidden.slice(0, step);
  for (const line of shown) {
    line.hidden = false;
  }
  const left = hidden.length - shown.length;
  if (left === 0) {
    row.remove();
    return;
  }
  // Above the first hunk the opened lines sit below the button; elsewhere above it, so the button
  // moves down past them and stays next to what is still hidden.
  if (gap.dataset.from !== "end") {
    const last = shown.at(-1);
    last?.after(row);
  }
  button.textContent =
    left <= step
      ? `Show ${left} unchanged line${left === 1 ? "" : "s"}`
      : `Show ${step} of ${left} unchanged lines`;
}
