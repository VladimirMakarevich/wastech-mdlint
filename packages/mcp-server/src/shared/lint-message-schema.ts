import { z } from "zod";

// Hand-maintained Zod mirror of core's `LintMessage` TS type (engine/types.ts). v2 has no codegen,
// so this shape must move in lockstep with that type: a field added, renamed, or made
// required/optional there has to be reflected here or the tools' structured output silently drifts
// from the R3 finding contract. Shared by both lint tools' `outputSchema` so there is one mirror,
// not two.
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
  helpUri: z.string().optional()
});
