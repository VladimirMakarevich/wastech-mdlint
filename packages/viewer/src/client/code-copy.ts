import { copyText } from "./clipboard.js";

// The "Copy" button in the corner of every highlighted code block: in a document, in a linked source
// file and in the config page's current file. It copies the block's code as it stands in the file —
// the text of the code element, which holds the lines and the line breaks between them, and none of
// the line numbers, which the stylesheet draws as generated content.

// Long enough to read "Copied", short enough that the button is ready for the next block.
const DONE_MS = 1500;

export function initCodeCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button.code-copy",
  )) {
    const code = button.parentElement?.querySelector("pre code");
    if (code === null || code === undefined) {
      continue;
    }
    // Rendered hidden by the server: without this script the button could do nothing.
    button.hidden = false;
    let timer: number | undefined;
    button.addEventListener("click", () => {
      void copyText(code.textContent).then((copied) => {
        button.textContent = copied ? "Copied" : "Copy failed";
        button.classList.add("is-done");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("is-done");
        }, DONE_MS);
      });
    });
  }
}
