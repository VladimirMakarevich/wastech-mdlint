import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCompileContextTool } from "./compile-context.js";
import { registerContextGraphTool } from "./context-graph.js";
import { registerContextSliceTool } from "./context-slice.js";
import { registerImpactAnalysisTool } from "./impact-analysis.js";
import { registerLintFilesTool } from "./lint-files.js";
import { registerLintTool } from "./lint.js";

// Modular tool layout: the single registration seam. Each tool is its own
// module and appends its registrar here — one module per tool, registered from this
// index, so no single mega-file.
//
// The list stays function-only (not `{ name, register }[]`): a parallel name list would be a second
// hand-maintained source of truth that could drift from the real registerTool() calls — exactly the
// "5 vs 6 tools" mismatch the generated inventory exists to prevent. Doc generation introspects the
// live McpServer instance instead of reading a name array here.
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
