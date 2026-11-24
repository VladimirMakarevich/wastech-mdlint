import { effectiveTheme, onThemeChange, type Theme } from "./theme-toggle.js";

// Mermaid diagrams are drawn here, in the browser, from the source the server leaves in each
// `.mermaid-diagram`. The source stays in the page after drawing (hidden by CSS), because a theme
// change redraws every diagram from it: Mermaid writes its colors into the SVG, so CSS cannot
// recolor one.

type Mermaid = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

let mermaid: Promise<Mermaid> | undefined;
let initializedFor: Theme | undefined;
let diagramCount = 0;
// Draws run one after another: a theme switch during a draw would otherwise race it and leave a
// diagram in whichever theme finished last.
let queue: Promise<void> = Promise.resolve();

export function initDiagrams(): void {
  if (document.querySelector(".mermaid-diagram") === null) {
    return;
  }
  schedule();
  onThemeChange(() => {
    for (const block of document.querySelectorAll<HTMLElement>(
      ".mermaid-diagram",
    )) {
      delete block.dataset.state;
    }
    schedule();
  });
}

function schedule(): void {
  queue = queue.then(drawPending);
}

// Mermaid is several megabytes, so it is fetched only by a page that has a diagram on it.
async function loadMermaid(theme: Theme): Promise<Mermaid> {
  // A variable, not a literal, so TypeScript does not try to resolve a URL as a module.
  const url = "/vendor/mermaid/mermaid.esm.min.mjs";
  mermaid ??= (import(url) as Promise<{ default: Mermaid }>).then(
    (module) => module.default,
  );
  const instance = await mermaid;
  if (initializedFor !== theme) {
    instance.initialize({
      startOnLoad: false,
      // Strict keeps click handlers and raw HTML labels out of diagrams, which are as untrusted as
      // the Markdown they come from.
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
    });
    initializedFor = theme;
  }
  return instance;
}

async function drawPending(): Promise<void> {
  const blocks = document.querySelectorAll<HTMLElement>(
    ".mermaid-diagram:not([data-state])",
  );
  for (const block of blocks) {
    // A diagram drawn inside a closed <details> measures as zero-sized and comes out collapsed, so
    // it waits until its section is opened.
    const closed = block.closest("details:not([open])");
    if (closed !== null) {
      closed.addEventListener("toggle", schedule, { once: true });
      continue;
    }
    const source = block.querySelector(".mermaid-source")?.textContent ?? "";
    try {
      // Fonts change text width; measuring before they load leaves labels overflowing their boxes.
      await document.fonts.ready;
      const instance = await loadMermaid(effectiveTheme());
      diagramCount += 1;
      const { svg } = await instance.render(
        `wastech-mermaid-${diagramCount}`,
        source,
      );
      let target = block.querySelector<HTMLElement>(".mermaid-svg");
      if (target === null) {
        target = document.createElement("div");
        target.className = "mermaid-svg";
        block.append(target);
      }
      target.innerHTML = svg;
      block.querySelector(".mermaid-error")?.remove();
      block.dataset.state = "rendered";
    } catch (error) {
      // The source stays on the page; the message says why it is not a picture.
      block.dataset.state = "failed";
      block.querySelector(".mermaid-svg")?.remove();
      let message = block.querySelector<HTMLElement>(".mermaid-error");
      if (message === null) {
        message = document.createElement("p");
        message.className = "mermaid-error";
        block.prepend(message);
      }
      message.textContent = `Diagram could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
