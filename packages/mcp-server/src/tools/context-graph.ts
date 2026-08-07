import {
  computeGraphCoverage,
  formatContextGraphSummary,
  summarizeContextGraph,
} from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  resolveToolContext,
  toolCwdBase,
  type ToolFileInput,
} from "../shared/tool-context.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput,
} from "../shared/tool-response.js";

// `context-graph` — build the project's `ContextGraph` and return it either verbatim
// (`format: "raw"`, the default) or as the derived `ContextGraphSummary` (`format: "summary"`). Core
// owns graph construction via `resolveToolContext` → `loadContext`; this handler only picks
// which projection to return, and calls `computeGraphCoverage` for the one that carries coverage.
//
// The branch was once named `"json"`. On a JSON-RPC tool *every* projection is JSON,
// so `json` never named an axis here — and it collided with the CLI's `graph --format json`, which
// denotes the summary document, not the raw graph. `raw` vs `summary` names the axis that exists.

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

// Local Zod mirror of `GraphCoverage`, same hand-maintained convention as the two schemas above.
const graphCoverageSchema = z.object({
  nodeCount: z.number().int(),
  edgeCount: z.number().int(),
  filesOutsideCorpus: z.array(z.string()),
});

type ContextGraphToolInput = ToolFileInput & { format?: "raw" | "summary" };

const contextGraphInputShape = {
  configPath: z.string().optional(),
  cwd: z.string().optional(),
  format: z.enum(["raw", "summary"]).optional(),
} as const;

// One tool, two structured shapes: `format: "raw"` returns `{ nodes, edges, cycles }` (the verbatim
// `ContextGraph`), `format: "summary"` returns
// `{ nodes, edges, components, readingOrder, excluded, coverage }` — the same document the CLI's
// `graph --format json` prints, which is the parity between hosts. `registerTool` takes a
// single `outputSchema`, so the format-specific fields are individually optional — a superset schema
// rather than a discriminated union, which would require echoing a `format` field neither core type
// carries. `nodes`/`edges` stay required because both shapes always carry them.
const contextGraphOutputShape = {
  nodes: z.array(contextGraphNodeSchema),
  edges: z.array(contextGraphEdgeSchema),
  cycles: z.array(z.array(z.string())).optional(),
  components: z.array(z.array(z.string())).optional(),
  readingOrder: z.array(z.string()).optional(),
  excluded: z.array(z.string()).optional(),
  coverage: graphCoverageSchema.optional(),
} as const;

// `context-graph`'s success schema is already a deliberate superset of two success payloads
// (`raw` graph vs `summary` projection). Reusing that same superset on errors keeps the wire
// validator satisfied without weakening the required shared fields (`nodes`, `edges`).
const EMPTY_CONTEXT_GRAPH_OUTPUT = {
  nodes: [],
  edges: [],
} as const;

export async function handleContextGraph(
  input: ContextGraphToolInput,
): Promise<CallToolResult> {
  // Outside the `try`: `resolveToolContext` is itself a throw site (config read, corpus walk), so the
  // catch needs the base independently of whether resolution got far enough to produce one.
  const cwd = toolCwdBase(input);

  try {
    // `cwd` is already taken by the base above; this is the *validated* resolution of it, and the
    // root `computeGraphCoverage` probes for out-of-corpus files.
    const {
      cwd: corpusRoot,
      documents,
      graph,
      settings,
    } = await resolveToolContext(input);

    // Default `"raw"`: the unprocessed graph is the more fundamental of the two shapes, `"summary"`
    // is the derived view. Keeping raw the default is also what makes the rename
    // behavior-preserving for a caller that omits `format`.
    const format = input.format ?? "raw";
    const structured =
      format === "summary"
        ? // Coverage is computed on this branch only: `raw` must stay exactly `ContextGraph`, and the
          // disk re-scan coverage needs is work the default branch has no mandate to do.
          // Mirrors the CLI's own call so neither host can drift on rootDir/siteRouter.
          summarizeContextGraph(
            graph,
            computeGraphCoverage(documents, graph, {
              rootDir: corpusRoot,
              siteRouter: settings.siteRouter,
            }),
          )
        : { nodes: graph.nodes, edges: graph.edges, cycles: graph.cycles };

    // The same text renderer serves both branches: it is a pure function over `graph` either way, so
    // both formats get one consistent human-readable summary rather than a second renderer.
    return successResult({
      summary: formatContextGraphSummary(graph),
      structured,
    });
  } catch (error) {
    return errorResult(error, {
      successFields: EMPTY_CONTEXT_GRAPH_OUTPUT,
      cwd,
    });
  }
}

export function registerContextGraphTool(server: McpServer): void {
  server.registerTool(
    "context-graph",
    {
      title: "Build the context graph",
      description:
        'Build the project\'s context graph. `format: "raw"` (default) returns the graph verbatim ' +
        '(nodes, edges, cycles); `format: "summary"` returns nodes, edges, connected components, ' +
        "topological reading order, the nodes a cycle excluded from that order, and the coverage " +
        "signal (node/edge counts plus Markdown files linked-to but outside the corpus) — the same " +
        "document the CLI's `graph --format json` prints. Read-only.",
      inputSchema: contextGraphInputShape,
      outputSchema: withErrorOutput(contextGraphOutputShape),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleContextGraph(input),
  );
}
