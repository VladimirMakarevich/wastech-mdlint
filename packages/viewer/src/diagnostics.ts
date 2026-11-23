import type {
  LintMessage,
  LintResult,
  ParsedDocument,
  Severity,
} from "@wastech-mdlint/core";

import { headingAbove } from "./render-document.js";

// The latest lint result, held for the pages and the tree to read. Linting itself is core's
// (`Corpus.lint`, which runs `lintContext` over the corpus already in memory); this only groups the
// findings by file and translates a finding's source line into a place on the rendered page.

export type Finding = {
  ruleId: string;
  severity: Severity;
  message: string;
  line: number;
  // The heading the finding sits under, as a page anchor.
  anchor?: string;
  helpUri?: string;
};

export type FileCounts = { errors: number; warnings: number };

export class Diagnostics {
  // Undefined until the first lint finishes, so a page can tell "not checked yet" from "clean".
  private byFile: Map<string, LintMessage[]> | undefined;

  get ready(): boolean {
    return this.byFile !== undefined;
  }

  update(result: LintResult): void {
    const byFile = new Map<string, LintMessage[]>();
    for (const message of result.messages) {
      const list = byFile.get(message.filePath);
      if (list === undefined) {
        byFile.set(message.filePath, [message]);
      } else {
        list.push(message);
      }
    }
    this.byFile = byFile;
  }

  /** Counts per file, for files with at least one finding. */
  summary(): Record<string, FileCounts> {
    const counts: Record<string, FileCounts> = {};
    for (const [filePath, messages] of this.byFile ?? []) {
      const errors = messages.filter(
        (message) => message.severity === "error",
      ).length;
      counts[filePath] = { errors, warnings: messages.length - errors };
    }
    return counts;
  }

  findings(document: ParsedDocument): Finding[] {
    return (this.byFile?.get(document.path) ?? []).map((message) => ({
      ruleId: message.ruleId,
      severity: message.severity,
      message: message.message,
      line: message.line,
      anchor: headingAbove(document, message.line)?.slug,
      helpUri: message.helpUri,
    }));
  }
}
