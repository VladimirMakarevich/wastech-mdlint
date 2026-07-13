import { compileContext } from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { resolveToolConfiguration, type ToolFileInput } from "../shared/tool-context.js";
import { errorResult, READ_ONLY_ANNOTATIONS } from "../shared/tool-response.js";

// `compile-context` — compile the project skill (the same deterministic `SKILL.md` the CLI's
// `compile` command produces) over MCP. Core owns the whole pipeline (P5); this handler is a thin
// adapter.
//
// Unlike its five sibling tools, `compile-context` returns NO `structuredContent`/`outputSchema`:
// the locked requirement M1 (docs/mdlint_v2/requirements/05-mcp-server.md) names the exact five
// tools that get structured output (`lint`, `lint-files`, `context-graph`, `context-slice`,
// `impact-analysis`) and pointedly omits this one, and the phase task file
// (docs/mdlint_v2/P7-mcp-server/04-compile-tool.md) specifies "two content blocks" instead. Both
// outrank the roadmap-summary bullet that reads as if all six tools are structured. So the
// `registerTool` call omits `outputSchema` and the handler returns exactly two text blocks — hence
// `successResult` (which always attaches `structuredContent`) is deliberately not reused here.

// Identical `cwd?`/`configPath?` shape to `ToolFileInput`; this tool adds no field, so it takes
// `ToolFileInput` directly rather than aliasing a one-field-wider input type.
const compileContextInputShape = {
  configPath: z.string().optional(),
  cwd: z.string().optional()
} as const;

export async function handleCompileContext(input: ToolFileInput): Promise<CallToolResult> {
  try {
    // `resolveToolConfiguration` computes this same default internally but doesn't return it, so we
    // recompute `cwd` here — the same one-liner duplication lint-files.ts already documents.
    const cwd = input.cwd ?? process.cwd();
    const loaded = await resolveToolConfiguration(input);

    // `compileContext` throws `CompileConfigMissingError` (code `COMPILE_CONFIG_MISSING`, already in
    // `TOOL_ERROR_CODES`, carrying `.hint`) when `config.compile` is absent, so `errorResult` passes
    // it through verbatim with no translation wrapper — exactly like `impact-analysis`, and unlike
    // `lint.ts` whose `RuleResolutionError` codes aren't in the taxonomy.
    const result = await compileContext(loaded, cwd);
    const { documentCount, ruleCount, componentCount } = result.metadata;

    return {
      content: [
        // `skillContent` passes through byte-for-byte (the AC's determinism/parity criterion): the
        // CLI and this tool share the same `compileContext` call boundary, so returning it verbatim
        // guarantees identical output. The metadata line is a plain-text summary, not Markdown, and
        // lives here as a local template because it has exactly one call site today (the CLI prints
        // `skillContent` or a write confirmation, never this line) — promote it to core only if a
        // second consumer appears.
        { type: "text", text: result.skillContent },
        {
          type: "text",
          text: `Documents: ${documentCount}, Rules: ${ruleCount}, Components: ${componentCount}`
        }
      ]
    };
  } catch (error) {
    return errorResult(error);
  }
}

export function registerCompileContextTool(server: McpServer): void {
  server.registerTool(
    "compile-context",
    {
      title: "Compile the project skill",
      description:
        "Compile the project skill (SKILL.md) from `config.compile`, producing the same deterministic " +
        "output as the CLI `compile` command: the skill content plus a Documents/Rules/Components " +
        "metadata line. Requires `config.compile`; its absence returns an actionable error. Read-only.",
      inputSchema: compileContextInputShape,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (input) => handleCompileContext(input)
  );
}
