import {
  classifyImpact,
  relativizeImpact,
  renderImpactSummary,
  renderSinceHeader,
  sinceImpact,
} from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  analyzeSinceOrThrow,
  sinceInput,
  sinceSummarySchema,
} from "../shared/since.js";
import {
  resolveToolConfiguration,
  resolveToolContext,
  toolCwdBase,
  type ToolFileInput,
} from "../shared/tool-context.js";
import { ToolInputError } from "../shared/tool-input-error.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput,
} from "../shared/tool-response.js";

// `impact-analysis` — the blast radius of changing `file`: which files reference it directly, which
// depend on it transitively, and the reading order over that affected subgraph. Core owns the
// classification; this handler is a thin adapter.

// Exactly one of `file` and `since`, checked in the handler: a schema rejection would reach the
// client as a bare `InvalidParams` without the hint the error contract carries.
type ImpactAnalysisToolInput = ToolFileInput & {
  file?: string;
  since?: string;
};

const impactAnalysisInputShape = {
  file: z.string().optional(),
  since: sinceInput,
  configPath: z.string().optional(),
  cwd: z.string().optional(),
} as const;

// Local mirrors of `DirectlyAffected`/`TransitivelyAffected`, matching `ImpactClassification`
// exactly. `via` on a transitive entry is always a real predecessor path (never null) — every
// depth≥2 visit has one, per impact-analysis.ts's own invariant.
const directlyAffectedSchema = z.object({
  path: z.string(),
  references: z.number().int(),
});
const transitivelyAffectedSchema = z.object({
  path: z.string(),
  depth: z.number().int(),
  via: z.string(),
});

// `file` for one changed file; `files` and `since` for every document changed since a ref.
const impactAnalysisOutputShape = {
  file: z.string().optional(),
  files: z.array(z.string()).optional(),
  since: sinceSummarySchema.optional(),
  directlyAffected: z.array(directlyAffectedSchema),
  transitivelyAffected: z.array(transitivelyAffectedSchema),
  readingOrder: z.array(z.string()),
  excluded: z.array(z.string()),
} as const;

export async function handleImpactAnalysis(
  input: ImpactAnalysisToolInput,
): Promise<CallToolResult> {
  // Outside the `try`: `resolveToolContext` is itself a throw site, so the catch needs the base
  // independently of whether resolution got far enough to produce one.
  const cwd = toolCwdBase(input);

  try {
    if ((input.file === undefined) === (input.since === undefined)) {
      throw new ToolInputError(
        'impact-analysis takes either "file" or "since"',
        'Pass "file" for one changed Markdown file, or "since" (a branch, tag or commit) for every document the work tree changed since where it left that ref.',
      );
    }
    if (input.since !== undefined) {
      const loaded = await resolveToolConfiguration(input);
      const result = sinceImpact(
        await analyzeSinceOrThrow(loaded.cwd, loaded, input.since),
      );
      return successResult({
        summary: `${renderSinceHeader(result.since)}${renderImpactSummary(result)}`,
        structured: result,
      });
    }
    const file = input.file ?? "";
    const { graph } = await resolveToolContext(input);

    // `classifyImpact` throws `ImpactAnalysisError` (code `TARGET_NOT_FOUND`, already in
    // `TOOL_ERROR_CODES`) when `file` is not in the corpus, so `errorResult` passes it through with
    // no translation wrapper — unlike `lint.ts`, whose `RuleResolutionError` codes aren't in the
    // taxonomy.
    const classification = classifyImpact(graph, file);

    // Identity transform: this tool's `cwd` is both the corpus root the graph is built from and the
    // base the classification's paths are already relative to, so "repo-relative cwd" is `""`. The
    // call is still made (first real consumer of `relativizeImpact`); it just changes no path here.
    const relativized = relativizeImpact(classification, "");

    return successResult({
      summary: renderImpactSummary(relativized),
      structured: relativized,
    });
  } catch (error) {
    // Preserve the requested `file` while zeroing the graph-derived lists so the error remains
    // machine-parseable under the same required schema a successful impact result uses.
    return errorResult(error, {
      successFields: {
        ...(input.file === undefined ? {} : { file: input.file }),
        directlyAffected: [],
        transitivelyAffected: [],
        readingOrder: [],
        excluded: [],
      },
      cwd,
    });
  }
}

export function registerImpactAnalysisTool(server: McpServer): void {
  server.registerTool(
    "impact-analysis",
    {
      title: "Analyze change impact",
      description:
        "Compute the blast radius of changing a Markdown file: files that reference it directly, " +
        "files affected transitively, and the reading order over the affected subgraph. A file not " +
        "in the corpus returns an actionable error. With `since` (a branch, tag or commit) in place " +
        "of `file`, the same for every document the work tree changed since where it left that ref, " +
        "read with git. Read-only.",
      inputSchema: impactAnalysisInputShape,
      outputSchema: withErrorOutput(impactAnalysisOutputShape),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleImpactAnalysis(input),
  );
}
