import path from "node:path";

import { writeFilesAtomic } from "../atomic-write.js";
import { compareStrings } from "../deterministic-sort.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import { detectNewline, normalizeNewlines } from "../markdown/newline.js";
import type { LintFilesInput } from "./lint-files.js";
import type { RuleContext, TextEdit } from "./types.js";

/**
 * Apply offset-based edits to content (P3.02 fix engine). Edits are applied from the highest offset
 * down so earlier offsets stay valid; overlapping edits are skipped (last-writer-wins by position)
 * so a malformed rule can never corrupt the file.
 */
export function applyEdits(
  content: string,
  edits: readonly TextEdit[],
): string {
  const sorted = [...edits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let result = content;
  let lastStart = Number.POSITIVE_INFINITY;

  for (const edit of sorted) {
    if (edit.end > lastStart) {
      continue;
    }
    result =
      result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
    lastStart = edit.start;
  }

  return result;
}

export type ApplyFixesResult = { fixedFiles: string[] };

/**
 * A `--fix` document write that could not be committed (P11.09). Thrown rather than swallowed: the
 * user asked for their files to be rewritten, and silently continuing would report a clean re-lint
 * for a file that was never actually fixed.
 *
 * The message is built from the errno `code` only, never the underlying fs message — Node embeds two
 * absolute, platform-native paths (including the random temp name) in a `rename` error, which would
 * make this output both host-specific and nondeterministic. `filePath`/`fixedFiles` are
 * repo-relative POSIX paths, so a host can render them without further translation.
 */
export class FixWriteError extends Error {
  readonly filePath: string;
  readonly fixedFiles: string[];
  readonly errnoCode: string | undefined;

  constructor(params: {
    filePath: string;
    fixedFiles: string[];
    errnoCode: string | undefined;
  }) {
    const reason =
      params.errnoCode === undefined ? "" : ` (${params.errnoCode})`;
    const already =
      params.fixedFiles.length === 0
        ? "No files were changed."
        : `Already fixed: ${params.fixedFiles.join(", ")}.`;
    super(
      `--fix could not write ${params.filePath}${reason}; it is unchanged on disk. ` +
        `${already} Resolve the write failure and re-run with --fix.`,
    );
    this.name = "FixWriteError";
    this.filePath = params.filePath;
    this.fixedFiles = params.fixedFiles;
    this.errnoCode = params.errnoCode;
  }
}

/**
 * Apply the deterministic fixes of document-scope fixable rules to the repo, writing changed files
 * in place (ESLint-style; audit 4.2). Fix is inherently document-scoped — a TextEdit targets one
 * document's content — so project-scope rules never contribute fixes. Returns the fixed file list;
 * the caller re-lints to report what remains.
 */
export async function applyFixes(
  input: LintFilesInput,
): Promise<ApplyFixesResult> {
  const rootDir = path.resolve(input.cwd);
  const loaded = await loadDocuments(input.config.include ?? ["**/*.md"], {
    cwd: rootDir,
    exclude: input.config.exclude,
    respectGitignore: input.config.respectGitignore,
  });

  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }
  const projectFiles = [...documents.keys()].sort(compareStrings);

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
      report: () => {},
    };

    // Enforced once here rather than inside `applyEdits` (which stays a pure offset primitive):
    // whatever a rule hands back adopts the host document's line ending, so no rule can leave a
    // CRLF file with mixed endings (audit L-6). Fixable rules also do this themselves where they
    // build multi-line content, so each is correct when called in isolation — deliberately
    // belt-and-braces, since a future fix hook that forgets is the exact failure mode this class-level
    // guarantee exists to absorb.
    const newline = detectNewline(document.content);
    const edits: TextEdit[] = [];
    for (const rule of fixRules) {
      for (const edit of rule.fix!(context)) {
        edits.push({
          ...edit,
          newText: normalizeNewlines(edit.newText, newline),
        });
      }
    }
    if (edits.length === 0) {
      continue;
    }

    const fixed = applyEdits(document.content, edits);
    if (fixed !== document.content) {
      const write = await writeFilesAtomic([
        { path: path.resolve(rootDir, document.path), content: fixed },
      ]);
      if (!write.ok) {
        // Fail fast on the first unwritable document: continuing would keep rewriting files while
        // the user has no idea one was skipped, and turning this into a per-file report means
        // redesigning the fix engine's result contract, which is out of scope here.
        throw new FixWriteError({
          filePath: document.path,
          fixedFiles: [...fixedFiles].sort(compareStrings),
          errnoCode: write.code,
        });
      }
      fixedFiles.push(document.path);
    }
  }

  return { fixedFiles: fixedFiles.sort(compareStrings) };
}
