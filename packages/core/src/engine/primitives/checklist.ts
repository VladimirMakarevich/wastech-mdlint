import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "./types.js";

export type AllCheckedOptions = { section?: string };

// allChecked — every task-list item must be checked (CTX-002). With `section`, only items under that
// section are considered.
export function allChecked(
  document: ParsedDocument,
  options: AllCheckedOptions
): PrimitiveFinding[] {
  const items =
    options.section === undefined
      ? document.checkItems
      : document.checkItems.filter((item) => item.section === options.section);

  return items
    .filter((item) => !item.checked)
    .map((item) => ({
      message: `Checklist item is not checked: "${item.text}".`,
      line: item.line,
      data: { text: item.text, section: item.section }
    }));
}
