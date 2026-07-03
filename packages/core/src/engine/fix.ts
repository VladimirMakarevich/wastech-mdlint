import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import type { LintFilesInput } from "./lint-files.js";
import type { RuleContext, TextEdit } from "./types.js";

/**
 * Apply offset-based edits to content (P3.02 fix engine). Edits are applied from the highest offset
 * down so earlier offsets stay valid; overlapping edits are skipped (last-writer-wins by position)
 * so a malformed rule can never corrupt the file.
 */
export function applyEdits(content: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  let result = content;
  let lastStart = Number.POSITIVE_INFINITY;

  for (const edit of sorted) {
    if (edit.end > lastStart) {
      continue;
    }
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
    lastStart = edit.start;
  }

  return result;
}

export type ApplyFixesResult = { fixedFiles: string[] };

/**
 * Apply the deterministic fixes of document-scope fixable rules to the repo, writing changed files
 * in place (ESLint-style; audit 4.2). Fix is inherently document-scoped — a TextEdit targets one
 * document's content — so project-scope rules never contribute fixes. Returns the fixed file list;
 * the caller re-lints to report what remains.
 */
export async function applyFixes(input: LintFilesInput): Promise<ApplyFixesResult> {
  const rootDir = path.resolve(input.cwd);
  const loaded = await loadDocuments(input.config.include ?? ["**/*.md"], {
    cwd: rootDir,
    exclude: input.config.exclude,
    respectGitignore: input.config.respectGitignore
  });

  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }
  const projectFiles = [...documents.keys()].sort((left, right) => left.localeCompare(right));

  const fixRules = input.rules
    .filter((configured) => configured.severity !== "off")
    .map((configured) => configured.rule)
    .filter((rule) => rule.scope === "document" && rule.fix !== undefined);

  const fixedFiles: string[] = [];

  for (const document of documents.values()) {
    const context: RuleContext = {
      document,
      filePath: document.path,
      documents,
      projectFiles,
      rootDir,
      settings: input.settings,
      graph: input.graph,
      report: () => {}
    };

    const edits: TextEdit[] = [];
    for (const rule of fixRules) {
      edits.push(...rule.fix!(context));
    }
    if (edits.length === 0) {
      continue;
    }

    const fixed = applyEdits(document.content, edits);
    if (fixed !== document.content) {
      await writeFile(path.resolve(rootDir, document.path), fixed, "utf8");
      fixedFiles.push(document.path);
    }
  }

  return { fixedFiles: fixedFiles.sort((left, right) => left.localeCompare(right)) };
}
