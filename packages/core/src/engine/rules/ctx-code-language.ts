import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Fenced-code language check for CTX-006. Pure over the parsed document, so it needs no filesystem
// to test.
//
// The language word after an opening fence tells an agent whether a block is a command to run, a
// config to write or output to compare against; without it the agent has to guess. The edges:
//
// - Only fenced blocks are judged. An indented code block has no info string, so it cannot carry
//   a language and the parser never lists it in `codeFences`.
// - The language is the first word of the info string as the parser gave it. Nothing is
//   interpreted: `{.python}` is its own word, not `python`.
// - With `allowed`, a language outside the list is reported. The comparison is case-insensitive,
//   because highlighters treat `BASH` and `bash` alike, and uses `toLowerCase` rather than
//   `toLocaleLowerCase` so the result never depends on the host locale. The caller passes the
//   list already lower-cased.
// - A fence with no language is reported with the missing-language message whether or not
//   `allowed` is set: an empty language is never in the list, and one finding per fence says more
//   than two would.
//
// One pass over `codeFences` in document order with all state local to the call, so the findings'
// order is fixed by the document alone.
export function codeLanguageFindings(
  document: ParsedDocument,
  options: { allowed?: ReadonlySet<string> },
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const fence of document.codeFences) {
    if (fence.language === "") {
      findings.push({
        message:
          "Fenced code block has no language; name one after the opening fence, such as `bash`.",
        line: fence.line,
        column: fence.column,
        data: { language: "" },
      });
      continue;
    }
    if (
      options.allowed !== undefined &&
      !options.allowed.has(fence.language.toLowerCase())
    ) {
      findings.push({
        message: `Fenced code block language "${fence.language}" is not in the allowed list.`,
        line: fence.line,
        column: fence.column,
        data: { language: fence.language },
      });
    }
  }

  return findings;
}
