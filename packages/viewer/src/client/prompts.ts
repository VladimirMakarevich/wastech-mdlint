import { copyText } from "./clipboard.js";
import { attachMenu, type MenuItem } from "./menu.js";

// The "Prompt" buttons beside findings: in a document's findings panel, one per finding and one for
// all of them, and one per document with findings on the dashboard. Each opens a menu of the ways
// the findings can be answered — compress, split or a larger budget for a size finding, a fix for
// any other — and copies the chosen prompt for a coding agent. The prompts are written on the
// server, by core, from the latest lint run, so they are fetched as the menu opens: a prompt never
// describes findings the page showed before a save changed them.

type PromptsAnswer = {
  prompts?: { strategy: string; label: string; text: string }[];
  error?: string;
};

/** A prompt button for `path`'s findings: all of them, or one finding's, by its rule and line. */
export function promptButton(
  path: string,
  finding?: { ruleId: string; line: number },
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "prompt-menu";
  button.textContent = finding === undefined ? "Prompt for all" : "Prompt";
  button.title =
    finding === undefined
      ? "Copy a prompt that answers every finding in this document"
      : "Copy a prompt that answers this finding";
  button.dataset.path = path;
  if (finding !== undefined) {
    button.dataset.rule = finding.ruleId;
    button.dataset.line = String(finding.line);
  }
  return button;
}

/** Wire every prompt button under `root` that is not wired yet. */
export function initPromptButtons(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "button.prompt-menu:not([data-ready])",
  )) {
    const path = button.dataset.path;
    if (path === undefined) {
      continue;
    }
    button.dataset.ready = "";
    // Rendered hidden by the server where it renders the button: without this script it could do
    // nothing.
    button.hidden = false;
    const query = new URLSearchParams({ path });
    if (
      button.dataset.rule !== undefined &&
      button.dataset.line !== undefined
    ) {
      query.set("rule", button.dataset.rule);
      query.set("line", button.dataset.line);
    }
    attachMenu(button, () => load(query));
  }
}

async function load(query: URLSearchParams): Promise<MenuItem[]> {
  let answer: PromptsAnswer;
  try {
    answer = (await (
      await fetch(`/api/prompts?${query.toString()}`)
    ).json()) as PromptsAnswer;
  } catch {
    return [];
  }
  if (answer.prompts === undefined) {
    // Shown as the one, disabled entry, so the reader learns why there is nothing to copy.
    return [
      {
        label: "Nothing to copy",
        unavailable: answer.error ?? "The prompts could not be loaded.",
        run: () => Promise.resolve(false),
      },
    ];
  }
  return answer.prompts.map((prompt) => ({
    label: prompt.label,
    run: () => copyText(prompt.text),
  }));
}
