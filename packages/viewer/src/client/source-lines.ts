// A document's link to a span of a file is written the GitHub way, `file.ts#L12-L20`. Single lines
// work without script because each line has an `id`; a range names no element, so it is resolved
// here: the lines are marked and the first one is scrolled into view.

export function initSourceLines(): void {
  if (document.querySelector(".source-view") === null) {
    return;
  }
  highlightLineRange();
  window.addEventListener("hashchange", highlightLineRange);
}

function highlightLineRange(): void {
  for (const line of document.querySelectorAll(".line.is-selected")) {
    line.classList.remove("is-selected");
  }
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(location.hash);
  if (match === null) {
    return;
  }
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  for (
    let number = Math.min(first, last);
    number <= Math.max(first, last);
    number += 1
  ) {
    document.getElementById(`L${number}`)?.classList.add("is-selected");
  }
  document
    .getElementById(`L${Math.min(first, last)}`)
    ?.scrollIntoView({ block: "center" });
}
