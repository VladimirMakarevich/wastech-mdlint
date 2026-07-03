import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";

// Shared `files`/`exclude` file-scoping base for every rule (R7 / P3.01). `glob-match` semantics are
// picomatch-with-`{dot:true}` via the repo's matchesConfigGlob, so dotfiles (`.claude/…`) match.

// Options fragment mixed into rules that scope by file. `.strict()` is applied by each rule's own
// object; these are just the shared fields.
export const fileScopeShape = {
  files: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional()
} as const;

export type FileScope = { files?: string[]; exclude?: string[] };

/**
 * True when `filePath` is in scope for a rule: it matches `files` (if given) and does not match
 * `exclude`. `exclude` wins over `files` (C1 semantics, applied per-rule).
 */
export function matchesFileScope(filePath: string, scope: FileScope): boolean {
  if (scope.files !== undefined && !matchesConfigGlob(filePath, scope.files)) {
    return false;
  }
  if (scope.exclude !== undefined && matchesConfigGlob(filePath, scope.exclude)) {
    return false;
  }
  return true;
}
