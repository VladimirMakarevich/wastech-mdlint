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
  // Where the ref came from. Always "given" here, since `since` names its ref, but the record is the
  // one the CLI writes, where a bare `--since` takes the config's `git.base` or a detected base.
  source: z.enum(["given", "config", "detected"]),
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
      // The project's own base branch, when its config names one, rather than a default such as
      // "main": a team whose work starts from `develop` would otherwise get every finding `develop`
      // added reported as the branch's own.
      'Pass the base branch — the config\'s git.base when it sets one, otherwise for example "main" — or omit "since".',
    );
  }
  const analysis = await analyzeSince({ cwd, configuration, ref });
  if ("available" in analysis) {
    throw new ToolInputError(analysis.message, analysis.hint);
  }
  return analysis;
}
