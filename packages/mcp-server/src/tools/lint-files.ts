import { formatLintResultText, lintFiles, type LintResult } from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { lintMessageSchema } from "../shared/lint-message-schema.js";
import { resolveToolConfiguration, type ToolFileInput } from "../shared/tool-context.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput
} from "../shared/tool-response.js";

// `lint-files` — lint the project's Markdown files. Configuration (and its resolved rules/settings)
// comes from `resolveToolConfiguration`, the shared P7.01 helper over core's `loadConfiguration`;
// core stays the sole owner of the pipeline (this handler is a thin adapter, mirroring the CLI's
// `handleLint` without `--fix` and without graph loading).

// Same `cwd?`/`configPath?` shape as `ToolFileInput`, plus an optional `patterns` override — so the
// handler can pass `input` straight into `resolveToolConfiguration`.
type LintFilesToolInput = ToolFileInput & { patterns?: string[] };

const lintFilesInputShape = {
  patterns: z.array(z.string()).optional(),
  configPath: z.string().optional(),
  cwd: z.string().optional()
} as const;

// Mirrors `LintResult` directly — field names already match, so `structured: result` needs no
// reshaping.
const lintFilesOutputShape = {
  messages: z.array(lintMessageSchema),
  files: z.array(z.string()),
  errorCount: z.number().int(),
  warningCount: z.number().int()
} as const;

// Match the required `LintResult` fields on the error path so schema-validating MCP clients accept
// the structured error payload instead of rejecting the response before the caller sees the code.
const EMPTY_LINT_FILES_OUTPUT = {
  messages: [],
  files: [],
  errorCount: 0,
  warningCount: 0
} as const;

export async function handleLintFiles(input: LintFilesToolInput): Promise<CallToolResult> {
  try {
    // `resolveToolConfiguration` computes this same default internally but doesn't return it, so
    // `lintFiles` needs its own copy — the same one-liner tool-context.ts already duplicates.
    const cwd = input.cwd ?? process.cwd();
    const loaded = await resolveToolConfiguration(input);

    // An explicit `patterns` arg *replaces* `config.include` (not merges). When it's absent we leave
    // `config.include` untouched so core's own `include ?? ["**/*.md"]` fallback applies — that
    // "fallback patterns" behavior stays core's job, not reimplemented here.
    const config =
      input.patterns === undefined ? loaded.config : { ...loaded.config, include: input.patterns };

    const result: LintResult = await lintFiles({
      cwd,
      config,
      rules: loaded.rules,
      settings: loaded.settings
    });

    return successResult({ summary: formatLintResultText(result), structured: result });
  } catch (error) {
    return errorResult(error, EMPTY_LINT_FILES_OUTPUT);
  }
}

export function registerLintFilesTool(server: McpServer): void {
  server.registerTool(
    "lint-files",
    {
      title: "Lint project files",
      description:
        "Lint the project's Markdown files using the resolved config (or the zero-config `**/*.md` default). Read-only.",
      inputSchema: lintFilesInputShape,
      outputSchema: withErrorOutput(lintFilesOutputShape),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (input) => handleLintFiles(input)
  );
}
