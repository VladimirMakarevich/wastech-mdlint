import type { ParsedDocument } from "../../markdown/document-types.js";
import type { ResolvedSettings } from "../types.js";

// What a primitive executor emits. `ruleId`/`severity` are attached later by the rule/runner. A
// project primitive (columnUnique) sets `filePath` per finding; document primitives leave it unset
// (the runner defaults it to the current file).
//
// `line: 0` is the sentinel for "no specific line" (file/section-level findings such as an absent
// section — P3.03 reports absent sections at line 0); the renderer omits the line suffix for 0.
export type PrimitiveFinding = {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  filePath?: string;
  fixable?: boolean;
  data?: Record<string, unknown>;
};

// Everything a primitive may need. Document primitives read `document`; the project primitive
// (columnUnique) reads `documents` (keyed by repo-relative POSIX path); reference primitives use
// `rootDir` for `existsSync`. Kept explicit + synchronous so primitives stay pure and unit-testable.
export type PrimitiveContext = {
  document: ParsedDocument;
  documents: Map<string, ParsedDocument>;
  rootDir: string;
  settings: ResolvedSettings;
};
