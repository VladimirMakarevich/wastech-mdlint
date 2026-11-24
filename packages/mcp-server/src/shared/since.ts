import {
  analyzeSince,
  type LoadedConfiguration,
  type SinceAnalysis,
} from "@wastech-mdlint/core";
import { z } from "zod";

import { lintMessageSchema } from "./lint-message-schema.js";
import { ToolInputError } from "./tool-input-error.js";

// The `since` input both file-based tools accept, and the record of the comparison both return.
// One schema, so `lint-files` and `impact-analysis` describe "since" identically to a client that
// generates types from their output schemas.

export const sinceInput = z.string().optional();

export const sinceSummarySchema = z.object({
  ref: z.string(),
  base: z.string(),
  mergeBase: z.string(),
  head: z.string(),
  changed: z.array(z.string()),
  removed: z.array(lintMessageSchema),
});

/**
 * The work tree's changes since `ref`, or an input error naming why there is nothing to compare —
 * not a git work tree, no `git`, a ref that names nothing — with git's remedy as the hint. An error
 * rather than an empty answer, because "no new findings" from a comparison that never ran is the
 * plausible answer to a different question.
 */
export async function analyzeSinceOrThrow(
  cwd: string,
  configuration: LoadedConfiguration,
  ref: string,
): Promise<SinceAnalysis> {
  if (ref.trim() === "") {
    throw new ToolInputError(
      "since must name a branch, tag or commit",
      'Pass the base branch, for example "main", or omit "since".',
    );
  }
  const analysis = await analyzeSince({ cwd, configuration, ref });
  if ("available" in analysis) {
    throw new ToolInputError(analysis.message, analysis.hint);
  }
  return analysis;
}
