import {
  getContextSlice,
  renderContextSliceSummary,
  SLICE_RESOLUTION_DESCRIPTION,
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

// `context-slice` — the files reachable within `depth` hops of a resolved query, following graph
// edges forward. Query resolution is core's deterministic exact-match index (P4.04); this handler is
// a thin adapter over `getContextSlice` and does not re-implement resolution or traversal.

type ContextSliceToolInput = ToolFileInput & { query: string; depth?: number };

const contextSliceInputShape = {
  query: z.string(),
  // `.min(0)` mirrors the CLI's `--depth` parse guard: a negative hop bound is not a meaningful
  // traversal request (it silently degrades to a start-only slice), so it is rejected at input
  // validation rather than accepted and quietly misinterpreted.
  depth: z.number().int().min(0).optional(),
  configPath: z.string().optional(),
  cwd: z.string().optional(),
} as const;

// Local mirrors of `SliceMatchKind`/`QueryVisit`, matching `ContextSliceResult` exactly.
const sliceMatchKindSchema = z.enum(["id", "anchor", "heading", "path"]);
const queryVisitSchema = z.object({
  path: z.string(),
  depth: z.number().int(),
  via: z.string().nullable(),
});

const contextSliceOutputShape = {
  query: z.string(),
  matchKind: sliceMatchKindSchema.nullable(),
  starts: z.array(z.string()),
  files: z.array(z.string()),
  visited: z.array(queryVisitSchema),
} as const;

export async function handleContextSlice(
  input: ContextSliceToolInput,
): Promise<CallToolResult> {
  try {
    const { graph, documents, settings } = await resolveToolContext(input);

    // `input.depth` is passed straight through even when `undefined`: `getContextSlice`'s own default
    // parameter (`depth = 2`) applies to an explicit `undefined` argument, so no `?? 2` is needed.
    const result = getContextSlice(
      graph,
      documents,
      input.query,
      input.depth,
      settings.idRef,
    );

    // An unresolved query is not an error: it returns `matchKind: null` with empty arrays. This is
    // the G4/M2 "honest empty result" contract — do not throw.
    return successResult({
      summary: renderContextSliceSummary(result),
      structured: result,
    });
  } catch (error) {
    return errorResult(error);
  }
}

export function registerContextSliceTool(server: McpServer): void {
  server.registerTool(
    "context-slice",
    {
      title: "Compute a context slice",
      // Embeds the exact `SLICE_RESOLUTION_DESCRIPTION` string so the tool advertises the same honest
      // exact-match semantics core promises (M2/AC2) instead of drifting into over-promising copy.
      description:
        "Files reachable within `depth` hops of a resolved query, following graph edges forward. " +
        `${SLICE_RESOLUTION_DESCRIPTION} Read-only.`,
      inputSchema: contextSliceInputShape,
      outputSchema: contextSliceOutputShape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleContextSlice(input),
  );
}
