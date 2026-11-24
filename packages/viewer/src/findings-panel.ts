import type { Element } from "hast";
import { h } from "hastscript";

import type { Finding } from "./diagnostics.js";
import { CONTENT_ID } from "./page.js";

// A document's findings, in a panel above its text: severity, rule, message, where on the page it is,
// and a prompt to fix it. Drawn into the page, so a page with findings opens with them in place
// rather than pushing its text down a moment after it is drawn; after a save the page script asks for
// the panel again (`/api/diagnostics/panel`) and puts this same markup in its place.

/** The panel for `relPath`'s findings, or nothing when it has none. */
export function renderFindingsPanel(
  relPath: string,
  findings: readonly Finding[],
): Element | undefined {
  if (findings.length === 0) {
    return undefined;
  }
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = findings.length - errors;
  const count = [
    errors > 0 ? plural(errors, "error") : "",
    warnings > 0 ? plural(warnings, "warning") : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  return h(
    `details.diagnostics${errors > 0 ? ".has-errors" : ""}`,
    { open: true },
    [
      h("summary", [
        // The count in a span of its own, which takes the row's free width and so puts the prompt
        // button for all findings at the row's right end, level with the per-finding buttons under it.
        h("span.diagnostics-title", `wastech-mdlint: ${count}`),
        findings.length > 1 ? promptButton(relPath) : undefined,
      ]),
      h(
        "ul",
        findings.map((finding) => findingRow(relPath, finding)),
      ),
    ],
  );
}

function findingRow(relPath: string, finding: Finding): Element {
  return h(`li.diagnostic.diagnostic-${finding.severity}`, [
    h("span.diagnostic-severity", finding.severity),
    // Linked to the rule's description only when that is a web address: a custom rule's help link
    // comes from the config, and anything else would be a link the page should not offer.
    finding.helpUri !== undefined && /^https?:\/\//i.test(finding.helpUri)
      ? h(
          "a.diagnostic-rule",
          {
            href: finding.helpUri,
            target: "_blank",
            rel: ["noopener", "noreferrer"],
          },
          finding.ruleId,
        )
      : h("span.diagnostic-rule", finding.ruleId),
    h("span.diagnostic-message", finding.message),
    // Findings carry a source line, not an element; the nearest heading above that line is the
    // closest place on the rendered page to send the reader, and above the first heading that is the
    // top of the main column. Line 0 is how a rule reports a finding about the file as a whole, such
    // as its size.
    h(
      "a.diagnostic-line",
      {
        href: `#${finding.anchor ?? CONTENT_ID}`,
      },
      finding.line > 0 ? `line ${finding.line}` : "whole file",
    ),
    promptButton(relPath, finding),
  ]);
}

/**
 * The button that copies a prompt for the document's findings: all of them, or one finding's, by its
 * rule and line. Its menu is the page script's, so it is hidden without it.
 */
function promptButton(
  relPath: string,
  finding?: { ruleId: string; line: number },
): Element {
  return h(
    "button.prompt-menu",
    {
      type: "button",
      hidden: true,
      title:
        finding === undefined
          ? "Copy a prompt that answers every finding in this document"
          : "Copy a prompt that answers this finding",
      dataPath: relPath,
      dataRule: finding?.ruleId,
      // Not `data-line`: inside the article that attribute is a block's source line, and the
      // stylesheet draws it in the right margin of whatever element carries it — a finding's line
      // there showed up as a stray number beside the button.
      dataFindingLine: finding === undefined ? undefined : String(finding.line),
    },
    finding === undefined ? "Prompt for all" : "Prompt",
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
