import {
  formatContextGraphSummary,
  summarizeContextGraph,
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
  withErrorOutput,
} from "../shared/tool-response.js";

// `context-graph` — build the project's `ContextGraph` and return it either raw (`format: "json"`)
// or as the derived `ContextGraphSummary` (`format: "summary"`). Core owns graph construction via
// `resolveToolContext` (P7.01) → `loadContext`; this handler only picks which projection to return.

// Local Zod mirrors of `ContextGraphNode`/`ContextGraphEdge` (hand-maintained per this package's
// `lint-message-schema.ts` convention — each has a single consumer here, so it stays local rather
// than promoted to a shared schema module).
const contextGraphNodeSchema = z.object({
  path: z.string(),
  inDegree: z.number().int(),
  outDegree: z.number().int(),
});

const contextGraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["link", "anchor", "image", "import", "id-ref"]),
  line: z.number().int().optional(),
  text: z.string().optional(),
  rawTarget: z.string().optional(),
});

type ContextGraphToolInput = ToolFileInput & { format?: "json" | "summary" };

const contextGraphInputShape = {
  configPath: z.string().optional(),
  cwd: z.string().optional(),
  format: z.enum(["json", "summary"]).optional(),
} as const;

// One tool, two structured shapes: `format: "json"` returns `{ nodes, edges, cycles }` (raw
// `ContextGraph`), `format: "summary"` returns `{ nodes, edges, components, readingOrder }`
// (`ContextGraphSummary`). `registerTool` takes a single `outputSchema`, so the format-specific
// fields are individually optional — a superset schema rather than a discriminated union, which
// would require echoing a `format` field neither core type carries.
const contextGraphOutputShape = {
  nodes: z.array(contextGraphNodeSchema),
  edges: z.array(contextGraphEdgeSchema),
  cycles: z.array(z.array(z.string())).optional(),
  components: z.array(z.array(z.string())).optional(),
  readingOrder: z.array(z.string()).optional(),
} as const;

// `context-graph`'s success schema is already a deliberate superset of two success payloads
// (`json` raw graph vs `summary` projection). Reusing that same superset on errors keeps the wire
// validator satisfied without weakening the required shared fields (`nodes`, `edges`).
const EMPTY_CONTEXT_GRAPH_OUTPUT = {
  nodes: [],
  edges: [],
} as const;

export async function handleContextGraph(
  input: ContextGraphToolInput,
): Promise<CallToolResult> {
  try {
    const { graph } = await resolveToolContext(input);

    // Default `"json"`: the raw, unprocessed graph is the more fundamental of the two shapes, while
    // `"summary"` is a derived convenience view.
    const format = input.format ?? "json";
    const structured =
      format === "summary"
        ? summarizeContextGraph(graph)
        : { nodes: graph.nodes, edges: graph.edges, cycles: graph.cycles };

    // The same text renderer serves both branches: it is a pure function over `graph` either way, so
    // both formats get one consistent human-readable summary rather than a second renderer.
    return successResult({
      summary: formatContextGraphSummary(graph),
      structured,
    });
  } catch (error) {
    return errorResult(error, EMPTY_CONTEXT_GRAPH_OUTPUT);
  }
}

export function registerContextGraphTool(server: McpServer): void {
  server.registerTool(
    "context-graph",
    {
      title: "Build the context graph",
      description:
        'Build the project\'s context graph. `format: "json"` (default) returns the raw graph ' +
        '(nodes, edges, cycles); `format: "summary"` returns nodes, edges, connected components, ' +
        "and topological reading order. Read-only.",
      inputSchema: contextGraphInputShape,
      outputSchema: withErrorOutput(contextGraphOutputShape),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleContextGraph(input),
  );
}
