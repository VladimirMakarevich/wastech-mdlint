import { describe, expect, it } from "vitest";

import { codeLanguageFindings } from "../src/engine/rules/ctx-code-language.js";
import { parseDocument } from "../src/markdown/parse-document.js";

const MISSING =
  "Fenced code block has no language; name one after the opening fence, such as `bash`.";

function findings(content: string, allowed?: readonly string[]) {
  return codeLanguageFindings(
    parseDocument({ path: "doc.md", content }),
    allowed === undefined ? {} : { allowed: new Set(allowed) },
  );
}

describe("CTX-006 fenced code language", () => {
  it("reports a fence without an info string at the opening fence and passes `bash`", () => {
    expect(
      findings("# T\n\n```\nls\n```\n\n```bash\nls\n```\n\n~~~\nls\n~~~\n"),
    ).toEqual([
      { message: MISSING, line: 3, column: 1, data: { language: "" } },
      { message: MISSING, line: 11, column: 1, data: { language: "" } },
    ]);
  });

  it("does not report indented code blocks, which cannot carry a language", () => {
    expect(findings("Text.\n\n    ls -la\n\n\tls\n")).toEqual([]);
  });

  it("returns nothing for a document without code", () => {
    expect(findings("# Title\n\nUse `ls` here.\n")).toEqual([]);
  });

  it("reports a language outside `allowed`, comparing case-insensitively", () => {
    expect(
      findings("```BASH\nx\n```\n\n```python\nx\n```\n\n```json\n{}\n```\n", [
        "bash",
        "json",
      ]),
    ).toEqual([
      {
        message:
          'Fenced code block language "python" is not in the allowed list.',
        line: 5,
        column: 1,
        data: { language: "python" },
      },
    ]);
  });

  // An empty language is never in an allow-list; one missing-language finding says it, not two.
  it("still reports a fence with no language under `allowed`, once, with the missing-language message", () => {
    expect(findings("```\nx\n```\n", ["bash"])).toEqual([
      { message: MISSING, line: 1, column: 1, data: { language: "" } },
    ]);
  });

  it("does not interpret an attribute-style info string", () => {
    expect(
      findings("```{.python}\nx\n```\n", ["python"]).map(
        (finding) => finding.data?.language,
      ),
    ).toEqual(["{.python}"]);
  });

  // micromark drops a leading byte order mark before it parses, while the fenced/indented test reads
  // the byte at the node's offset in the file's own text, mark included.
  it("reports a fence in a file that starts with a byte order mark", () => {
    expect(findings("\uFEFF```\nls\n```\n\n```bash\nls\n```\n")).toEqual([
      { message: MISSING, line: 1, column: 1, data: { language: "" } },
    ]);
  });

  it("gives the same positions for a CRLF document", () => {
    expect(findings("# T\r\n\r\n```\r\nx\r\n```\r\n")).toEqual([
      { message: MISSING, line: 3, column: 1, data: { language: "" } },
    ]);
  });
});
