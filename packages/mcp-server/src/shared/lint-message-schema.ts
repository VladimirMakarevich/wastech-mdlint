import { z } from "zod";

// Hand-maintained Zod mirror of core's `LintMessage` TS type (engine/types.ts). v2 has no codegen,
// so this shape must move in lockstep with that type: a field added, renamed, or made
// required/optional there has to be reflected here or the tools' structured output silently drifts
// from the R3 finding contract. Shared by both lint tools' `outputSchema` so there is one mirror,
// not two.
//
// The key set is unchanged by P15.03; `helpUri`'s *value* is not. It used to cross the wire as a bare
// rule id (identical to `ruleId`) and is now the rule's documentation URL, so a caller that read it as
// an id gets a link instead. Wire-visible but safe to take now: nothing is published (every package is
// `version: "0.0.0"`), and `ruleId` was always the field for the id.
export const lintMessageSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  filePath: z.string(),
  line: z.number(),
  column: z.number().optional(),
  endLine: z.number().optional(),
  fixable: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  helpUri: z.string().optional(),
});
