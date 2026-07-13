import {
  classifyImpact,
  relativizeImpact,
  renderImpactSummary,
} from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  resolveToolContext,
  type ToolFileInput,
} from "../shared/tool-context.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
} from "../shared/tool-response.js";

// `impact-analysis` — the blast radius of changing `file`: which files reference it directly, which
// depend on it transitively, and the reading order over that affected subgraph. Core owns the
// classification (P4.05); this handler is a thin adapter.

type ImpactAnalysisToolInput = ToolFileInput & { file: string };

const impactAnalysisInputShape = {
  file: z.string(),
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

const impactAnalysisOutputShape = {
  file: z.string(),
  directlyAffected: z.array(directlyAffectedSchema),
  transitivelyAffected: z.array(transitivelyAffectedSchema),
  readingOrder: z.array(z.string()),
  excluded: z.array(z.string()),
} as const;

export async function handleImpactAnalysis(
  input: ImpactAnalysisToolInput,
): Promise<CallToolResult> {
  try {
    const { graph } = await resolveToolContext(input);

    // `classifyImpact` throws `ImpactAnalysisError` (code `TARGET_NOT_FOUND`, already in
    // `TOOL_ERROR_CODES`) when `file` is not in the corpus, so `errorResult` passes it through with
    // no translation wrapper — unlike `lint.ts`, whose `RuleResolutionError` codes aren't in the
    // taxonomy.
    const classification = classifyImpact(graph, input.file);

    // Identity transform: this tool's `cwd` is both the corpus root the graph is built from and the
    // base the classification's paths are already relative to, so "repo-relative cwd" is `""`. The
    // call is still made (first real consumer of `relativizeImpact`); it just changes no path here.
    const relativized = relativizeImpact(classification, "");

    return successResult({
      summary: renderImpactSummary(relativized),
      structured: relativized,
    });
  } catch (error) {
    return errorResult(error);
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
        "in the corpus returns an actionable error. Read-only.",
      inputSchema: impactAnalysisInputShape,
      outputSchema: impactAnalysisOutputShape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleImpactAnalysis(input),
  );
}
