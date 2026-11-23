// A changed block's bar, made a button: a click shows the block's hunks from the source diff right
// below it, and a second click hides them again. The marks themselves are on the page from the server;
// so are the hunks, as one inert template rendered by the code that renders the Changes page, so the
// diff shown here is that diff and never one drawn a second way.

export function initChangeMarks(): void {
  const template = document.querySelector<HTMLTemplateElement>(
    "template.change-hunks",
  );
  if (template === null) {
    return;
  }
  let opened = 0;
  for (const block of document.querySelectorAll<HTMLElement>(
    ".markdown-body [data-change-hunks]",
  )) {
    // A closed <details> renders nothing but its summary, so a button inside it would be invisible
    // until it opened; the bar there stays a mark only, and the Source view shows its change.
    if (block.tagName === "DETAILS") {
      continue;
    }
    const hunks = (block.dataset.changeHunks ?? "").split(" ").filter(Boolean);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "change-bar";
    const what = block.dataset.change === "added" ? "added" : "changed";
    button.title = `Show what ${what} here`;
    button.setAttribute("aria-label", `Show what ${what} here`);
    button.setAttribute("aria-expanded", "false");
    let shown: HTMLElement | undefined;
    button.addEventListener("click", () => {
      if (shown !== undefined) {
        shown.remove();
        shown = undefined;
        button.setAttribute("aria-expanded", "false");
        return;
      }
      shown = document.createElement("div");
      shown.className = "change-hunk-view";
      // Contains a `.`, as every id the viewer makes does, so no heading slug can be the same id.
      shown.id = `viewer.hunk-view.${(opened += 1)}`;
      for (const index of hunks) {
        const hunk = template.content.querySelector(
          `.change-hunk[data-hunk="${index}"]`,
        );
        if (hunk !== null) {
          shown.append(hunk.cloneNode(true));
        }
      }
      button.setAttribute("aria-controls", shown.id);
      button.setAttribute("aria-expanded", "true");
      // A list item holds only flow content, so its hunks go inside it, after its text; any other
      // block is followed by them.
      if (block.tagName === "LI") {
        block.append(shown);
      } else {
        block.after(shown);
      }
    });
    block.prepend(button);
  }
}
