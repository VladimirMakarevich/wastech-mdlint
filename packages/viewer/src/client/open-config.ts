// The config page's "Show in folder" and "Open in default app" buttons. Each asks the server to
// start the system's own program for the config file; the request carries the page's change token
// like a preview or a save, because it makes the machine running the viewer do something. The
// server renders the buttons only where opening is allowed, and hidden, since without this script
// they could do nothing.

const DONE: Record<string, string> = {
  reveal: "Shown in the file manager.",
  open: "Opened in the default application.",
};

export function initOpenConfig(): void {
  const row = document.querySelector<HTMLElement>(".config-open");
  const token = document.querySelector<HTMLMetaElement>(
    'meta[name="wastech-change-token"]',
  )?.content;
  if (row === null || token === undefined) {
    return;
  }
  row.hidden = false;
  const status = row.querySelector<HTMLElement>(".config-open-status");
  for (const button of row.querySelectorAll<HTMLButtonElement>(
    "button[data-open]",
  )) {
    const action = button.dataset.open ?? "";
    button.addEventListener("click", () => {
      button.disabled = true;
      if (status !== null) {
        status.textContent = "";
      }
      void fetch("/api/config/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wastech-Viewer-Token": token,
        },
        body: JSON.stringify({ action }),
      })
        .then(async (response) => {
          const result = (await response.json()) as { error?: string };
          return response.ok
            ? (DONE[action] ?? "Done.")
            : (result.error ?? "The config could not be opened.");
        })
        .catch(() => "The viewer did not answer. Is it still running?")
        .then((message) => {
          if (status !== null) {
            status.textContent = message;
          }
          button.disabled = false;
        });
    });
  }
}
