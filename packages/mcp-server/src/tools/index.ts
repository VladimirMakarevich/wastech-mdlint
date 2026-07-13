import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCompileContextTool } from "./compile-context.js";
import { registerContextGraphTool } from "./context-graph.js";
import { registerContextSliceTool } from "./context-slice.js";
import { registerImpactAnalysisTool } from "./impact-analysis.js";
import { registerLintFilesTool } from "./lint-files.js";
import { registerLintTool } from "./lint.js";

// Modular tool layout (P7.01, task step 1): the single registration seam. Each tool lands as its own
// module in P7.02–04 and appends its registrar here — one module per tool, registered from this
// index, so no single mega-file (M3).
//
// The list stays function-only (not `{ name, register }[]`): a parallel name list would be a second
// hand-maintained source of truth that could drift from the real registerTool() calls — exactly the
// "5 vs 6 tools" mismatch M3 exists to prevent. P7.05's doc generation should introspect the live
// McpServer instance instead of reading a name array here.
const TOOL_REGISTRARS: Array<(server: McpServer) => void> = [
  registerLintTool,
  registerLintFilesTool,
  registerContextGraphTool,
  registerContextSliceTool,
  registerImpactAnalysisTool,
  registerCompileContextTool,
];

export function registerTools(server: McpServer): void {
  for (const register of TOOL_REGISTRARS) {
    register(server);
  }
}
