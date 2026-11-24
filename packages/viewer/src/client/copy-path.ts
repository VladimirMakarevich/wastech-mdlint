import { copyText } from "./clipboard.js";
import { attachMenu } from "./menu.js";

// The copy buttons beside a file's path — in the header of a document or a linked file, and beside
// the config file on the config page. Each offers the path relative to the repository, as links and
// findings name it, and the absolute path on this machine, for a terminal or an editor's "open file".
// The server writes both onto the button; the absolute one only when the viewer is bound to a
// loopback address, so it is not handed to other machines that can reach the port.

const ABSOLUTE_WITHHELD =
  "Not shown: the viewer is reachable from other machines (--host), so it does not reveal where the repository is on this one.";

export function initCopyPath(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button.copy-path",
  )) {
    const relative = button.dataset.path;
    if (relative === undefined) {
      continue;
    }
    // Rendered hidden by the server: without this script the button could do nothing.
    button.hidden = false;
    const absolute = button.dataset.absolutePath;
    attachMenu(button, () => [
      {
        label: "Copy relative path",
        detail: relative,
        run: () => copyText(relative),
      },
      {
        label: "Copy absolute path",
        detail: absolute,
        unavailable: absolute === undefined ? ABSOLUTE_WITHHELD : undefined,
        run: () => copyText(absolute ?? ""),
      },
    ]);
  }
}
