import type { ToolErrorCode } from "../errors.js";

// Config error type. Relocated out of the (removed) legacy loader at the P3.09 cutover so the v2
// config path owns it. Thrown by loadConfiguration; the CLI maps it to exit code 2. Carries a
// structured `code`/`hint` (M6) so an MCP host can render the shared error contract without a
// separate error taxonomy — the code is always a config-family member (CONFIG_NOT_FOUND /
// CONFIG_INVALID) chosen at each throw site.
export class ConfigError extends Error {
  readonly code: ToolErrorCode;
  readonly hint?: string;

  constructor(code: ToolErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.hint = hint;
  }
}
